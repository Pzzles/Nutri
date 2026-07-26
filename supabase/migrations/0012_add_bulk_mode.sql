-- 0012_add_bulk_mode.sql
--
-- Adds 'bulk' as a valid goal phase mode (caloric surplus for muscle gain).
-- Sign convention: target_change_kg_per_week is positive for bulk (weight gain).

-- ── Extend mode constraint ────────────────────────────────────────────────────

ALTER TABLE public.goal_phases
  DROP CONSTRAINT chk_goal_phase_mode;

ALTER TABLE public.goal_phases
  ADD CONSTRAINT chk_goal_phase_mode
    CHECK (mode IN ('cut', 'maintenance', 'bulk'));

-- ── Add bulk rate constraint ──────────────────────────────────────────────────
-- Bulk phases must have a positive rate when one is provided.

ALTER TABLE public.goal_phases
  ADD CONSTRAINT chk_bulk_rate_positive
    CHECK (mode <> 'bulk' OR target_change_kg_per_week IS NULL OR target_change_kg_per_week > 0);
