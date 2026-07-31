-- 0014_fix_bulk_rate_range.sql
--
-- chk_rate_range (added in 0009) only allows target_change_kg_per_week <= 0,
-- which blocks bulk phases that require a positive rate.
-- Migration 0012 added the bulk mode and chk_bulk_rate_positive but missed
-- widening this constraint.

ALTER TABLE public.goal_phases
  DROP CONSTRAINT chk_rate_range;

ALTER TABLE public.goal_phases
  ADD CONSTRAINT chk_rate_range
    CHECK (target_change_kg_per_week IS NULL
           OR (target_change_kg_per_week >= -2.0 AND target_change_kg_per_week <= 2.0));
