-- 0011_fix_goal_phase_function.sql
--
-- Fixes two bugs in fn_start_goal_phase (found by real DB integration tests):
--
--   Bug 1 — FK violation on supersede (code 23503):
--     The old function sets superseded_by = v_new_id before inserting the new
--     phase row.  superseded_by is a FK to goal_phases(id), so the constraint
--     fires immediately and the whole transaction fails.
--     Fix: demote the old phase WITHOUT superseded_by, insert the new phase,
--     then patch superseded_by in a second UPDATE.
--
--   Bug 2 — Invalid transition silently accepted when no active phase exists:
--     The RAISE for unknown p_transition values was inside the
--     IF v_existing_id IS NOT NULL block, so passing p_transition='invalid'
--     when no phase is active never reached the RAISE.
--     Fix: validate p_transition before the active-phase lookup.

CREATE OR REPLACE FUNCTION public.fn_start_goal_phase(
  p_user_id                    UUID,
  p_mode                       TEXT,
  p_started_at                 TIMESTAMPTZ,
  p_starting_weight_kg         NUMERIC,
  p_starting_weight_source     TEXT,
  p_target_weight_kg           NUMERIC    DEFAULT NULL,
  p_target_change_kg_per_week  NUMERIC    DEFAULT NULL,
  p_target_calories            NUMERIC    DEFAULT NULL,
  p_target_protein_g           NUMERIC    DEFAULT NULL,
  p_target_carbs_g             NUMERIC    DEFAULT NULL,
  p_target_fat_g               NUMERIC    DEFAULT NULL,
  p_transition                 TEXT       DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id UUID;
  v_new_id      UUID := gen_random_uuid();
BEGIN
  -- Defence-in-depth: reject cross-user calls when JWT is present.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Cannot start a phase for another user' USING ERRCODE = 'P0001';
  END IF;

  -- Bug 2 fix: validate p_transition early, before the active-phase check.
  IF p_transition IS NOT NULL AND p_transition NOT IN ('supersede', 'cancel') THEN
    RAISE EXCEPTION 'Invalid transition "%". Must be supersede or cancel.', p_transition
      USING ERRCODE = 'P0003';
  END IF;

  -- Lock the active phase row for the remainder of this transaction.
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
      -- Bug 1 fix: demote WITHOUT superseded_by first — the FK would fail because
      -- the new phase row doesn't exist yet.  We patch superseded_by after INSERT.
      UPDATE public.goal_phases
      SET status     = 'superseded',
          ended_at   = p_started_at,
          updated_at = now()
      WHERE id = v_existing_id;
    ELSIF p_transition = 'cancel' THEN
      UPDATE public.goal_phases
      SET status       = 'cancelled',
          ended_at     = p_started_at,
          ended_reason = 'Cancelled to start a new phase',
          updated_at   = now()
      WHERE id = v_existing_id;
    END IF;
  END IF;

  INSERT INTO public.goal_phases (
    id, user_id, mode, status, started_at,
    starting_weight_kg, starting_weight_source,
    target_weight_kg, target_change_kg_per_week,
    target_calories, target_protein_g, target_carbs_g, target_fat_g
  ) VALUES (
    v_new_id, p_user_id, p_mode, 'active', p_started_at,
    p_starting_weight_kg, p_starting_weight_source,
    p_target_weight_kg, p_target_change_kg_per_week,
    p_target_calories, p_target_protein_g, p_target_carbs_g, p_target_fat_g
  );

  -- Bug 1 fix cont.: now that the new row exists, back-fill superseded_by.
  IF v_existing_id IS NOT NULL AND p_transition = 'supersede' THEN
    UPDATE public.goal_phases
    SET superseded_by = v_new_id
    WHERE id = v_existing_id;
  END IF;

  RETURN v_new_id;
END;
$$;
