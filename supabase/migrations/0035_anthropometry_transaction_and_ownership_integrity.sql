-- 0035_anthropometry_transaction_and_ownership_integrity.sql
-- Phase 10 remediation Gate 2: close finalisation/child-write races, make
-- child ownership explicit, freeze direct mutations behind trusted RPCs, and
-- make Auth-user deletion the single transactional erasure boundary.

-- ---------------------------------------------------------------------------
-- Explicit child ownership
-- ---------------------------------------------------------------------------

ALTER TABLE public.anthropometric_sessions
  ADD CONSTRAINT uq_anthropometric_sessions_id_user UNIQUE (id, user_id);

ALTER TABLE public.anthropometric_readings ADD COLUMN user_id UUID;
ALTER TABLE public.anthropometric_representatives ADD COLUMN user_id UUID;

UPDATE public.anthropometric_readings reading
   SET user_id = session.user_id
  FROM public.anthropometric_sessions session
 WHERE session.id = reading.session_id;

UPDATE public.anthropometric_representatives representative
   SET user_id = session.user_id
  FROM public.anthropometric_sessions session
 WHERE session.id = representative.session_id;

ALTER TABLE public.anthropometric_readings
  ALTER COLUMN user_id SET NOT NULL,
  DROP CONSTRAINT anthropometric_readings_session_id_fkey,
  ADD CONSTRAINT anthropometric_readings_session_owner_fkey
    FOREIGN KEY (session_id, user_id)
    REFERENCES public.anthropometric_sessions (id, user_id)
    ON DELETE CASCADE;

ALTER TABLE public.anthropometric_representatives
  ALTER COLUMN user_id SET NOT NULL,
  DROP CONSTRAINT anthropometric_representatives_session_id_fkey,
  ADD CONSTRAINT anthropometric_representatives_session_owner_fkey
    FOREIGN KEY (session_id, user_id)
    REFERENCES public.anthropometric_sessions (id, user_id)
    ON DELETE CASCADE;

CREATE INDEX idx_anthropometric_readings_user_session
  ON public.anthropometric_readings (user_id, session_id);
CREATE INDEX idx_anthropometric_readings_user_site
  ON public.anthropometric_readings (user_id, site_code);
CREATE INDEX idx_anthropometric_representatives_user_session
  ON public.anthropometric_representatives (user_id, session_id);
CREATE INDEX idx_anthropometric_representatives_user_site
  ON public.anthropometric_representatives (user_id, site_code);

-- ---------------------------------------------------------------------------
-- Parent-lock enforcement for every raw-reading mutation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.require_draft_anthropometric_session()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.anthropometric_readings%ROWTYPE;
  v_parent_user_id UUID;
  v_parent_status TEXT;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;

  -- A referential-action cascade is the only child deletion allowed after a
  -- parent has begun deletion. Direct deletes always enter at depth one.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;

  SELECT user_id, status
    INTO v_parent_user_id, v_parent_status
    FROM public.anthropometric_sessions
   WHERE id = v_row.session_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ANTHROPOMETRIC_SESSION_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_row.user_id IS NULL AND TG_OP = 'INSERT' THEN
    NEW.user_id := v_parent_user_id;
  ELSIF v_row.user_id IS DISTINCT FROM v_parent_user_id THEN
    RAISE EXCEPTION 'ANTHROPOMETRIC_CHILD_OWNER_MISMATCH' USING ERRCODE = '42501';
  END IF;

  IF v_parent_status <> 'draft' THEN
    RAISE EXCEPTION 'ANTHROPOMETRIC_SESSION_IMMUTABLE' USING ERRCODE = '55000';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER trg_require_draft_anthropometric_session
  ON public.anthropometric_readings;
CREATE TRIGGER trg_require_draft_anthropometric_session
  BEFORE INSERT OR UPDATE OR DELETE ON public.anthropometric_readings
  FOR EACH ROW EXECUTE FUNCTION public.require_draft_anthropometric_session();

-- Representative inserts are valid only inside the authoritative finalising
-- RPC. The transaction-local setting is inaccessible to API roles and is
-- checked together with the locked parent and explicit owner.
CREATE OR REPLACE FUNCTION public.require_finalized_anthropometric_session()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_parent_user_id UUID;
  v_parent_status TEXT;
BEGIN
  SELECT user_id, status
    INTO v_parent_user_id, v_parent_status
    FROM public.anthropometric_sessions
   WHERE id = NEW.session_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ANTHROPOMETRIC_SESSION_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF NEW.user_id IS NULL THEN
    NEW.user_id := v_parent_user_id;
  ELSIF NEW.user_id IS DISTINCT FROM v_parent_user_id THEN
    RAISE EXCEPTION 'ANTHROPOMETRIC_CHILD_OWNER_MISMATCH' USING ERRCODE = '42501';
  END IF;

  IF v_parent_status <> 'finalized'
     OR current_setting('app.anthropometry_finalizing_session', true)
        IS DISTINCT FROM NEW.session_id::TEXT THEN
    RAISE EXCEPTION 'ANTHROPOMETRIC_REPRESENTATIVE_WRITE_FORBIDDEN'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_anthropometric_representative_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Anthropometric representatives are immutable'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER trg_guard_anthropometric_representative_update
  ON public.anthropometric_representatives;
CREATE TRIGGER trg_guard_anthropometric_representative_mutation
  BEFORE UPDATE OR DELETE ON public.anthropometric_representatives
  FOR EACH ROW EXECUTE FUNCTION public.guard_anthropometric_representative_update();

-- ---------------------------------------------------------------------------
-- Server-authoritative persistence with derived child ownership
-- ---------------------------------------------------------------------------

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
      protocol_version = p_protocol_version
    WHERE id = v_session.id AND user_id = p_user_id RETURNING * INTO v_session;
  ELSE
    INSERT INTO public.anthropometric_sessions(user_id, status, measured_at, notes, data_contract_version, protocol_version)
    VALUES (p_user_id, 'draft', p_measured_at, NULLIF(btrim(p_notes), ''), p_data_contract_version, p_protocol_version)
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
      logged_date = p_logged_date, timezone = p_timezone, idempotency_key = p_idempotency_key,
      payload_hash = p_payload_hash, representative_algorithm_version = p_representative_algorithm_version,
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

-- Owner check and deletion occur in one database statement. A valid UUID owned
-- by another user is indistinguishable from an unknown UUID.
CREATE OR REPLACE FUNCTION public.fn_delete_anthropometric_session(
  p_user_id UUID,
  p_session_id UUID
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted_id UUID;
BEGIN
  DELETE FROM public.anthropometric_sessions
   WHERE id = p_session_id AND user_id = p_user_id
   RETURNING id INTO v_deleted_id;
  IF v_deleted_id IS NULL THEN
    RAISE EXCEPTION 'ANTHROPOMETRIC_SESSION_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_deleted_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_delete_anthropometric_session(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_delete_anthropometric_session(UUID, UUID)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Read-only direct access, directly owner-scoped RLS
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS anthropometric_sessions_insert_own_draft ON public.anthropometric_sessions;
DROP POLICY IF EXISTS anthropometric_sessions_update_own_draft ON public.anthropometric_sessions;
DROP POLICY IF EXISTS anthropometric_sessions_delete_own_draft ON public.anthropometric_sessions;
DROP POLICY IF EXISTS anthropometric_readings_select_own ON public.anthropometric_readings;
DROP POLICY IF EXISTS anthropometric_readings_insert_own_draft ON public.anthropometric_readings;
DROP POLICY IF EXISTS anthropometric_readings_update_own_draft ON public.anthropometric_readings;
DROP POLICY IF EXISTS anthropometric_readings_delete_own_draft ON public.anthropometric_readings;
DROP POLICY IF EXISTS anthropometric_representatives_select_own ON public.anthropometric_representatives;

CREATE POLICY anthropometric_readings_select_own
  ON public.anthropometric_readings FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY anthropometric_representatives_select_own
  ON public.anthropometric_representatives FOR SELECT
  USING (auth.uid() = user_id);

GRANT SELECT ON public.anthropometric_sessions TO authenticated;
GRANT SELECT ON public.anthropometric_readings TO authenticated;
GRANT SELECT ON public.anthropometric_representatives TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.anthropometric_sessions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.anthropometric_readings FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.anthropometric_representatives FROM anon, authenticated;
REVOKE ALL ON public.anthropometric_sessions FROM anon;
REVOKE ALL ON public.anthropometric_readings FROM anon;
REVOKE ALL ON public.anthropometric_representatives FROM anon;

-- ---------------------------------------------------------------------------
-- One Auth-delete cascade boundary for all user-owned application data
-- ---------------------------------------------------------------------------

ALTER TABLE public.food_synonyms
  DROP CONSTRAINT food_synonyms_created_by_fkey,
  ADD CONSTRAINT food_synonyms_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.global_cache_promotion_votes
  DROP CONSTRAINT global_cache_promotion_votes_confirming_user_id_fkey,
  ADD CONSTRAINT global_cache_promotion_votes_confirming_user_id_fkey
    FOREIGN KEY (confirming_user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.meal_edit_log
  DROP CONSTRAINT meal_edit_log_edited_by_fkey,
  ADD CONSTRAINT meal_edit_log_edited_by_fkey
    FOREIGN KEY (edited_by) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.meal_items ALTER COLUMN food_id DROP NOT NULL;
ALTER TABLE public.meal_items
  DROP CONSTRAINT meal_items_food_id_fkey,
  ADD CONSTRAINT meal_items_food_id_fkey
    FOREIGN KEY (food_id) REFERENCES public.foods(id) ON DELETE SET NULL;
ALTER TABLE public.saved_meal_items
  DROP CONSTRAINT saved_meal_items_food_id_fkey,
  ADD CONSTRAINT saved_meal_items_food_id_fkey
    FOREIGN KEY (food_id) REFERENCES public.foods(id) ON DELETE CASCADE;
ALTER TABLE public.user_food_cache
  DROP CONSTRAINT user_food_cache_matched_food_id_fkey,
  ADD CONSTRAINT user_food_cache_matched_food_id_fkey
    FOREIGN KEY (matched_food_id) REFERENCES public.foods(id) ON DELETE CASCADE;
ALTER TABLE public.global_food_cache
  DROP CONSTRAINT global_food_cache_matched_food_id_fkey,
  ADD CONSTRAINT global_food_cache_matched_food_id_fkey
    FOREIGN KEY (matched_food_id) REFERENCES public.foods(id) ON DELETE CASCADE;
ALTER TABLE public.global_cache_promotion_votes
  DROP CONSTRAINT global_cache_promotion_votes_matched_food_id_fkey,
  ADD CONSTRAINT global_cache_promotion_votes_matched_food_id_fkey
    FOREIGN KEY (matched_food_id) REFERENCES public.foods(id) ON DELETE CASCADE;
ALTER TABLE public.foods
  DROP CONSTRAINT foods_owner_user_id_fkey,
  ADD CONSTRAINT foods_owner_user_id_fkey
    FOREIGN KEY (owner_user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.anthropometric_readings.user_id
  IS 'Server-derived owner, constrained to match the parent session owner.';
COMMENT ON COLUMN public.anthropometric_representatives.user_id
  IS 'Server-derived owner, constrained to match the parent session owner.';
