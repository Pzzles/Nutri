-- 0019_calculation_snapshots.sql
--
-- Adds immutable calorie-target calculation snapshots for Phase 5.
--
-- Design decisions:
--   • Snapshots are write-once. No UPDATE or DELETE is permitted via RLS.
--     Changing a profile, weight log, or activity level later cannot alter
--     the values that were used when a goal phase was started.
--   • goal_phases gains snapshot_id (nullable FK) and manual_maintenance_kcal.
--   • fn_start_goal_phase is extended to fn_start_goal_phase_v2 which accepts
--     the full calculation context and atomically creates the snapshot + phase.
--     The v1 function is retained for backward compatibility with existing tests.
--   • The circular FK (snapshot → phase AND phase → snapshot) is resolved by
--     making calorie_target_snapshots.goal_phase_id nullable and set in the
--     same transaction immediately after the phase INSERT.

-- ─── calorie_target_snapshots ────────────────────────────────────────────────

CREATE TABLE public.calorie_target_snapshots (
  id                              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                         UUID          NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Back-reference: set in the same DB transaction as the goal phase INSERT.
  goal_phase_id                   UUID          REFERENCES public.goal_phases(id) ON DELETE CASCADE,

  -- ── Algorithm identity ──────────────────────────────────────────────────────
  algorithm_name                  TEXT          NOT NULL,   -- e.g. 'mifflin_st_jeor'
  algorithm_version               TEXT          NOT NULL,   -- e.g. 'mifflin_st_jeor_v1'
  activity_multiplier_version     TEXT          NOT NULL,   -- e.g. 'activity_multiplier_v1'
  calculation_timestamp           TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- ── Inputs frozen at calculation time ───────────────────────────────────────
  profile_birth_date              DATE          NOT NULL,
  equation_sex                    TEXT          NOT NULL,
  height_cm                       NUMERIC(5,1)  NOT NULL,
  official_weight_kg              NUMERIC(6,2)  NOT NULL,
  weight_log_id                   UUID          REFERENCES public.weight_logs(id) ON DELETE SET NULL,
  age_years                       SMALLINT      NOT NULL,
  activity_level                  TEXT          NOT NULL,
  activity_multiplier             NUMERIC(5,3)  NOT NULL,

  -- ── Calculation outputs ──────────────────────────────────────────────────────
  calculated_bmr_kcal             NUMERIC(8,2)  NOT NULL,
  calculated_tdee_kcal            NUMERIC(8,2)  NOT NULL,

  -- ── Maintenance inputs ───────────────────────────────────────────────────────
  manual_maintenance_kcal         NUMERIC(7,1),            -- null = no override
  effective_maintenance_kcal      NUMERIC(7,1)  NOT NULL,
  maintenance_source              TEXT          NOT NULL,  -- 'equation_estimate' | 'manual_override'

  -- ── Goal inputs ──────────────────────────────────────────────────────────────
  goal_mode                       TEXT          NOT NULL,
  requested_rate_kg_per_week      NUMERIC(4,2)  NOT NULL DEFAULT 0,
  daily_adjustment_kcal           NUMERIC(8,2)  NOT NULL DEFAULT 0,
  raw_target_kcal                 NUMERIC(7,1)  NOT NULL,
  final_target_kcal               NUMERIC(7,1)  NOT NULL,

  -- ── Warnings and acknowledgements ───────────────────────────────────────────
  warning_codes                   JSONB         NOT NULL DEFAULT '[]',
  aggressive_rate_acknowledged    BOOLEAN       NOT NULL DEFAULT false,

  -- ── Configuration versions (frozen at creation) ─────────────────────────────
  config_versions                 JSONB         NOT NULL DEFAULT '{}',

  created_at                      TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- ── Constraints ─────────────────────────────────────────────────────────────
  CONSTRAINT chk_snapshot_equation_sex
    CHECK (equation_sex IN ('male', 'female')),
  CONSTRAINT chk_snapshot_maintenance_source
    CHECK (maintenance_source IN ('equation_estimate', 'manual_override')),
  CONSTRAINT chk_snapshot_goal_mode
    CHECK (goal_mode IN ('cut', 'maintenance', 'bulk')),
  CONSTRAINT chk_snapshot_weight_positive
    CHECK (official_weight_kg > 0),
  CONSTRAINT chk_snapshot_height_positive
    CHECK (height_cm > 0),
  CONSTRAINT chk_snapshot_age_adult
    CHECK (age_years >= 18),
  CONSTRAINT chk_snapshot_bmr_positive
    CHECK (calculated_bmr_kcal > 0),
  CONSTRAINT chk_snapshot_tdee_positive
    CHECK (calculated_tdee_kcal > 0),
  CONSTRAINT chk_snapshot_maintenance_positive
    CHECK (effective_maintenance_kcal > 0),
  CONSTRAINT chk_snapshot_target_above_floor
    CHECK (final_target_kcal >= 1000)
);

CREATE INDEX idx_snapshots_user_id
  ON public.calorie_target_snapshots (user_id, created_at DESC);

CREATE INDEX idx_snapshots_goal_phase_id
  ON public.calorie_target_snapshots (goal_phase_id)
  WHERE goal_phase_id IS NOT NULL;

ALTER TABLE public.calorie_target_snapshots ENABLE ROW LEVEL SECURITY;

-- Read-own: users can view their own snapshots.
CREATE POLICY snapshots_select_own
  ON public.calorie_target_snapshots FOR SELECT
  USING (auth.uid() = user_id);

-- Insert-own: users can create their own snapshots (via service role in RPC).
CREATE POLICY snapshots_insert_own
  ON public.calorie_target_snapshots FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- No UPDATE or DELETE: snapshots are immutable.
-- (The goal_phase_id back-reference is set by the RPC via service role,
--  which bypasses RLS.)

-- ─── Extend goal_phases ──────────────────────────────────────────────────────

ALTER TABLE public.goal_phases
  ADD COLUMN snapshot_id           UUID REFERENCES public.calorie_target_snapshots(id) ON DELETE SET NULL,
  ADD COLUMN manual_maintenance_kcal NUMERIC(7,1);

CREATE INDEX idx_goal_phases_snapshot_id
  ON public.goal_phases (snapshot_id)
  WHERE snapshot_id IS NOT NULL;

-- ─── fn_start_goal_phase_v2 ──────────────────────────────────────────────────
--
-- Atomically creates a calorie_target_snapshot and a goal_phase in one
-- transaction. Called from the start-goal-phase edge function after the
-- server-side energy calculation is complete.
--
-- The v1 function is unchanged (used by existing tests and the legacy path).
-- v2 supersedes v1 for all Phase 5+ calls.

CREATE OR REPLACE FUNCTION public.fn_start_goal_phase_v2(
  -- ── Identity ─────────────────────────────────────────────────────────────
  p_user_id                       UUID,

  -- ── Goal phase fields (same as v1) ───────────────────────────────────────
  p_mode                          TEXT,
  p_started_at                    TIMESTAMPTZ,
  p_starting_weight_kg            NUMERIC,
  p_starting_weight_source        TEXT,
  p_target_weight_kg              NUMERIC         DEFAULT NULL,
  p_target_change_kg_per_week     NUMERIC         DEFAULT NULL,
  p_target_calories               NUMERIC         DEFAULT NULL,
  p_target_protein_g              NUMERIC         DEFAULT NULL,
  p_target_carbs_g                NUMERIC         DEFAULT NULL,
  p_target_fat_g                  NUMERIC         DEFAULT NULL,
  p_target_fibre_g                NUMERIC         DEFAULT NULL,
  p_transition                    TEXT            DEFAULT NULL,
  p_manual_maintenance_kcal       NUMERIC         DEFAULT NULL,

  -- ── Snapshot fields ───────────────────────────────────────────────────────
  p_algorithm_name                TEXT            DEFAULT 'mifflin_st_jeor',
  p_algorithm_version             TEXT            DEFAULT 'mifflin_st_jeor_v1',
  p_activity_multiplier_version   TEXT            DEFAULT 'activity_multiplier_v1',
  p_calculation_timestamp         TIMESTAMPTZ     DEFAULT now(),
  p_profile_birth_date            DATE            DEFAULT NULL,
  p_equation_sex                  TEXT            DEFAULT NULL,
  p_height_cm                     NUMERIC         DEFAULT NULL,
  p_official_weight_kg            NUMERIC         DEFAULT NULL,
  p_weight_log_id                 UUID            DEFAULT NULL,
  p_age_years                     SMALLINT        DEFAULT NULL,
  p_activity_level                TEXT            DEFAULT NULL,
  p_activity_multiplier           NUMERIC         DEFAULT NULL,
  p_calculated_bmr_kcal           NUMERIC         DEFAULT NULL,
  p_calculated_tdee_kcal          NUMERIC         DEFAULT NULL,
  p_effective_maintenance_kcal    NUMERIC         DEFAULT NULL,
  p_maintenance_source            TEXT            DEFAULT 'equation_estimate',
  p_requested_rate_kg_per_week    NUMERIC         DEFAULT 0,
  p_daily_adjustment_kcal         NUMERIC         DEFAULT 0,
  p_raw_target_kcal               NUMERIC         DEFAULT NULL,
  p_final_target_kcal             NUMERIC         DEFAULT NULL,
  p_warning_codes                 JSONB           DEFAULT '[]',
  p_aggressive_rate_acknowledged  BOOLEAN         DEFAULT false,
  p_config_versions               JSONB           DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id   UUID;
  v_new_phase_id  UUID := gen_random_uuid();
  v_snapshot_id   UUID;
  v_has_snapshot  BOOLEAN;
BEGIN
  -- Defence-in-depth: reject cross-user calls when JWT is present.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Cannot start a phase for another user' USING ERRCODE = 'P0001';
  END IF;

  v_has_snapshot := (p_calculated_bmr_kcal IS NOT NULL
                     AND p_calculated_tdee_kcal IS NOT NULL
                     AND p_final_target_kcal IS NOT NULL
                     AND p_profile_birth_date IS NOT NULL
                     AND p_equation_sex IS NOT NULL
                     AND p_height_cm IS NOT NULL
                     AND p_age_years IS NOT NULL
                     AND p_activity_level IS NOT NULL
                     AND p_activity_multiplier IS NOT NULL
                     AND p_effective_maintenance_kcal IS NOT NULL);

  -- ── Step 1: transition any existing active phase (same logic as v1) ────────
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
          superseded_by = v_new_phase_id,
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

  -- ── Step 2: create the snapshot (if calculation data was supplied) ─────────
  IF v_has_snapshot THEN
    INSERT INTO public.calorie_target_snapshots (
      user_id, goal_phase_id,
      algorithm_name, algorithm_version, activity_multiplier_version,
      calculation_timestamp,
      profile_birth_date, equation_sex, height_cm,
      official_weight_kg, weight_log_id, age_years,
      activity_level, activity_multiplier,
      calculated_bmr_kcal, calculated_tdee_kcal,
      manual_maintenance_kcal, effective_maintenance_kcal, maintenance_source,
      goal_mode, requested_rate_kg_per_week, daily_adjustment_kcal,
      raw_target_kcal, final_target_kcal,
      warning_codes, aggressive_rate_acknowledged, config_versions
    ) VALUES (
      p_user_id, v_new_phase_id,
      p_algorithm_name, p_algorithm_version, p_activity_multiplier_version,
      p_calculation_timestamp,
      p_profile_birth_date, p_equation_sex, p_height_cm,
      p_official_weight_kg, p_weight_log_id, p_age_years,
      p_activity_level, p_activity_multiplier,
      p_calculated_bmr_kcal, p_calculated_tdee_kcal,
      p_manual_maintenance_kcal, p_effective_maintenance_kcal, p_maintenance_source,
      p_mode, COALESCE(p_requested_rate_kg_per_week, 0),
      COALESCE(p_daily_adjustment_kcal, 0),
      p_raw_target_kcal, p_final_target_kcal,
      COALESCE(p_warning_codes, '[]'::JSONB),
      COALESCE(p_aggressive_rate_acknowledged, false),
      COALESCE(p_config_versions, '{}'::JSONB)
    )
    RETURNING id INTO v_snapshot_id;
  END IF;

  -- ── Step 3: create the new goal phase ──────────────────────────────────────
  INSERT INTO public.goal_phases (
    id, user_id, mode, status, started_at,
    starting_weight_kg, starting_weight_source,
    target_weight_kg, target_change_kg_per_week,
    target_calories, target_protein_g, target_carbs_g, target_fat_g, target_fibre_g,
    snapshot_id, manual_maintenance_kcal
  ) VALUES (
    v_new_phase_id, p_user_id, p_mode, 'active', p_started_at,
    p_starting_weight_kg, p_starting_weight_source,
    p_target_weight_kg, p_target_change_kg_per_week,
    p_target_calories, p_target_protein_g, p_target_carbs_g, p_target_fat_g, p_target_fibre_g,
    v_snapshot_id, p_manual_maintenance_kcal
  );

  RETURN jsonb_build_object(
    'phase_id',    v_new_phase_id,
    'snapshot_id', v_snapshot_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_start_goal_phase_v2 TO authenticated, service_role;
