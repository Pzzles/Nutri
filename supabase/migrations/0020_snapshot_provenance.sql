-- 0020_snapshot_provenance.sql
--
-- Phase 5 data-contract addition: freezes the provenance of every
-- calculation input so each snapshot is fully self-describing.
--
-- New columns on calorie_target_snapshots:
--   weight_measured_at  TIMESTAMPTZ — timestamp of the scale reading used,
--                                     frozen even if weight_log is later nulled.
--   weight_log_source   TEXT        — source tag from weight_logs
--                                     (e.g. 'manual', 'sync', 'import').
--   input_provenance    JSONB       — source-type map for all inputs:
--                                     measured / user_selected /
--                                     manually_estimated / calculated.
--
-- fn_start_goal_phase_v2 is rebuilt to accept and store the three new fields.
-- PostgreSQL does not allow CREATE OR REPLACE when the parameter list changes,
-- so we DROP and recreate. All new parameters carry DEFAULT values; existing
-- callers that use named parameters continue to work unchanged.

ALTER TABLE public.calorie_target_snapshots
  ADD COLUMN weight_measured_at   TIMESTAMPTZ,
  ADD COLUMN weight_log_source    TEXT,
  ADD COLUMN input_provenance     JSONB NOT NULL DEFAULT '{}';

-- ─── Rebuild fn_start_goal_phase_v2 ──────────────────────────────────────────

DROP FUNCTION IF EXISTS public.fn_start_goal_phase_v2 CASCADE;

CREATE FUNCTION public.fn_start_goal_phase_v2(
  -- ── Identity ─────────────────────────────────────────────────────────────
  p_user_id                       UUID,

  -- ── Goal phase fields ────────────────────────────────────────────────────
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
  p_config_versions               JSONB           DEFAULT '{}',

  -- ── Provenance fields (added in migration 0020) ───────────────────────────
  p_weight_measured_at            TIMESTAMPTZ     DEFAULT NULL,
  p_weight_log_source             TEXT            DEFAULT NULL,
  p_input_provenance              JSONB           DEFAULT '{}'
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

  -- ── Step 1: transition any existing active phase ───────────────────────────
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
      warning_codes, aggressive_rate_acknowledged, config_versions,
      weight_measured_at, weight_log_source, input_provenance
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
      COALESCE(p_config_versions, '{}'::JSONB),
      p_weight_measured_at, p_weight_log_source,
      COALESCE(p_input_provenance, '{}'::JSONB)
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
