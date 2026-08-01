-- 0023_adaptive_maintenance.sql
--
-- Phase 7: Adaptive Maintenance Estimation
--
-- Changes:
--   1. Extend daily_log_status.status to include 'fasting' and 'probably_complete'
--      so users can explicitly mark zero-calorie fasting days and the system can
--      flag provisionally-complete days for user confirmation.
--   2. Update fn_set_daily_log_status to accept the new statuses.
--   3. Create maintenance_estimate_snapshots — immutable, user-scoped, auditable.
--
-- Design decisions:
--   • fasting is user-set (explicit action), never inferred from an empty day.
--   • probably_complete is set by the UI/server-side logic after heuristic
--     inspection; it can be upgraded to complete or demoted to partial.
--   • maintenance_estimate_snapshots are write-once (no UPDATE/DELETE via RLS).
--     Changing meals, weights, profiles, or algorithm versions after saving
--     cannot retroactively alter a snapshot.
--   • The save endpoint re-calculates before writing; frontend-supplied numbers
--     are ignored.

-- ─── 1. Extend daily_log_status status ───────────────────────────────────────

-- Drop the existing CHECK constraint and recreate it with the new values.
-- PostgreSQL does not support ALTER CONSTRAINT for check constraints; we must
-- drop and re-add via ALTER TABLE.

ALTER TABLE public.daily_log_status
  DROP CONSTRAINT IF EXISTS daily_log_status_status_check;

ALTER TABLE public.daily_log_status
  ADD CONSTRAINT daily_log_status_status_check
    CHECK (status IN ('unknown', 'partial', 'complete', 'fasting', 'probably_complete'));

-- ─── 2. Update fn_set_daily_log_status ───────────────────────────────────────
--
-- Accept 'fasting' and 'probably_complete' in addition to the three original
-- values.  Fasting days are treated like complete (stamp marked_complete_at)
-- because the user is affirmatively saying "I logged this day as intentional
-- zero intake."

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

  IF p_status NOT IN ('unknown', 'partial', 'complete', 'fasting', 'probably_complete') THEN
    RAISE EXCEPTION 'Invalid status: %', p_status USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_existing
  FROM public.daily_log_status
  WHERE user_id = p_user_id AND logged_date = p_date
  FOR UPDATE;

  -- complete and fasting both stamp marked_complete_at (user affirmed the day).
  IF p_status IN ('complete', 'fasting') THEN
    v_marked_at   := v_now;
    v_reopened_at := v_existing.reopened_at;
  ELSE
    v_marked_at := v_existing.marked_complete_at;
    IF v_existing.status IN ('complete', 'fasting') THEN
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
  ON CONFLICT (user_id, logged_date)
  DO UPDATE SET
    status             = EXCLUDED.status,
    marked_complete_at = EXCLUDED.marked_complete_at,
    reopened_at        = EXCLUDED.reopened_at,
    updated_at         = EXCLUDED.updated_at;

  RETURN (
    SELECT to_jsonb(r)
    FROM public.daily_log_status r
    WHERE user_id = p_user_id AND logged_date = p_date
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_set_daily_log_status TO authenticated, service_role;

-- ─── 3. maintenance_estimate_snapshots ───────────────────────────────────────
--
-- An immutable record of a Phase 7 adaptive-maintenance estimate at a point
-- in time.  The server re-calculates before writing; the frontend never supplies
-- calculated values.
--
-- Idempotency: if the user saves an estimate for the same goal phase on the
-- same calendar day, we upsert (update the single row rather than growing an
-- unbounded history of same-day saves).  The unique index on
-- (user_id, goal_phase_id, analysis_window_start, analysis_window_end) is the
-- idempotency key.

CREATE TABLE public.maintenance_estimate_snapshots (
  id                              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                         UUID          NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- ── Goal phase provenance ────────────────────────────────────────────────────
  goal_phase_id                   UUID          NOT NULL REFERENCES public.goal_phases(id) ON DELETE CASCADE,
  goal_mode                       TEXT          NOT NULL,
  goal_phase_started_at           TIMESTAMPTZ   NOT NULL,

  -- ── Calculation timestamp ────────────────────────────────────────────────────
  calculated_at                   TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- ── Analysis window ─────────────────────────────────────────────────────────
  analysis_window_start           DATE          NOT NULL,
  analysis_window_end             DATE          NOT NULL,
  analysis_calendar_days          INTEGER       NOT NULL,
  selected_weight_window_days     INTEGER       NOT NULL,
  timezone                        TEXT          NOT NULL,

  -- ── Nutrition summary ────────────────────────────────────────────────────────
  eligible_nutrition_day_count    INTEGER       NOT NULL,
  probably_complete_day_count     INTEGER       NOT NULL DEFAULT 0,
  incomplete_day_count            INTEGER       NOT NULL DEFAULT 0,
  not_logged_day_count            INTEGER       NOT NULL DEFAULT 0,
  eligible_nutrition_coverage     NUMERIC(6,5)  NOT NULL, -- fraction 0..1
  average_intake_kcal             NUMERIC(8,2)  NOT NULL,

  -- ── Weight trend (frozen at calculation time) ────────────────────────────────
  weekly_rate_kg                  NUMERIC(8,6)  NOT NULL,
  rate_lower_kg                   NUMERIC(8,6),
  rate_upper_kg                   NUMERIC(8,6),
  weight_trend_confidence         TEXT          NOT NULL,

  -- ── Observed maintenance estimate ────────────────────────────────────────────
  observed_maintenance_kcal       NUMERIC(8,2)  NOT NULL,
  maintenance_lower_kcal          NUMERIC(8,2),
  maintenance_upper_kcal          NUMERIC(8,2),

  -- ── Comparison values ────────────────────────────────────────────────────────
  equation_estimated_tdee_kcal    NUMERIC(8,2),
  manual_maintenance_override_kcal NUMERIC(8,2),
  effective_phase_maintenance_kcal NUMERIC(8,2),
  effective_phase_maintenance_source TEXT,

  -- ── Overall quality and confidence ──────────────────────────────────────────
  status                          TEXT          NOT NULL,
  confidence                      TEXT          NOT NULL,

  -- ── Warnings and algorithm provenance ───────────────────────────────────────
  warnings                        JSONB         NOT NULL DEFAULT '[]',
  algorithm_versions              JSONB         NOT NULL DEFAULT '{}',
  input_provenance                JSONB         NOT NULL DEFAULT '{}',

  -- ── Immutability timestamp ───────────────────────────────────────────────────
  created_at                      TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- ── Constraints ─────────────────────────────────────────────────────────────
  CONSTRAINT chk_mes_goal_mode
    CHECK (goal_mode IN ('cut', 'maintenance', 'bulk')),
  CONSTRAINT chk_mes_status
    CHECK (status IN ('usable', 'provisional', 'insufficient', 'stale', 'no_active_goal_phase', 'insufficient_weight_data')),
  CONSTRAINT chk_mes_confidence
    CHECK (confidence IN ('low', 'medium', 'high')),
  CONSTRAINT chk_mes_window_order
    CHECK (analysis_window_end >= analysis_window_start),
  CONSTRAINT chk_mes_coverage_range
    CHECK (eligible_nutrition_coverage >= 0 AND eligible_nutrition_coverage <= 1),
  CONSTRAINT chk_mes_weight_confidence
    CHECK (weight_trend_confidence IN ('low', 'medium', 'high'))
);

-- Idempotency: one saved estimate per (user, phase, window).
CREATE UNIQUE INDEX idx_mes_idempotency
  ON public.maintenance_estimate_snapshots (user_id, goal_phase_id, analysis_window_start, analysis_window_end);

CREATE INDEX idx_mes_user_id
  ON public.maintenance_estimate_snapshots (user_id, created_at DESC);

CREATE INDEX idx_mes_goal_phase_id
  ON public.maintenance_estimate_snapshots (goal_phase_id);

ALTER TABLE public.maintenance_estimate_snapshots ENABLE ROW LEVEL SECURITY;

-- Users can read their own snapshots.
CREATE POLICY mes_select_own
  ON public.maintenance_estimate_snapshots FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own snapshots (via service role in RPC).
CREATE POLICY mes_insert_own
  ON public.maintenance_estimate_snapshots FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- No UPDATE or DELETE: snapshots are immutable.
-- (Idempotency updates go through service_role which bypasses RLS.)

-- ─── 4. fn_get_daily_meal_totals ─────────────────────────────────────────────
--
-- Returns per-day calorie totals from immutable meal snapshots within a date
-- range for a given user.  Called by the adaptive-maintenance edge function to
-- aggregate eligible nutrition days without N+1 queries.
--
-- Only days with at least one meal item are returned; days with no meals are
-- absent from the result (the caller handles them as 0-kcal days when they
-- carry an explicit 'fasting' status).

CREATE OR REPLACE FUNCTION public.fn_get_daily_meal_totals(
  p_user_id  UUID,
  p_start    DATE,
  p_end      DATE
)
RETURNS TABLE (
  logged_date  DATE,
  total_kcal   NUMERIC,
  meal_count   BIGINT,
  item_count   BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.logged_date,
    COALESCE(SUM(mi.calories), 0)   AS total_kcal,
    COUNT(DISTINCT m.id)            AS meal_count,
    COUNT(mi.id)                    AS item_count
  FROM public.meals m
  JOIN public.meal_items mi ON mi.meal_id = m.id
  WHERE m.user_id    = p_user_id
    AND m.logged_date >= p_start
    AND m.logged_date <= p_end
  GROUP BY m.logged_date
  ORDER BY m.logged_date;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_daily_meal_totals TO authenticated, service_role;
