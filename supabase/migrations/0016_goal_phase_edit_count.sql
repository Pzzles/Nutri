-- 0016_goal_phase_edit_count.sql
--
-- Tracks how many times an active phase's mutable targets have been edited
-- via update-goal-phase. The edge function enforces the 2-edit cap; this
-- column is the authoritative counter so the limit survives re-deploys.

ALTER TABLE public.goal_phases
  ADD COLUMN IF NOT EXISTS edit_count INTEGER NOT NULL DEFAULT 0;
