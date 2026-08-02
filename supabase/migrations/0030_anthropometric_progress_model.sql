-- 0030_anthropometric_progress_model.sql
--
-- Phase 10, Gate 2: anthropometric progress data model.
--
-- Creates persisted draft sessions, immutable finalised sessions, preserved raw
-- readings, server-owned representative rows, and owner-scoped RLS. Migration
-- number 0030 intentionally leaves 0029 available for the repository's known
-- duplicate-0027 repair.

-- ---------------------------------------------------------------------------
-- Stable site dictionary
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_anthropometric_site_code(value TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT value IN (
    'chest',
    'waist',
    'abdomen_navel',
    'hips',
    'left_upper_arm_relaxed',
    'right_upper_arm_relaxed',
    'left_mid_thigh',
    'right_mid_thigh',
    'neck'
  );
$$;

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------

CREATE TABLE public.anthropometric_sessions (
  id                               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                          UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status                           TEXT        NOT NULL DEFAULT 'draft',
  measured_at                      TIMESTAMPTZ,
  logged_date                      DATE,
  timezone                         TEXT,
  notes                            TEXT,
  data_contract_version            TEXT        NOT NULL DEFAULT 'anthropometry_data_contract_v2',
  protocol_version                 TEXT        NOT NULL DEFAULT 'anthropometry_protocol_v1',
  representative_algorithm_version TEXT,
  thresholds_version               TEXT,
  idempotency_key                  TEXT,
  payload_hash                     TEXT,
  finalized_at                     TIMESTAMPTZ,
  created_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_anthropometric_session_status
    CHECK (status IN ('draft', 'finalized')),
  CONSTRAINT chk_anthropometric_session_data_contract
    CHECK (data_contract_version = 'anthropometry_data_contract_v2'),
  CONSTRAINT chk_anthropometric_session_protocol
    CHECK (protocol_version = 'anthropometry_protocol_v1'),
  CONSTRAINT chk_anthropometric_session_notes
    CHECK (notes IS NULL OR char_length(notes) <= 500),
  CONSTRAINT chk_anthropometric_session_timezone
    CHECK (timezone IS NULL OR char_length(timezone) BETWEEN 1 AND 100),
  CONSTRAINT chk_anthropometric_session_idempotency_key
    CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 1 AND 128),
  CONSTRAINT chk_anthropometric_session_idempotency_pair
    CHECK ((idempotency_key IS NULL) = (payload_hash IS NULL)),
  CONSTRAINT chk_anthropometric_session_lifecycle
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
        AND representative_algorithm_version = 'anthropometry_representative_v1'
        AND thresholds_version = 'anthropometry_repeatability_thresholds_v1'
        AND idempotency_key IS NOT NULL
        AND payload_hash IS NOT NULL
        AND finalized_at IS NOT NULL
      )
    ),
  CONSTRAINT chk_anthropometric_session_finalized_time
    CHECK (finalized_at IS NULL OR finalized_at >= created_at)
);

CREATE UNIQUE INDEX idx_anthropometric_sessions_idempotency
  ON public.anthropometric_sessions (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_anthropometric_sessions_user_history
  ON public.anthropometric_sessions (user_id, measured_at DESC, id DESC)
  WHERE status = 'finalized';

CREATE INDEX idx_anthropometric_sessions_user_drafts
  ON public.anthropometric_sessions (user_id, updated_at DESC, id DESC)
  WHERE status = 'draft';

CREATE TRIGGER trg_anthropometric_sessions_updated_at
  BEFORE UPDATE ON public.anthropometric_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- A draft may be edited and may transition once to finalized. A finalized row
-- cannot be edited, reopened, or re-finalized. Whole-row deletion is handled
-- separately so Prompt 3 can provide an explicit authenticated deletion path.
CREATE OR REPLACE FUNCTION public.guard_anthropometric_session_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'finalized' THEN
    RAISE EXCEPTION 'Finalized anthropometric sessions are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.user_id <> OLD.user_id THEN
    RAISE EXCEPTION 'Anthropometric session ownership cannot change'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_anthropometric_session_update
  BEFORE UPDATE ON public.anthropometric_sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_anthropometric_session_update();

-- ---------------------------------------------------------------------------
-- Preserved raw readings
-- ---------------------------------------------------------------------------

CREATE TABLE public.anthropometric_readings (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     UUID        NOT NULL REFERENCES public.anthropometric_sessions(id) ON DELETE CASCADE,
  site_code      TEXT        NOT NULL,
  reading_number SMALLINT    NOT NULL,
  value_cm       NUMERIC(6,2) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_anthropometric_reading_number
    UNIQUE (session_id, site_code, reading_number),
  CONSTRAINT chk_anthropometric_reading_site
    CHECK (public.is_anthropometric_site_code(site_code)),
  CONSTRAINT chk_anthropometric_reading_number
    CHECK (reading_number IN (1, 2, 3)),
  CONSTRAINT chk_anthropometric_reading_value
    CHECK (
      value_cm BETWEEN 5.0 AND 300.0
      AND value_cm = round(value_cm, 1)
    )
);

CREATE INDEX idx_anthropometric_readings_session_order
  ON public.anthropometric_readings (session_id, site_code, reading_number, id);

CREATE TRIGGER trg_anthropometric_readings_updated_at
  BEFORE UPDATE ON public.anthropometric_readings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- This trigger protects finalized children even for privileged application
-- code. DELETE is deliberately excluded so deleting the parent session can
-- cascade cleanly through its complete immutable record.
CREATE OR REPLACE FUNCTION public.require_draft_anthropometric_session()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  parent_status TEXT;
BEGIN
  SELECT status
    INTO parent_status
    FROM public.anthropometric_sessions
   WHERE id = NEW.session_id;

  IF parent_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Raw readings can only be inserted or updated on draft sessions'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_require_draft_anthropometric_session
  BEFORE INSERT OR UPDATE ON public.anthropometric_readings
  FOR EACH ROW EXECUTE FUNCTION public.require_draft_anthropometric_session();

-- ---------------------------------------------------------------------------
-- Server-authoritative representatives
-- ---------------------------------------------------------------------------

CREATE TABLE public.anthropometric_representatives (
  session_id                       UUID         NOT NULL REFERENCES public.anthropometric_sessions(id) ON DELETE CASCADE,
  site_code                        TEXT         NOT NULL,
  representative_cm                NUMERIC(5,2) NOT NULL,
  method                           TEXT         NOT NULL,
  reading_count                    SMALLINT     NOT NULL,
  initial_pair_difference_cm       NUMERIC(4,1) NOT NULL,
  all_readings_range_cm            NUMERIC(4,1) NOT NULL,
  quality                          TEXT         NOT NULL,
  quality_flags                    JSONB        NOT NULL DEFAULT '[]'::jsonb,
  algorithm_version                TEXT         NOT NULL,
  created_at                       TIMESTAMPTZ  NOT NULL DEFAULT now(),

  PRIMARY KEY (session_id, site_code),
  CONSTRAINT chk_anthropometric_representative_site
    CHECK (public.is_anthropometric_site_code(site_code)),
  CONSTRAINT chk_anthropometric_representative_value
    CHECK (representative_cm BETWEEN 5.00 AND 300.00),
  CONSTRAINT chk_anthropometric_representative_differences
    CHECK (
      initial_pair_difference_cm >= 0
      AND all_readings_range_cm >= initial_pair_difference_cm
    ),
  CONSTRAINT chk_anthropometric_representative_algorithm
    CHECK (algorithm_version = 'anthropometry_representative_v1'),
  CONSTRAINT chk_anthropometric_representative_quality_flags
    CHECK (jsonb_typeof(quality_flags) = 'array'),
  CONSTRAINT chk_anthropometric_representative_method
    CHECK (
      (
        method = 'mean_of_two'
        AND reading_count = 2
        AND initial_pair_difference_cm <= 1.0
        AND quality = 'within_repeatability_threshold'
        AND quality_flags = '[]'::jsonb
      )
      OR
      (
        method = 'median_of_three'
        AND reading_count = 3
        AND initial_pair_difference_cm > 1.0
        AND quality = 'repeatability_warning'
        AND quality_flags = '["initial_pair_exceeds_repeatability_threshold"]'::jsonb
      )
    )
);

CREATE INDEX idx_anthropometric_representatives_site
  ON public.anthropometric_representatives (site_code, session_id);

CREATE OR REPLACE FUNCTION public.require_finalized_anthropometric_session()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  parent_status TEXT;
BEGIN
  SELECT status
    INTO parent_status
    FROM public.anthropometric_sessions
   WHERE id = NEW.session_id;

  IF parent_status IS DISTINCT FROM 'finalized' THEN
    RAISE EXCEPTION 'Representatives can only be inserted for finalized sessions'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_require_finalized_anthropometric_session
  BEFORE INSERT ON public.anthropometric_representatives
  FOR EACH ROW EXECUTE FUNCTION public.require_finalized_anthropometric_session();

CREATE OR REPLACE FUNCTION public.guard_anthropometric_representative_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Anthropometric representatives are immutable'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER trg_guard_anthropometric_representative_update
  BEFORE UPDATE ON public.anthropometric_representatives
  FOR EACH ROW EXECUTE FUNCTION public.guard_anthropometric_representative_update();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

ALTER TABLE public.anthropometric_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anthropometric_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anthropometric_representatives ENABLE ROW LEVEL SECURITY;

CREATE POLICY anthropometric_sessions_select_own
  ON public.anthropometric_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY anthropometric_sessions_insert_own_draft
  ON public.anthropometric_sessions FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND status = 'draft'
    AND finalized_at IS NULL
  );

CREATE POLICY anthropometric_sessions_update_own_draft
  ON public.anthropometric_sessions FOR UPDATE
  USING (auth.uid() = user_id AND status = 'draft')
  WITH CHECK (auth.uid() = user_id AND status = 'draft');

CREATE POLICY anthropometric_sessions_delete_own_draft
  ON public.anthropometric_sessions FOR DELETE
  USING (auth.uid() = user_id AND status = 'draft');

CREATE POLICY anthropometric_readings_select_own
  ON public.anthropometric_readings FOR SELECT
  USING (
    EXISTS (
      SELECT 1
        FROM public.anthropometric_sessions session
       WHERE session.id = session_id
         AND session.user_id = auth.uid()
    )
  );

CREATE POLICY anthropometric_readings_insert_own_draft
  ON public.anthropometric_readings FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.anthropometric_sessions session
       WHERE session.id = session_id
         AND session.user_id = auth.uid()
         AND session.status = 'draft'
    )
  );

CREATE POLICY anthropometric_readings_update_own_draft
  ON public.anthropometric_readings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
        FROM public.anthropometric_sessions session
       WHERE session.id = session_id
         AND session.user_id = auth.uid()
         AND session.status = 'draft'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.anthropometric_sessions session
       WHERE session.id = session_id
         AND session.user_id = auth.uid()
         AND session.status = 'draft'
    )
  );

CREATE POLICY anthropometric_readings_delete_own_draft
  ON public.anthropometric_readings FOR DELETE
  USING (
    EXISTS (
      SELECT 1
        FROM public.anthropometric_sessions session
       WHERE session.id = session_id
         AND session.user_id = auth.uid()
         AND session.status = 'draft'
    )
  );

CREATE POLICY anthropometric_representatives_select_own
  ON public.anthropometric_representatives FOR SELECT
  USING (
    EXISTS (
      SELECT 1
        FROM public.anthropometric_sessions session
       WHERE session.id = session_id
         AND session.user_id = auth.uid()
    )
  );

-- The authenticated role can manage drafts through RLS. Representative writes
-- and finalized deletion/finalization remain service-owned for Prompt 3.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.anthropometric_sessions TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.anthropometric_readings TO authenticated, service_role;
GRANT SELECT ON public.anthropometric_representatives TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.anthropometric_representatives TO service_role;

REVOKE ALL ON public.anthropometric_sessions FROM anon;
REVOKE ALL ON public.anthropometric_readings FROM anon;
REVOKE ALL ON public.anthropometric_representatives FROM anon;
