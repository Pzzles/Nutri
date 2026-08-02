-- 0033_anthropometry_confidence_retake.sql
--
-- Version the representative and repeatability rules that require a site-only
-- retake when no pair among three readings agrees within 1.0 cm. Historical
-- v1 finalized sessions remain valid and immutable; new finalizations use v2.

ALTER TABLE public.anthropometric_sessions
  DROP CONSTRAINT chk_anthropometric_session_lifecycle;

ALTER TABLE public.anthropometric_sessions
  ADD CONSTRAINT chk_anthropometric_session_lifecycle
  CHECK (
    (
      status = 'draft'
      AND logged_date IS NULL
      AND timezone IS NULL
      AND representative_algorithm_version IS NULL
      AND thresholds_version IS NULL
      AND idempotency_key IS NULL
      AND payload_hash IS NULL
      AND finalized_at IS NULL
    )
    OR
    (
      status = 'finalized'
      AND measured_at IS NOT NULL
      AND logged_date IS NOT NULL
      AND timezone IS NOT NULL
      AND (
        (
          representative_algorithm_version = 'anthropometry_representative_v1'
          AND thresholds_version = 'anthropometry_repeatability_thresholds_v1'
        )
        OR
        (
          representative_algorithm_version = 'anthropometry_representative_v2'
          AND thresholds_version = 'anthropometry_repeatability_thresholds_v2'
        )
      )
      AND idempotency_key IS NOT NULL
      AND payload_hash IS NOT NULL
      AND finalized_at IS NOT NULL
    )
  );

ALTER TABLE public.anthropometric_representatives
  DROP CONSTRAINT chk_anthropometric_representative_algorithm;

ALTER TABLE public.anthropometric_representatives
  ADD CONSTRAINT chk_anthropometric_representative_algorithm
  CHECK (
    algorithm_version IN (
      'anthropometry_representative_v1',
      'anthropometry_representative_v2'
    )
  );

DO $migration$
DECLARE
  function_definition TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.fn_save_anthropometric_session(uuid,uuid,text,timestamp with time zone,text,jsonb,jsonb,date,text,text,text,text,text,text,text)'::regprocedure
  ) INTO function_definition;

  function_definition := replace(
    function_definition,
    'p_representative_algorithm_version <> ''anthropometry_representative_v1''',
    'p_representative_algorithm_version <> ''anthropometry_representative_v2'''
  );
  function_definition := replace(
    function_definition,
    'p_thresholds_version <> ''anthropometry_repeatability_thresholds_v1''',
    'p_thresholds_version <> ''anthropometry_repeatability_thresholds_v2'''
  );

  IF position('anthropometry_representative_v2' IN function_definition) = 0
     OR position('anthropometry_repeatability_thresholds_v2' IN function_definition) = 0 THEN
    RAISE EXCEPTION 'Could not version fn_save_anthropometric_session for anthropometry v2';
  END IF;

  EXECUTE function_definition;
END;
$migration$;

COMMENT ON CONSTRAINT chk_anthropometric_session_lifecycle
  ON public.anthropometric_sessions
  IS 'Drafts have no final fields; finalized rows retain matched v1 or v2 representative/threshold versions.';

COMMENT ON CONSTRAINT chk_anthropometric_representative_algorithm
  ON public.anthropometric_representatives
  IS 'Historical v1 and confidence-retake v2 representative rows are immutable and valid.';
