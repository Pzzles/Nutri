-- Phase 10 remediation Gate 3: structured measurement context and versioned
-- protocol/change interpretation metadata. Historical rows remain unchanged.

ALTER TABLE public.anthropometric_sessions
  ADD COLUMN local_time TIME WITHOUT TIME ZONE,
  ADD COLUMN measurement_context_version TEXT,
  ADD COLUMN meal_timing TEXT,
  ADD COLUMN after_bathroom BOOLEAN,
  ADD COLUMN exercise_within_previous_12_hours BOOLEAN,
  ADD COLUMN measurement_assistance TEXT,
  ADD COLUMN clothing_level TEXT;

ALTER TABLE public.anthropometric_sessions
  DROP CONSTRAINT chk_anthropometric_session_data_contract,
  ADD CONSTRAINT chk_anthropometric_session_data_contract CHECK (
    data_contract_version IN (
      'anthropometry_data_contract_v2',
      'anthropometry_data_contract_v3',
      'anthropometry_data_contract_v4'
    )
  ),
  DROP CONSTRAINT chk_anthropometric_session_protocol,
  ADD CONSTRAINT chk_anthropometric_session_protocol CHECK (
    protocol_version ~ '^anthropometry_protocol_[a-z0-9_]{1,80}$'
  ),
  ADD CONSTRAINT chk_anthropometric_measurement_context CHECK (
    (measurement_context_version IS NULL AND local_time IS NULL
      AND meal_timing IS NULL AND after_bathroom IS NULL
      AND exercise_within_previous_12_hours IS NULL
      AND measurement_assistance IS NULL AND clothing_level IS NULL)
    OR
    (measurement_context_version = 'anthropometry_measurement_context_v1'
      AND meal_timing IN ('before_food', 'after_food', 'not_recorded')
      AND measurement_assistance IN ('self', 'assisted', 'not_recorded')
      AND clothing_level IN ('minimal', 'light', 'normal', 'other', 'not_recorded'))
  );

ALTER TABLE public.anthropometric_sessions
  DROP CONSTRAINT chk_anthropometric_session_lifecycle,
  ADD CONSTRAINT chk_anthropometric_session_lifecycle CHECK (
    (status = 'draft' AND logged_date IS NULL AND timezone IS NULL
      AND representative_algorithm_version IS NULL AND thresholds_version IS NULL
      AND idempotency_key IS NULL AND payload_hash IS NULL AND finalized_at IS NULL)
    OR
    (status = 'finalized' AND measured_at IS NOT NULL AND logged_date IS NOT NULL
      AND timezone IS NOT NULL AND idempotency_key IS NOT NULL
      AND payload_hash IS NOT NULL AND finalized_at IS NOT NULL AND (
        (representative_algorithm_version = 'anthropometry_representative_v1'
          AND thresholds_version = 'anthropometry_repeatability_thresholds_v1')
        OR
        (representative_algorithm_version IN ('anthropometry_representative_v2', 'anthropometry_representative_v3')
          AND thresholds_version = 'anthropometry_repeatability_thresholds_v2')
      ) AND (
        data_contract_version <> 'anthropometry_data_contract_v4'
        OR (measurement_context_version = 'anthropometry_measurement_context_v1'
          AND local_time IS NOT NULL)
      ))
  );

DROP FUNCTION public.fn_save_anthropometric_session(
  UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, JSONB, JSONB, DATE, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT
);

CREATE FUNCTION public.fn_save_anthropometric_session(
  p_user_id UUID, p_session_id UUID, p_status TEXT, p_measured_at TIMESTAMPTZ,
  p_notes TEXT, p_readings JSONB, p_representatives JSONB, p_logged_date DATE,
  p_timezone TEXT, p_local_time TIME, p_measurement_context_version TEXT,
  p_meal_timing TEXT, p_after_bathroom BOOLEAN,
  p_exercise_within_previous_12_hours BOOLEAN, p_measurement_assistance TEXT,
  p_clothing_level TEXT, p_idempotency_key TEXT, p_payload_hash TEXT,
  p_data_contract_version TEXT, p_protocol_version TEXT,
  p_representative_algorithm_version TEXT, p_thresholds_version TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.anthropometric_sessions%ROWTYPE;
  v_existing public.anthropometric_sessions%ROWTYPE;
  v_reading_site_count INTEGER;
  v_representative_site_count INTEGER;
BEGIN
  IF p_status NOT IN ('draft', 'finalized') THEN
    RAISE EXCEPTION 'ANTHROPOMETRIC_INVALID_STATUS' USING ERRCODE = '22023';
  END IF;
  IF p_data_contract_version <> 'anthropometry_data_contract_v4'
     OR p_protocol_version <> 'anthropometry_protocol_v1'
     OR p_measurement_context_version <> 'anthropometry_measurement_context_v1'
     OR p_meal_timing NOT IN ('before_food', 'after_food', 'not_recorded')
     OR p_measurement_assistance NOT IN ('self', 'assisted', 'not_recorded')
     OR p_clothing_level NOT IN ('minimal', 'light', 'normal', 'other', 'not_recorded') THEN
    RAISE EXCEPTION 'ANTHROPOMETRIC_UNSUPPORTED_VERSION_OR_CONTEXT' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_readings) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'ANTHROPOMETRIC_READINGS_MUST_BE_ARRAY' USING ERRCODE = '22023';
  END IF;

  IF p_status = 'finalized' THEN
    IF p_measured_at IS NULL OR p_logged_date IS NULL OR p_timezone IS NULL
       OR p_local_time IS NULL OR p_idempotency_key IS NULL OR p_payload_hash IS NULL
       OR p_representative_algorithm_version <> 'anthropometry_representative_v3'
       OR p_thresholds_version <> 'anthropometry_repeatability_thresholds_v2'
       OR jsonb_typeof(p_representatives) IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_readings) < 2 OR jsonb_array_length(p_representatives) < 1 THEN
      RAISE EXCEPTION 'ANTHROPOMETRIC_INCOMPLETE_FINALIZATION' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::TEXT || ':' || p_idempotency_key, 0));
    SELECT * INTO v_existing FROM public.anthropometric_sessions
     WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      IF v_existing.payload_hash = p_payload_hash THEN
        RETURN jsonb_build_object('session_id', v_existing.id, 'status', v_existing.status, 'replayed', true);
      END IF;
      RAISE EXCEPTION 'ANTHROPOMETRIC_IDEMPOTENCY_CONFLICT' USING ERRCODE = '23505';
    END IF;
  ELSE
    IF p_representatives IS NOT NULL OR p_logged_date IS NOT NULL OR p_timezone IS NOT NULL
       OR p_idempotency_key IS NOT NULL OR p_payload_hash IS NOT NULL
       OR p_representative_algorithm_version IS NOT NULL OR p_thresholds_version IS NOT NULL THEN
      RAISE EXCEPTION 'ANTHROPOMETRIC_DRAFT_HAS_FINAL_FIELDS' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_session_id IS NOT NULL THEN
    SELECT * INTO v_session FROM public.anthropometric_sessions
     WHERE id = p_session_id AND user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ANTHROPOMETRIC_SESSION_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    IF v_session.status <> 'draft' THEN RAISE EXCEPTION 'ANTHROPOMETRIC_SESSION_IMMUTABLE' USING ERRCODE = '55000'; END IF;
    UPDATE public.anthropometric_sessions SET measured_at = p_measured_at,
      notes = NULLIF(btrim(p_notes), ''), data_contract_version = p_data_contract_version,
      protocol_version = p_protocol_version, local_time = p_local_time,
      measurement_context_version = p_measurement_context_version,
      meal_timing = p_meal_timing, after_bathroom = p_after_bathroom,
      exercise_within_previous_12_hours = p_exercise_within_previous_12_hours,
      measurement_assistance = p_measurement_assistance, clothing_level = p_clothing_level
    WHERE id = v_session.id AND user_id = p_user_id RETURNING * INTO v_session;
  ELSE
    INSERT INTO public.anthropometric_sessions(
      user_id, status, measured_at, notes, data_contract_version, protocol_version,
      local_time, measurement_context_version, meal_timing, after_bathroom,
      exercise_within_previous_12_hours, measurement_assistance, clothing_level)
    VALUES (
      p_user_id, 'draft', p_measured_at, NULLIF(btrim(p_notes), ''),
      p_data_contract_version, p_protocol_version, p_local_time,
      p_measurement_context_version, p_meal_timing, p_after_bathroom,
      p_exercise_within_previous_12_hours, p_measurement_assistance, p_clothing_level)
    RETURNING * INTO v_session;
  END IF;

  DELETE FROM public.anthropometric_readings
   WHERE session_id = v_session.id AND user_id = p_user_id;
  INSERT INTO public.anthropometric_readings(id, session_id, user_id, site_code, reading_number, value_cm)
  SELECT item.id, v_session.id, p_user_id, item.site_code, item.reading_number, item.value_cm
  FROM jsonb_to_recordset(p_readings) AS item(id UUID, site_code TEXT, reading_number SMALLINT, value_cm NUMERIC);

  IF p_status = 'finalized' THEN
    PERFORM set_config('app.anthropometry_finalizing_session', v_session.id::TEXT, true);
    UPDATE public.anthropometric_sessions SET status = 'finalized', measured_at = p_measured_at,
      logged_date = p_logged_date, timezone = p_timezone, local_time = p_local_time,
      idempotency_key = p_idempotency_key, payload_hash = p_payload_hash,
      representative_algorithm_version = p_representative_algorithm_version,
      thresholds_version = p_thresholds_version, finalized_at = now()
    WHERE id = v_session.id AND user_id = p_user_id RETURNING * INTO v_session;

    INSERT INTO public.anthropometric_representatives(
      session_id, user_id, site_code, representative_cm, method, reading_count,
      initial_pair_difference_cm, all_readings_range_cm, quality, quality_flags,
      algorithm_version, source_reading_ids, selected_reading_indices,
      unselected_reading_id, selected_pair_spread_cm, pairwise_differences,
      warning_codes, eligible_for_interpretation, quality_acknowledged_at,
      quality_acknowledgement_version)
    SELECT v_session.id, p_user_id, item.site_code, item.representative_cm, item.method,
      item.reading_count, item.initial_pair_difference_cm, item.all_readings_range_cm,
      item.quality, item.quality_flags, item.algorithm_version, item.source_reading_ids,
      item.selected_reading_indices, item.unselected_reading_id,
      item.selected_pair_spread_cm, item.pairwise_differences, item.warning_codes,
      item.eligible_for_interpretation, item.quality_acknowledged_at,
      item.quality_acknowledgement_version
    FROM jsonb_to_recordset(p_representatives) AS item(
      site_code TEXT, representative_cm NUMERIC, method TEXT, reading_count SMALLINT,
      initial_pair_difference_cm NUMERIC, all_readings_range_cm NUMERIC, quality TEXT,
      quality_flags JSONB, algorithm_version TEXT, source_reading_ids UUID[],
      selected_reading_indices SMALLINT[], unselected_reading_id UUID,
      selected_pair_spread_cm NUMERIC, pairwise_differences JSONB, warning_codes JSONB,
      eligible_for_interpretation BOOLEAN, quality_acknowledged_at TIMESTAMPTZ,
      quality_acknowledgement_version TEXT);

    SELECT count(DISTINCT site_code) INTO v_reading_site_count
      FROM public.anthropometric_readings
     WHERE session_id = v_session.id AND user_id = p_user_id;
    SELECT count(*) INTO v_representative_site_count
      FROM public.anthropometric_representatives
     WHERE session_id = v_session.id AND user_id = p_user_id;
    IF v_reading_site_count <> v_representative_site_count OR EXISTS (
      SELECT 1 FROM public.anthropometric_representatives representative
       WHERE representative.session_id = v_session.id
         AND representative.user_id = p_user_id
         AND representative.reading_count <> (
           SELECT count(*) FROM public.anthropometric_readings reading
            WHERE reading.session_id = v_session.id
              AND reading.user_id = p_user_id
              AND reading.site_code = representative.site_code)) THEN
      RAISE EXCEPTION 'ANTHROPOMETRIC_REPRESENTATIVE_MISMATCH' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN jsonb_build_object('session_id', v_session.id, 'status', p_status, 'replayed', false);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_save_anthropometric_session(
  UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, JSONB, JSONB, DATE, TEXT, TIME, TEXT,
  TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_save_anthropometric_session(
  UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, JSONB, JSONB, DATE, TEXT, TIME, TEXT,
  TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;

COMMENT ON COLUMN public.anthropometric_sessions.local_time IS
  'Server-derived wall-clock time at measured_at in the profile timezone frozen at finalisation.';
COMMENT ON COLUMN public.anthropometric_sessions.measurement_context_version IS
  'Null identifies a legacy row with no structured context; new rows use anthropometry_measurement_context_v1.';
