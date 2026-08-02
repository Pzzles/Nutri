-- 0032_anthropometric_api_rpcs.sql
--
-- Phase 10, Gate 3: atomic persistence boundary for anthropometric sessions.
-- Only the service role may invoke this RPC. Edge Functions authenticate the
-- caller, derive user_id from the verified JWT, calculate representatives on
-- the server, and then submit the complete transaction here.

CREATE OR REPLACE FUNCTION public.fn_save_anthropometric_session(
  p_user_id UUID,
  p_session_id UUID,
  p_status TEXT,
  p_measured_at TIMESTAMPTZ,
  p_notes TEXT,
  p_readings JSONB,
  p_representatives JSONB,
  p_logged_date DATE,
  p_timezone TEXT,
  p_idempotency_key TEXT,
  p_payload_hash TEXT,
  p_data_contract_version TEXT,
  p_protocol_version TEXT,
  p_representative_algorithm_version TEXT,
  p_thresholds_version TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.anthropometric_sessions%ROWTYPE;
  v_existing public.anthropometric_sessions%ROWTYPE;
  v_reading_site_count INTEGER;
  v_representative_site_count INTEGER;
BEGIN
  IF p_status NOT IN ('draft', 'finalized') THEN
    RAISE EXCEPTION 'ANTHROPOMETRIC_INVALID_STATUS'
      USING ERRCODE = '22023';
  END IF;

  IF p_data_contract_version <> 'anthropometry_data_contract_v2'
     OR p_protocol_version <> 'anthropometry_protocol_v1' THEN
    RAISE EXCEPTION 'ANTHROPOMETRIC_UNSUPPORTED_VERSION'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_readings) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'ANTHROPOMETRIC_READINGS_MUST_BE_ARRAY'
      USING ERRCODE = '22023';
  END IF;

  IF p_status = 'finalized' THEN
    IF p_measured_at IS NULL
       OR p_logged_date IS NULL
       OR p_timezone IS NULL
       OR p_idempotency_key IS NULL
       OR p_payload_hash IS NULL
       OR p_representative_algorithm_version <> 'anthropometry_representative_v1'
       OR p_thresholds_version <> 'anthropometry_repeatability_thresholds_v1'
       OR jsonb_typeof(p_representatives) IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_readings) < 2
       OR jsonb_array_length(p_representatives) < 1 THEN
      RAISE EXCEPTION 'ANTHROPOMETRIC_INCOMPLETE_FINALIZATION'
        USING ERRCODE = '22023';
    END IF;

    -- Serialize concurrent retries for the same user/key before checking the
    -- unique index, so the loser observes and replays the committed result
    -- instead of surfacing a transient unique-constraint failure.
    PERFORM pg_advisory_xact_lock(
      hashtextextended(p_user_id::TEXT || ':' || p_idempotency_key, 0)
    );

    SELECT *
      INTO v_existing
      FROM public.anthropometric_sessions
     WHERE user_id = p_user_id
       AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
      IF v_existing.payload_hash = p_payload_hash THEN
        RETURN jsonb_build_object(
          'session_id', v_existing.id,
          'status', v_existing.status,
          'replayed', true
        );
      END IF;

      RAISE EXCEPTION 'ANTHROPOMETRIC_IDEMPOTENCY_CONFLICT'
        USING ERRCODE = '23505';
    END IF;
  ELSE
    IF p_representatives IS NOT NULL
       OR p_logged_date IS NOT NULL
       OR p_timezone IS NOT NULL
       OR p_idempotency_key IS NOT NULL
       OR p_payload_hash IS NOT NULL
       OR p_representative_algorithm_version IS NOT NULL
       OR p_thresholds_version IS NOT NULL THEN
      RAISE EXCEPTION 'ANTHROPOMETRIC_DRAFT_HAS_FINAL_FIELDS'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_session_id IS NOT NULL THEN
    SELECT *
      INTO v_session
      FROM public.anthropometric_sessions
     WHERE id = p_session_id
       AND user_id = p_user_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ANTHROPOMETRIC_SESSION_NOT_FOUND'
        USING ERRCODE = 'P0002';
    END IF;

    IF v_session.status <> 'draft' THEN
      RAISE EXCEPTION 'ANTHROPOMETRIC_SESSION_IMMUTABLE'
        USING ERRCODE = '55000';
    END IF;

    UPDATE public.anthropometric_sessions
       SET measured_at = p_measured_at,
           notes = NULLIF(btrim(p_notes), ''),
           data_contract_version = p_data_contract_version,
           protocol_version = p_protocol_version
     WHERE id = v_session.id
     RETURNING * INTO v_session;
  ELSE
    INSERT INTO public.anthropometric_sessions (
      user_id,
      status,
      measured_at,
      notes,
      data_contract_version,
      protocol_version
    ) VALUES (
      p_user_id,
      'draft',
      p_measured_at,
      NULLIF(btrim(p_notes), ''),
      p_data_contract_version,
      p_protocol_version
    )
    RETURNING * INTO v_session;
  END IF;

  DELETE FROM public.anthropometric_readings
   WHERE session_id = v_session.id;

  INSERT INTO public.anthropometric_readings (
    session_id,
    site_code,
    reading_number,
    value_cm
  )
  SELECT
    v_session.id,
    item.site_code,
    item.reading_number,
    item.value_cm
  FROM jsonb_to_recordset(p_readings) AS item(
    site_code TEXT,
    reading_number SMALLINT,
    value_cm NUMERIC
  );

  IF p_status = 'finalized' THEN
    UPDATE public.anthropometric_sessions
       SET status = 'finalized',
           measured_at = p_measured_at,
           logged_date = p_logged_date,
           timezone = p_timezone,
           idempotency_key = p_idempotency_key,
           payload_hash = p_payload_hash,
           representative_algorithm_version = p_representative_algorithm_version,
           thresholds_version = p_thresholds_version,
           finalized_at = now()
     WHERE id = v_session.id
     RETURNING * INTO v_session;

    INSERT INTO public.anthropometric_representatives (
      session_id,
      site_code,
      representative_cm,
      method,
      reading_count,
      initial_pair_difference_cm,
      all_readings_range_cm,
      quality,
      quality_flags,
      algorithm_version
    )
    SELECT
      v_session.id,
      item.site_code,
      item.representative_cm,
      item.method,
      item.reading_count,
      item.initial_pair_difference_cm,
      item.all_readings_range_cm,
      item.quality,
      item.quality_flags,
      item.algorithm_version
    FROM jsonb_to_recordset(p_representatives) AS item(
      site_code TEXT,
      representative_cm NUMERIC,
      method TEXT,
      reading_count SMALLINT,
      initial_pair_difference_cm NUMERIC,
      all_readings_range_cm NUMERIC,
      quality TEXT,
      quality_flags JSONB,
      algorithm_version TEXT
    );

    SELECT count(DISTINCT site_code)
      INTO v_reading_site_count
      FROM public.anthropometric_readings
     WHERE session_id = v_session.id;

    SELECT count(*)
      INTO v_representative_site_count
      FROM public.anthropometric_representatives
     WHERE session_id = v_session.id;

    IF v_reading_site_count <> v_representative_site_count
       OR EXISTS (
         SELECT 1
           FROM public.anthropometric_representatives representative
          WHERE representative.session_id = v_session.id
            AND representative.reading_count <> (
              SELECT count(*)
                FROM public.anthropometric_readings reading
               WHERE reading.session_id = v_session.id
                 AND reading.site_code = representative.site_code
            )
       ) THEN
      RAISE EXCEPTION 'ANTHROPOMETRIC_REPRESENTATIVE_MISMATCH'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'session_id', v_session.id,
    'status', p_status,
    'replayed', false
  );
END;
$$;

COMMENT ON FUNCTION public.fn_save_anthropometric_session(
  UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, JSONB, JSONB, DATE, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT
) IS 'Atomically replaces an owned draft and optionally finalizes it with server-calculated representatives.';

REVOKE ALL ON FUNCTION public.fn_save_anthropometric_session(
  UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, JSONB, JSONB, DATE, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fn_save_anthropometric_session(
  UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, JSONB, JSONB, DATE, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT
) TO service_role;
