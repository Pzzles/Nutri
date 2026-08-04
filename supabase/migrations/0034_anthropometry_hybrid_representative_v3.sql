-- 0034_anthropometry_hybrid_representative_v3.sql
-- Phase 10 remediation Gate 1: closest-pair representatives with complete
-- provenance. Historical v1/v2 rows remain unchanged and valid.

ALTER TABLE public.anthropometric_sessions
  DROP CONSTRAINT chk_anthropometric_session_data_contract;
ALTER TABLE public.anthropometric_sessions
  ADD CONSTRAINT chk_anthropometric_session_data_contract
  CHECK (data_contract_version IN ('anthropometry_data_contract_v2', 'anthropometry_data_contract_v3'));

ALTER TABLE public.anthropometric_sessions
  DROP CONSTRAINT chk_anthropometric_session_lifecycle;
ALTER TABLE public.anthropometric_sessions
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
      ))
  );

ALTER TABLE public.anthropometric_representatives
  ADD COLUMN source_reading_ids UUID[],
  ADD COLUMN selected_reading_indices SMALLINT[],
  ADD COLUMN unselected_reading_id UUID,
  ADD COLUMN selected_pair_spread_cm NUMERIC(4,1),
  ADD COLUMN pairwise_differences JSONB,
  ADD COLUMN warning_codes JSONB,
  ADD COLUMN eligible_for_interpretation BOOLEAN,
  ADD COLUMN quality_acknowledged_at TIMESTAMPTZ,
  ADD COLUMN quality_acknowledgement_version TEXT;

ALTER TABLE public.anthropometric_representatives
  DROP CONSTRAINT chk_anthropometric_representative_algorithm,
  DROP CONSTRAINT chk_anthropometric_representative_method;

ALTER TABLE public.anthropometric_representatives
  ADD CONSTRAINT chk_anthropometric_representative_algorithm CHECK (
    algorithm_version IN ('anthropometry_representative_v1', 'anthropometry_representative_v2', 'anthropometry_representative_v3')
  ),
  ADD CONSTRAINT chk_anthropometric_representative_method CHECK (
    (algorithm_version IN ('anthropometry_representative_v1', 'anthropometry_representative_v2') AND (
      (method = 'mean_of_two' AND reading_count = 2
        AND initial_pair_difference_cm <= 1.0
        AND quality = 'within_repeatability_threshold' AND quality_flags = '[]'::jsonb)
      OR
      (method = 'median_of_three' AND reading_count = 3
        AND initial_pair_difference_cm > 1.0
        AND quality = 'repeatability_warning'
        AND quality_flags = '["initial_pair_exceeds_repeatability_threshold"]'::jsonb)
    ))
    OR
    (algorithm_version = 'anthropometry_representative_v3'
      AND method = CASE WHEN reading_count = 2 THEN 'mean_of_two' ELSE 'mean_of_closest_pair' END
      AND reading_count IN (2, 3)
      AND quality IN ('pair_agree', 'pair_agree_with_isolated_reading', 'high_variability'))
  ),
  ADD CONSTRAINT chk_anthropometric_v3_provenance_shape CHECK (
    (algorithm_version <> 'anthropometry_representative_v3' AND source_reading_ids IS NULL
      AND selected_reading_indices IS NULL AND unselected_reading_id IS NULL
      AND selected_pair_spread_cm IS NULL AND pairwise_differences IS NULL
      AND warning_codes IS NULL AND eligible_for_interpretation IS NULL
      AND quality_acknowledged_at IS NULL AND quality_acknowledgement_version IS NULL)
    OR
    (algorithm_version = 'anthropometry_representative_v3'
      AND cardinality(source_reading_ids) = 2
      AND cardinality(selected_reading_indices) = 2
      AND selected_reading_indices[1] BETWEEN 1 AND 3
      AND selected_reading_indices[2] BETWEEN 1 AND 3
      AND selected_reading_indices[1] < selected_reading_indices[2]
      AND selected_pair_spread_cm >= 0
      AND jsonb_typeof(pairwise_differences) = 'object'
      AND jsonb_typeof(warning_codes) = 'array'
      AND eligible_for_interpretation IS NOT NULL
      AND ((quality_acknowledged_at IS NULL) = (quality_acknowledgement_version IS NULL)))
  );

CREATE OR REPLACE FUNCTION public.validate_anthropometric_v3_representative()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_numbers SMALLINT[];
  v_values NUMERIC[];
  v_ids UUID[];
  v_d12 NUMERIC;
  v_d13 NUMERIC;
  v_d23 NUMERIC;
  v_expected_indices SMALLINT[];
  v_unselected_number SMALLINT;
  v_unselected_value NUMERIC;
BEGIN
  IF NEW.algorithm_version <> 'anthropometry_representative_v3' THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(reading_number ORDER BY reading_number),
         array_agg(value_cm ORDER BY reading_number),
         array_agg(id ORDER BY reading_number)
    INTO v_numbers, v_values, v_ids
    FROM public.anthropometric_readings
   WHERE session_id = NEW.session_id AND site_code = NEW.site_code;

  IF cardinality(v_numbers) IS DISTINCT FROM NEW.reading_count
     OR v_numbers IS DISTINCT FROM (SELECT array_agg(i::SMALLINT) FROM generate_series(1, NEW.reading_count) i) THEN
    RAISE EXCEPTION 'ANTHROPOMETRIC_V3_RAW_READING_MISMATCH' USING ERRCODE = '22023';
  END IF;

  v_d12 := abs(v_values[1] - v_values[2]);
  IF NEW.reading_count = 3 THEN
    v_d13 := abs(v_values[1] - v_values[3]);
    v_d23 := abs(v_values[2] - v_values[3]);
    IF v_d12 <= v_d13 AND v_d12 <= v_d23 THEN
      v_expected_indices := ARRAY[1,2]::SMALLINT[];
    ELSIF v_d13 <= v_d23 THEN
      v_expected_indices := ARRAY[1,3]::SMALLINT[];
    ELSE
      v_expected_indices := ARRAY[2,3]::SMALLINT[];
    END IF;
  ELSE
    v_expected_indices := ARRAY[1,2]::SMALLINT[];
  END IF;

  IF NEW.selected_reading_indices IS DISTINCT FROM v_expected_indices
     OR NEW.source_reading_ids IS DISTINCT FROM ARRAY[
       v_ids[v_expected_indices[1]], v_ids[v_expected_indices[2]]
     ]::UUID[]
     OR NEW.selected_pair_spread_cm IS DISTINCT FROM
       abs(v_values[v_expected_indices[1]] - v_values[v_expected_indices[2]])
     OR NEW.representative_cm IS DISTINCT FROM round(
       (v_values[v_expected_indices[1]] + v_values[v_expected_indices[2]]) / 2, 2
     ) THEN
    RAISE EXCEPTION 'ANTHROPOMETRIC_V3_SELECTED_PAIR_MISMATCH' USING ERRCODE = '22023';
  END IF;

  IF NEW.pairwise_differences IS DISTINCT FROM jsonb_build_object(
    'd12', v_d12,
    'd13', CASE WHEN NEW.reading_count = 3 THEN v_d13 ELSE NULL END,
    'd23', CASE WHEN NEW.reading_count = 3 THEN v_d23 ELSE NULL END
  ) THEN
    RAISE EXCEPTION 'ANTHROPOMETRIC_V3_PAIRWISE_MISMATCH' USING ERRCODE = '22023';
  END IF;

  IF NEW.reading_count = 3 THEN
    v_unselected_number := 6 - v_expected_indices[1] - v_expected_indices[2];
    v_unselected_value := v_values[v_unselected_number];
    IF NEW.unselected_reading_id IS DISTINCT FROM v_ids[v_unselected_number] THEN
      RAISE EXCEPTION 'ANTHROPOMETRIC_V3_UNSELECTED_READING_MISMATCH' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.unselected_reading_id IS NOT NULL THEN
    RAISE EXCEPTION 'ANTHROPOMETRIC_V3_UNEXPECTED_UNSELECTED_READING' USING ERRCODE = '22023';
  END IF;

  IF NEW.selected_pair_spread_cm > 1.0 THEN
    IF NEW.quality <> 'high_variability' OR NEW.eligible_for_interpretation
       OR NEW.warning_codes <> '["no_pair_within_repeatability_threshold"]'::jsonb
       OR NEW.quality_acknowledged_at IS NULL
       OR NEW.quality_acknowledgement_version <> 'anthropometry_high_variability_ack_v1' THEN
      RAISE EXCEPTION 'ANTHROPOMETRIC_V3_HIGH_VARIABILITY_MISMATCH' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.reading_count = 3
    AND abs(v_unselected_value - v_values[v_expected_indices[1]]) > 1.0
    AND abs(v_unselected_value - v_values[v_expected_indices[2]]) > 1.0 THEN
    IF NEW.quality <> 'pair_agree_with_isolated_reading' OR NOT NEW.eligible_for_interpretation
       OR NEW.warning_codes <> '["isolated_reading_excluded"]'::jsonb
       OR NEW.quality_acknowledged_at IS NOT NULL THEN
      RAISE EXCEPTION 'ANTHROPOMETRIC_V3_ISOLATED_READING_MISMATCH' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF NEW.quality <> 'pair_agree' OR NOT NEW.eligible_for_interpretation
       OR NEW.warning_codes <> '[]'::jsonb OR NEW.quality_acknowledged_at IS NOT NULL THEN
      RAISE EXCEPTION 'ANTHROPOMETRIC_V3_PAIR_AGREEMENT_MISMATCH' USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_anthropometric_v3_representative
  BEFORE INSERT ON public.anthropometric_representatives
  FOR EACH ROW EXECUTE FUNCTION public.validate_anthropometric_v3_representative();

CREATE OR REPLACE FUNCTION public.fn_save_anthropometric_session(
  p_user_id UUID, p_session_id UUID, p_status TEXT, p_measured_at TIMESTAMPTZ,
  p_notes TEXT, p_readings JSONB, p_representatives JSONB, p_logged_date DATE,
  p_timezone TEXT, p_idempotency_key TEXT, p_payload_hash TEXT,
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
  IF p_data_contract_version <> 'anthropometry_data_contract_v3'
     OR p_protocol_version <> 'anthropometry_protocol_v1' THEN
    RAISE EXCEPTION 'ANTHROPOMETRIC_UNSUPPORTED_VERSION' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_readings) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'ANTHROPOMETRIC_READINGS_MUST_BE_ARRAY' USING ERRCODE = '22023';
  END IF;

  IF p_status = 'finalized' THEN
    IF p_measured_at IS NULL OR p_logged_date IS NULL OR p_timezone IS NULL
       OR p_idempotency_key IS NULL OR p_payload_hash IS NULL
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
      protocol_version = p_protocol_version WHERE id = v_session.id RETURNING * INTO v_session;
  ELSE
    INSERT INTO public.anthropometric_sessions(user_id, status, measured_at, notes, data_contract_version, protocol_version)
    VALUES (p_user_id, 'draft', p_measured_at, NULLIF(btrim(p_notes), ''), p_data_contract_version, p_protocol_version)
    RETURNING * INTO v_session;
  END IF;

  DELETE FROM public.anthropometric_readings WHERE session_id = v_session.id;
  INSERT INTO public.anthropometric_readings(id, session_id, site_code, reading_number, value_cm)
  SELECT item.id, v_session.id, item.site_code, item.reading_number, item.value_cm
  FROM jsonb_to_recordset(p_readings) AS item(id UUID, site_code TEXT, reading_number SMALLINT, value_cm NUMERIC);

  IF p_status = 'finalized' THEN
    UPDATE public.anthropometric_sessions SET status = 'finalized', measured_at = p_measured_at,
      logged_date = p_logged_date, timezone = p_timezone, idempotency_key = p_idempotency_key,
      payload_hash = p_payload_hash, representative_algorithm_version = p_representative_algorithm_version,
      thresholds_version = p_thresholds_version, finalized_at = now()
    WHERE id = v_session.id RETURNING * INTO v_session;

    INSERT INTO public.anthropometric_representatives(
      session_id, site_code, representative_cm, method, reading_count,
      initial_pair_difference_cm, all_readings_range_cm, quality, quality_flags,
      algorithm_version, source_reading_ids, selected_reading_indices,
      unselected_reading_id, selected_pair_spread_cm, pairwise_differences,
      warning_codes, eligible_for_interpretation, quality_acknowledged_at,
      quality_acknowledgement_version)
    SELECT v_session.id, item.site_code, item.representative_cm, item.method,
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
      FROM public.anthropometric_readings WHERE session_id = v_session.id;
    SELECT count(*) INTO v_representative_site_count
      FROM public.anthropometric_representatives WHERE session_id = v_session.id;
    IF v_reading_site_count <> v_representative_site_count OR EXISTS (
      SELECT 1 FROM public.anthropometric_representatives representative
       WHERE representative.session_id = v_session.id AND representative.reading_count <> (
         SELECT count(*) FROM public.anthropometric_readings reading
          WHERE reading.session_id = v_session.id AND reading.site_code = representative.site_code)) THEN
      RAISE EXCEPTION 'ANTHROPOMETRIC_REPRESENTATIVE_MISMATCH' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN jsonb_build_object('session_id', v_session.id, 'status', p_status, 'replayed', false);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_save_anthropometric_session(
  UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, JSONB, JSONB, DATE, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_save_anthropometric_session(
  UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, JSONB, JSONB, DATE, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT) TO service_role;

COMMENT ON CONSTRAINT chk_anthropometric_v3_provenance_shape
  ON public.anthropometric_representatives
  IS 'v3 rows carry selected-pair, warning, eligibility, and acknowledgement provenance; v1/v2 rows remain null.';
