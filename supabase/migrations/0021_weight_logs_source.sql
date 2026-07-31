-- Phase 5: Add source column to weight_logs for provenance tracking.
-- Tracks how the weight was entered ('manual', 'sync', etc.) so snapshots
-- can record weight_log_source and input_provenance correctly.

ALTER TABLE weight_logs ADD COLUMN IF NOT EXISTS source TEXT;

-- Backfill existing rows.
UPDATE weight_logs SET source = 'manual' WHERE source IS NULL;

-- Update fn_log_weight to accept and record source.
CREATE OR REPLACE FUNCTION fn_log_weight(
  p_user_id    uuid,
  p_weight_kg  numeric,
  p_measured_at timestamptz,
  p_logged_date date,
  p_notes      text,
  p_source     text DEFAULT 'manual'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE v_id uuid;
BEGIN
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Cannot log weight for another user';
  END IF;

  UPDATE weight_logs
  SET is_official = false
  WHERE user_id = p_user_id AND logged_date = p_logged_date;

  INSERT INTO weight_logs (user_id, weight_kg, measured_at, logged_date, is_official, notes, source)
  VALUES (p_user_id, p_weight_kg, p_measured_at, p_logged_date, true, p_notes, p_source)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
