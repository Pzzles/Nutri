-- 0026_goal_feedback_assessment_v2.sql
--
-- Phase 8 hotfix: add missing snapshot columns to goal_feedback_assessments.
--
-- Changes (ADD COLUMN only — forward-only, non-destructive):
--   • current_rate_lower_kg / current_rate_upper_kg   — P6 CI bounds for current evidence
--   • previous_rate_lower_kg / previous_rate_upper_kg — P6 CI bounds for historical evidence
--   • suggested_adjustment_kcal                        — signed canonical adjustment
--   • proposed_target_kcal                             — proposed daily calorie target
--   • adjustment_blocked_reason_codes                  — JSONB array of block codes
--   • maintenance_drift_direction                      — 'up' | 'down' | null
--   • current_official_weight_kg                       — most-recent official weight at assessment time
--   • current_target_calories                          — calorie target from the snapshot
--
-- All new columns are nullable — existing rows retain NULL for every new column.
-- RLS policies, indexes, and constraints from 0025 are preserved unchanged.
-- The existing upsert conflict key (user_id, goal_phase_id, assessed_date) is unchanged.

-- ── Rate CI bounds ───────────────────────────────────────────────────────────

ALTER TABLE public.goal_feedback_assessments
  ADD COLUMN IF NOT EXISTS current_rate_lower_kg   NUMERIC(8,6),
  ADD COLUMN IF NOT EXISTS current_rate_upper_kg   NUMERIC(8,6),
  ADD COLUMN IF NOT EXISTS previous_rate_lower_kg  NUMERIC(8,6),
  ADD COLUMN IF NOT EXISTS previous_rate_upper_kg  NUMERIC(8,6);

-- ── Canonical signed adjustment fields ───────────────────────────────────────

ALTER TABLE public.goal_feedback_assessments
  ADD COLUMN IF NOT EXISTS suggested_adjustment_kcal        NUMERIC(6,1),
  ADD COLUMN IF NOT EXISTS proposed_target_kcal             NUMERIC(7,1),
  ADD COLUMN IF NOT EXISTS adjustment_blocked_reason_codes  JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS maintenance_drift_direction       TEXT;

ALTER TABLE public.goal_feedback_assessments
  ADD CONSTRAINT IF NOT EXISTS chk_gfa_drift_direction
    CHECK (maintenance_drift_direction IS NULL
           OR maintenance_drift_direction IN ('up', 'down'));

-- ── Safety snapshot columns ───────────────────────────────────────────────────

ALTER TABLE public.goal_feedback_assessments
  ADD COLUMN IF NOT EXISTS current_official_weight_kg  NUMERIC(6,3),
  ADD COLUMN IF NOT EXISTS current_target_calories     NUMERIC(7,1);
