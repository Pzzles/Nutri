-- 0025_goal_feedback_assessments.sql
--
-- Phase 8: Plateau Detection and Cautious Goal Feedback
--
-- Changes:
--   1. Create goal_feedback_assessments — immutable, user-scoped, auditable.
--      One saved assessment per (user, goal_phase, day).
--
-- Design decisions:
--   • goal_feedback_assessments are write-once per (user_id, goal_phase_id,
--     assessed_date).  The idempotency key prevents unbounded history of
--     same-day saves.  The save endpoint recalculates before writing;
--     frontend-supplied calculated values are ignored.
--   • Saving does not alter the goal phase, calorie target, or any other row.
--   • Advisory calorie adjustments are stored for audit purposes only.
--     No row is mutated as a result of storing the advisory value.
--   • RLS: users can read and insert their own rows; no UPDATE or DELETE
--     via user sessions (service_role handles upserts).

-- ─── goal_feedback_assessments ──────────────────────────────────────────────

CREATE TABLE public.goal_feedback_assessments (
  id                              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                         UUID          NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- ── Goal phase provenance ───────────────────────────────────────────────────
  goal_phase_id                   UUID          NOT NULL REFERENCES public.goal_phases(id) ON DELETE CASCADE,
  goal_mode                       TEXT          NOT NULL,
  goal_phase_started_at           TIMESTAMPTZ   NOT NULL,
  goal_target_rate_kg_per_week    NUMERIC(5,3),  -- null when no target set

  -- ── Assessment timing ───────────────────────────────────────────────────────
  assessed_at                     TIMESTAMPTZ   NOT NULL,
  assessed_date                   DATE          NOT NULL GENERATED ALWAYS AS ((assessed_at AT TIME ZONE 'UTC')::DATE) STORED,

  -- ── Progress state ──────────────────────────────────────────────────────────
  progress_state                  TEXT          NOT NULL,
  reason_codes                    JSONB         NOT NULL DEFAULT '[]',
  feedback_action                 TEXT          NOT NULL,

  -- ── Advisory calorie adjustment ─────────────────────────────────────────────
  advisory_calorie_adjustment_kcal NUMERIC(6,1),              -- null = not applicable
  advisory_adjustment_direction    TEXT,                       -- 'increase' | 'decrease'

  -- ── Goal attainment ratio ───────────────────────────────────────────────────
  goal_attainment_ratio           NUMERIC(8,4),               -- null for maintenance

  -- ── Current P6 evidence ─────────────────────────────────────────────────────
  current_p6_status               TEXT          NOT NULL,
  current_p6_confidence           TEXT          NOT NULL,
  current_p6_weekly_rate_kg       NUMERIC(8,6),

  -- ── Current P7 evidence ─────────────────────────────────────────────────────
  current_p7_status               TEXT,
  current_p7_confidence           TEXT,
  current_p7_coverage_fraction    NUMERIC(6,5),

  -- ── Historical P6 evidence (assessedAt − 14 days) ───────────────────────────
  historical_p6_status            TEXT,
  historical_p6_confidence        TEXT,
  historical_p6_weekly_rate_kg    NUMERIC(8,6),

  -- ── Historical P7 evidence ──────────────────────────────────────────────────
  historical_p7_status            TEXT,
  historical_p7_confidence        TEXT,
  historical_p7_coverage_fraction NUMERIC(6,5),

  -- ── Algorithm provenance ────────────────────────────────────────────────────
  algorithm_versions              JSONB         NOT NULL DEFAULT '{}',
  warnings                        JSONB         NOT NULL DEFAULT '[]',
  limitations                     JSONB         NOT NULL DEFAULT '[]',

  -- ── Immutability timestamp ───────────────────────────────────────────────────
  created_at                      TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- ── Constraints ─────────────────────────────────────────────────────────────
  CONSTRAINT chk_gfa_goal_mode
    CHECK (goal_mode IN ('cut', 'maintenance', 'bulk')),

  CONSTRAINT chk_gfa_progress_state
    CHECK (progress_state IN (
      'no_active_goal_phase', 'insufficient_data', 'stale_data',
      'on_track', 'slower_than_planned', 'faster_than_planned',
      'plateau_candidate', 'likely_plateau', 'opposite_direction',
      'maintenance_stable', 'maintenance_drift'
    )),

  CONSTRAINT chk_gfa_feedback_action
    CHECK (feedback_action IN (
      'start_goal_phase', 'collect_more_data', 'keep_current_plan',
      'review_goal_assumptions', 'consider_less_aggressive_goal',
      'consider_small_calorie_adjustment', 'review_maintenance_drift'
    )),

  CONSTRAINT chk_gfa_p6_confidence
    CHECK (current_p6_confidence IN ('low', 'medium', 'high')),

  CONSTRAINT chk_gfa_adj_direction
    CHECK (advisory_adjustment_direction IS NULL
           OR advisory_adjustment_direction IN ('increase', 'decrease')),

  CONSTRAINT chk_gfa_coverage_range
    CHECK (current_p7_coverage_fraction IS NULL
           OR (current_p7_coverage_fraction >= 0 AND current_p7_coverage_fraction <= 1))
);

-- Idempotency: one saved assessment per (user, phase, day).
CREATE UNIQUE INDEX idx_gfa_idempotency
  ON public.goal_feedback_assessments (user_id, goal_phase_id, assessed_date);

CREATE INDEX idx_gfa_user_id
  ON public.goal_feedback_assessments (user_id, created_at DESC);

CREATE INDEX idx_gfa_goal_phase_id
  ON public.goal_feedback_assessments (goal_phase_id);

ALTER TABLE public.goal_feedback_assessments ENABLE ROW LEVEL SECURITY;

-- Users can read their own assessments.
CREATE POLICY gfa_select_own
  ON public.goal_feedback_assessments FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own assessments (via service role in the edge function).
CREATE POLICY gfa_insert_own
  ON public.goal_feedback_assessments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- No UPDATE or DELETE via user RLS.
-- (Service_role handles idempotency upserts which bypass RLS.)
