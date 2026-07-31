-- 0022_fix_goal_phase_insert_order.sql
--
-- Fixes a circular FK violation in fn_start_goal_phase_v2.
--
-- The previous implementation inserted calorie_target_snapshots (with
-- goal_phase_id = v_new_phase_id) BEFORE inserting the goal_phases row.
-- PostgreSQL checks immediate FK constraints after each statement, so the
-- snapshot INSERT failed with "23503: goal_phase_id not present in goal_phases".
--
-- Fix: insert goal_phases first (snapshot_id NULL), then the snapshot
-- (which can now reference the existing phase), then UPDATE goal_phases to
-- set snapshot_id.  This breaks both legs of the circular dependency.

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

  -- ── Step 2: insert the goal phase first (snapshot_id NULL for now) ─────────
  -- Inserting goal_phases before calorie_target_snapshots so the snapshot can
  -- reference goal_phase_id without violating the FK constraint.
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
    NULL, p_manual_maintenance_kcal  -- snapshot_id set after snapshot INSERT below
  );

  -- ── Step 3: insert the snapshot (now goal_phase_id can reference step 2) ───
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

    -- ── Step 4: back-fill snapshot_id on the phase just created ────────────
    UPDATE public.goal_phases
    SET snapshot_id = v_snapshot_id
    WHERE id = v_new_phase_id;
  END IF;

  RETURN jsonb_build_object(
    'phase_id',    v_new_phase_id,
    'snapshot_id', v_snapshot_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_start_goal_phase_v2 TO authenticated, service_role;
