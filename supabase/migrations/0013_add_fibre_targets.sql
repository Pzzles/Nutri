-- 0013_add_fibre_targets.sql
--
-- Adds target_fibre_g to goal_phases and user_goals, and updates
-- fn_start_goal_phase to accept and persist the new parameter.

ALTER TABLE public.goal_phases
  ADD COLUMN IF NOT EXISTS target_fibre_g NUMERIC DEFAULT NULL;

ALTER TABLE public.user_goals
  ADD COLUMN IF NOT EXISTS target_fibre_g NUMERIC DEFAULT NULL;

-- Recreate fn_start_goal_phase with the p_target_fibre_g parameter.
-- p_transition is last (as before) so callers passing positional args are unaffected.
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
  p_target_fibre_g             NUMERIC    DEFAULT NULL,
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
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Cannot start a phase for another user' USING ERRCODE = 'P0001';
  END IF;

  IF p_transition IS NOT NULL AND p_transition NOT IN ('supersede', 'cancel') THEN
    RAISE EXCEPTION 'Invalid transition "%". Must be supersede or cancel.', p_transition
      USING ERRCODE = 'P0003';
  END IF;

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
    target_calories, target_protein_g, target_carbs_g, target_fat_g, target_fibre_g
  ) VALUES (
    v_new_id, p_user_id, p_mode, 'active', p_started_at,
    p_starting_weight_kg, p_starting_weight_source,
    p_target_weight_kg, p_target_change_kg_per_week,
    p_target_calories, p_target_protein_g, p_target_carbs_g, p_target_fat_g, p_target_fibre_g
  );

  IF v_existing_id IS NOT NULL AND p_transition = 'supersede' THEN
    UPDATE public.goal_phases
    SET superseded_by = v_new_id
    WHERE id = v_existing_id;
  END IF;

  RETURN v_new_id;
END;
$$;
