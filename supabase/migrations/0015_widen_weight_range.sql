-- 0015_widen_weight_range.sql
--
-- Widen weight ranges from 20-300 to 1-500 on weight_logs and goal_phases.
-- The 20-300 range is too narrow and prevents logging valid edge-case weights.

-- weight_logs: inline check auto-named by PostgreSQL
ALTER TABLE public.weight_logs
  DROP CONSTRAINT IF EXISTS weight_logs_weight_kg_check;
ALTER TABLE public.weight_logs
  ADD CONSTRAINT weight_logs_weight_kg_check
    CHECK (weight_kg >= 1 AND weight_kg <= 500);

-- goal_phases: starting weight
ALTER TABLE public.goal_phases
  DROP CONSTRAINT chk_starting_weight_range;
ALTER TABLE public.goal_phases
  ADD CONSTRAINT chk_starting_weight_range
    CHECK (starting_weight_kg BETWEEN 1 AND 500);

-- goal_phases: target weight
ALTER TABLE public.goal_phases
  DROP CONSTRAINT chk_target_weight_range;
ALTER TABLE public.goal_phases
  ADD CONSTRAINT chk_target_weight_range
    CHECK (target_weight_kg IS NULL OR target_weight_kg BETWEEN 1 AND 500);
