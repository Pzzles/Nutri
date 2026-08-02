-- Allow fn_start_goal_phase_v2 to build a supersession chain atomically.
--
-- The function marks the existing phase with the UUID of its replacement
-- before inserting the replacement row. The reference is valid by transaction
-- commit, so this self-referencing FK must be deferred until then.

ALTER TABLE public.goal_phases
  DROP CONSTRAINT IF EXISTS goal_phases_superseded_by_fkey;

ALTER TABLE public.goal_phases
  ADD CONSTRAINT goal_phases_superseded_by_fkey
  FOREIGN KEY (superseded_by)
  REFERENCES public.goal_phases(id)
  ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;
