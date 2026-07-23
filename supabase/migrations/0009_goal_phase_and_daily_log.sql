-- 0009_goal_phase_and_daily_log.sql
--
-- Adds the goal-phase model and daily log completeness tracking.
--
-- Design decisions (see docs/adr/009-goal-phases.md):
--   • goal_phases is historical: ended phases are preserved, never reused.
--   • Only one active phase per user (enforced by partial unique index).
--   • sign convention for target_change_kg_per_week: negative = loss, zero = maintenance.
--   • daily_log_status is explicit: meal presence never implies complete.
--   • Logging a meal on a complete day automatically reopens it (trigger).
--   • user_goals (legacy macro targets) is retained but deprecated; goal_phases
--     is the authoritative structure for phase + target data going forward.

-- ─── goal_phases ──────────────────────────────────────────────────────────────

CREATE TABLE public.goal_phases (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- mode: cut (caloric deficit) or maintenance (weight stable).
  -- Bulk/gain and recomposition are reserved for a future milestone.
  mode                       TEXT        NOT NULL,

  -- status lifecycle: active → completed | cancelled | superseded
  status                     TEXT        NOT NULL DEFAULT 'active',

  -- Temporal span. ended_at is set when the phase leaves 'active'.
  started_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at                   TIMESTAMPTZ,
  ended_reason               TEXT,

  -- Starting weight — required, explicitly sourced.
  -- 'manual': caller supplied the value.
  -- 'latest_weight_log': derived from the user's most recent official weight.
  starting_weight_kg         NUMERIC(6,2) NOT NULL,
  starting_weight_source     TEXT         NOT NULL,

  -- Optional targets.
  target_weight_kg           NUMERIC(6,2),

  -- Weekly change target.
  -- Sign convention: negative = weight loss, zero = maintenance.
  -- Only ≤ 0 is valid in this milestone (bulk not yet supported).
  -- Technical guardrail: more than −2 kg/week is extreme (not a clinical statement).
  target_change_kg_per_week  NUMERIC(4,2),

  -- Nutrition targets.
  target_calories            NUMERIC(7,1),
  target_protein_g           NUMERIC(6,1),
  target_carbs_g             NUMERIC(6,1),
  target_fat_g               NUMERIC(6,1),

  -- Supersession chain. Set when this phase is superseded by a newer one.
  superseded_by              UUID REFERENCES public.goal_phases(id) ON DELETE SET NULL,

  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- ── Enum-like constraints ──────────────────────────────────────────────────
  CONSTRAINT chk_goal_phase_mode
    CHECK (mode IN ('cut', 'maintenance')),
  CONSTRAINT chk_goal_phase_status
    CHECK (status IN ('active', 'completed', 'cancelled', 'superseded')),
  CONSTRAINT chk_goal_phase_weight_source
    CHECK (starting_weight_source IN ('manual', 'latest_weight_log')),

  -- ── Weight constraints ─────────────────────────────────────────────────────
  -- Range mirrors weight_logs to prevent corrupt imports.
  CONSTRAINT chk_starting_weight_positive
    CHECK (starting_weight_kg > 0),
  CONSTRAINT chk_starting_weight_range
    CHECK (starting_weight_kg BETWEEN 20 AND 300),
  CONSTRAINT chk_target_weight_positive
    CHECK (target_weight_kg IS NULL OR target_weight_kg > 0),
  CONSTRAINT chk_target_weight_range
    CHECK (target_weight_kg IS NULL OR target_weight_kg BETWEEN 20 AND 300),

  -- ── Nutrition constraints ──────────────────────────────────────────────────
  CONSTRAINT chk_target_calories_positive
    CHECK (target_calories IS NULL OR target_calories > 0),
  CONSTRAINT chk_target_protein_nonneg
    CHECK (target_protein_g IS NULL OR target_protein_g >= 0),
  CONSTRAINT chk_target_carbs_nonneg
    CHECK (target_carbs_g IS NULL OR target_carbs_g >= 0),
  CONSTRAINT chk_target_fat_nonneg
    CHECK (target_fat_g IS NULL OR target_fat_g >= 0),

  -- ── Weekly rate constraints ────────────────────────────────────────────────
  -- Cut: rate must be negative (loss) or null.
  CONSTRAINT chk_cut_rate_negative
    CHECK (mode <> 'cut' OR target_change_kg_per_week IS NULL OR target_change_kg_per_week < 0),
  -- Maintenance: rate must be zero or null.
  CONSTRAINT chk_maintenance_rate_zero_or_null
    CHECK (mode <> 'maintenance' OR target_change_kg_per_week IS NULL OR target_change_kg_per_week = 0),
  -- Technical guardrail — max 2 kg/week loss and no positive values in this milestone.
  CONSTRAINT chk_rate_range
    CHECK (target_change_kg_per_week IS NULL
           OR (target_change_kg_per_week >= -2.0 AND target_change_kg_per_week <= 0)),

  -- ── Phase lifecycle constraints ────────────────────────────────────────────
  -- Inactive phases must have ended_at; active phases must not.
  CONSTRAINT chk_ended_at_present_when_inactive
    CHECK (status = 'active' OR ended_at IS NOT NULL),
  CONSTRAINT chk_ended_at_absent_when_active
    CHECK (status <> 'active' OR ended_at IS NULL),
  -- ended_at cannot precede started_at.
  CONSTRAINT chk_ended_after_started
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);

-- One active phase per user — enforced at the DB level.
CREATE UNIQUE INDEX idx_goal_phases_one_active_per_user
  ON public.goal_phases (user_id)
  WHERE (status = 'active');

-- Ordered history lookup.
CREATE INDEX idx_goal_phases_user_started
  ON public.goal_phases (user_id, started_at DESC);

CREATE INDEX idx_goal_phases_superseded_by
  ON public.goal_phases (superseded_by)
  WHERE superseded_by IS NOT NULL;

CREATE TRIGGER trg_goal_phases_updated_at
  BEFORE UPDATE ON public.goal_phases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.goal_phases ENABLE ROW LEVEL SECURITY;

CREATE POLICY goal_phases_all_own
  ON public.goal_phases FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── daily_log_status ─────────────────────────────────────────────────────────
--
-- Explicit user classification of each day's food log.
-- 'complete' is NEVER inferred from meal presence — only an explicit user
-- action sets it. This prevents silent misclassification of incomplete days.

CREATE TABLE public.daily_log_status (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID         NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  logged_date        DATE         NOT NULL,

  -- 'unknown': user has not classified the day.
  -- 'partial': user is still logging (explicit).
  -- 'complete': user explicitly marked the day finished.
  status             TEXT         NOT NULL DEFAULT 'unknown',

  -- Timestamps for the most recent completion and most recent reopening.
  -- marked_complete_at is PRESERVED (not cleared) when the day is reopened,
  -- providing an audit trail of the last known completion time.
  marked_complete_at TIMESTAMPTZ,
  reopened_at        TIMESTAMPTZ,

  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT uq_daily_log_status_user_date
    UNIQUE (user_id, logged_date),

  CONSTRAINT chk_daily_log_status_value
    CHECK (status IN ('unknown', 'partial', 'complete')),

  -- Complete rows must record when they were completed.
  CONSTRAINT chk_marked_complete_when_status_complete
    CHECK (status <> 'complete' OR marked_complete_at IS NOT NULL)
  -- Note: marked_complete_at may remain set when status is partial/unknown
  -- (preserved as audit trail of prior completion).
);

CREATE INDEX idx_daily_log_status_user_date
  ON public.daily_log_status (user_id, logged_date DESC);

CREATE TRIGGER trg_daily_log_status_updated_at
  BEFORE UPDATE ON public.daily_log_status
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.daily_log_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY daily_log_status_all_own
  ON public.daily_log_status FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── Trigger: reopen completed day when a new meal is logged ──────────────────
--
-- Fires AFTER INSERT on meals (within the same transaction as fn_log_meal).
-- If the day was already marked complete, it is automatically reopened to
-- partial with a reopened_at timestamp. No row is created if none exists.

CREATE OR REPLACE FUNCTION public.fn_reopen_daily_log_on_meal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.daily_log_status
  SET status      = 'partial',
      reopened_at = now(),
      updated_at  = now()
  WHERE user_id    = NEW.user_id
    AND logged_date = NEW.logged_date
    AND status      = 'complete';
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_reopen_daily_log_on_meal
  AFTER INSERT ON public.meals
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_reopen_daily_log_on_meal();

-- ─── fn_start_goal_phase ──────────────────────────────────────────────────────
--
-- Atomically transitions an existing active phase (if any) and creates a new one.
-- Called from the start-goal-phase edge function using the service role.
-- The edge function validates the caller's JWT before invoking this.
--
-- p_transition: NULL (no existing phase), 'supersede', or 'cancel'.
-- Returns the UUID of the new phase.

CREATE OR REPLACE FUNCTION public.fn_start_goal_phase(
  p_user_id                    UUID,
  p_mode                       TEXT,
  p_started_at                 TIMESTAMPTZ,
  p_starting_weight_kg         NUMERIC,
  p_starting_weight_source     TEXT,
  p_target_weight_kg           NUMERIC    DEFAULT NULL,
  p_target_change_kg_per_week  NUMERIC    DEFAULT NULL,
  p_target_calories            NUMERIC    DEFAULT NULL,
  p_target_protein_g           NUMERIC    DEFAULT NULL,
  p_target_carbs_g             NUMERIC    DEFAULT NULL,
  p_target_fat_g               NUMERIC    DEFAULT NULL,
  p_transition                 TEXT       DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id UUID;
  v_new_id      UUID := gen_random_uuid();
BEGIN
  -- Defence-in-depth: reject cross-user calls when JWT is present.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Cannot start a phase for another user' USING ERRCODE = 'P0001';
  END IF;

  -- Lock the active phase row for the remainder of this transaction.
  SELECT id INTO v_existing_id
  FROM public.goal_phases
  WHERE user_id = p_user_id AND status = 'active'
  FOR UPDATE;

  IF v_existing_id IS NOT NULL THEN
    IF p_transition IS NULL THEN
      RAISE EXCEPTION
        'An active phase already exists. Supply transition=supersede or transition=cancel.'
        USING ERRCODE = 'P0002';
    ELSIF p_transition = 'supersede' THEN
      UPDATE public.goal_phases
      SET status        = 'superseded',
          ended_at      = p_started_at,
          superseded_by = v_new_id,
          updated_at    = now()
      WHERE id = v_existing_id;
    ELSIF p_transition = 'cancel' THEN
      UPDATE public.goal_phases
      SET status       = 'cancelled',
          ended_at     = p_started_at,
          ended_reason = 'Cancelled to start a new phase',
          updated_at   = now()
      WHERE id = v_existing_id;
    ELSE
      RAISE EXCEPTION 'Invalid transition "%". Must be supersede or cancel.', p_transition
        USING ERRCODE = 'P0003';
    END IF;
  END IF;

  INSERT INTO public.goal_phases (
    id, user_id, mode, status, started_at,
    starting_weight_kg, starting_weight_source,
    target_weight_kg, target_change_kg_per_week,
    target_calories, target_protein_g, target_carbs_g, target_fat_g
  ) VALUES (
    v_new_id, p_user_id, p_mode, 'active', p_started_at,
    p_starting_weight_kg, p_starting_weight_source,
    p_target_weight_kg, p_target_change_kg_per_week,
    p_target_calories, p_target_protein_g, p_target_carbs_g, p_target_fat_g
  );

  RETURN v_new_id;
END;
$$;

-- ─── fn_set_daily_log_status ──────────────────────────────────────────────────
--
-- Atomically upserts daily_log_status with correct field merging:
--   • complete  → sets marked_complete_at = now()
--   • partial/unknown from complete → preserves marked_complete_at, sets reopened_at
-- Returns the updated row as JSONB.

CREATE OR REPLACE FUNCTION public.fn_set_daily_log_status(
  p_user_id UUID,
  p_date    DATE,
  p_status  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing    public.daily_log_status%ROWTYPE;
  v_now         TIMESTAMPTZ := now();
  v_marked_at   TIMESTAMPTZ;
  v_reopened_at TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Cannot set status for another user' USING ERRCODE = 'P0001';
  END IF;

  IF p_status NOT IN ('unknown', 'partial', 'complete') THEN
    RAISE EXCEPTION 'Invalid status: %', p_status USING ERRCODE = 'P0002';
  END IF;

  -- Lock existing row if it exists.
  SELECT * INTO v_existing
  FROM public.daily_log_status
  WHERE user_id = p_user_id AND logged_date = p_date
  FOR UPDATE;

  IF p_status = 'complete' THEN
    -- (Re)marking complete: stamp now; preserve existing reopened_at.
    v_marked_at   := v_now;
    v_reopened_at := v_existing.reopened_at;
  ELSE
    -- Preserve marked_complete_at as audit trail of prior completion.
    v_marked_at := v_existing.marked_complete_at;
    -- Record the reopening if transitioning from complete.
    IF v_existing.status = 'complete' THEN
      v_reopened_at := v_now;
    ELSE
      v_reopened_at := v_existing.reopened_at;
    END IF;
  END IF;

  INSERT INTO public.daily_log_status (
    user_id, logged_date, status, marked_complete_at, reopened_at, updated_at
  ) VALUES (
    p_user_id, p_date, p_status, v_marked_at, v_reopened_at, v_now
  )
  ON CONFLICT (user_id, logged_date) DO UPDATE
    SET status             = EXCLUDED.status,
        marked_complete_at = EXCLUDED.marked_complete_at,
        reopened_at        = EXCLUDED.reopened_at,
        updated_at         = EXCLUDED.updated_at;

  RETURN (
    SELECT jsonb_build_object(
      'id',                 id,
      'user_id',            user_id,
      'logged_date',        logged_date,
      'status',             status,
      'marked_complete_at', marked_complete_at,
      'reopened_at',        reopened_at,
      'created_at',         created_at,
      'updated_at',         updated_at
    )
    FROM public.daily_log_status
    WHERE user_id = p_user_id AND logged_date = p_date
  );
END;
$$;
