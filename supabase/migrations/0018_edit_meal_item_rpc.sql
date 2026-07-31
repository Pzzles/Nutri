-- 0018_edit_meal_item_rpc.sql
-- B8: Atomic meal-item edit with guaranteed audit trail.
-- The replacement (delete-old / insert-new) and the audit-log insert execute
-- in a single PL/pgSQL transaction.  If the audit insert fails the item is
-- untouched; if the item insert fails the audit row is rolled back.
-- Implements ADR-001 (replacement strategy) with Domain Rule 2 atomicity.

CREATE OR REPLACE FUNCTION fn_edit_meal_item(
  p_meal_id       UUID,
  p_item_id       UUID,
  p_user_id       UUID,
  p_new_weight_g  NUMERIC
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item   meal_items%ROWTYPE;
  v_ratio  NUMERIC;
  v_new_id UUID;
BEGIN
  -- Verify ownership of the parent meal.
  IF NOT EXISTS (
    SELECT 1 FROM meals WHERE id = p_meal_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  -- Fetch the item and lock the row to prevent concurrent edits.
  SELECT * INTO v_item
  FROM meal_items
  WHERE id = p_item_id AND meal_id = p_meal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  IF v_item.weight_g IS NULL OR v_item.weight_g = 0 THEN
    RAISE EXCEPTION 'CANNOT_RESCALE';
  END IF;

  v_ratio := p_new_weight_g / v_item.weight_g;

  -- ── Audit FIRST ───────────────────────────────────────────────────────────
  -- Inserting the audit row before touching the data means that if the audit
  -- INSERT fails (e.g. constraint violation) the item is left unchanged and
  -- the transaction rolls back.  The caller gets an error; no silent divergence.
  INSERT INTO meal_edit_log (meal_id, field_name, old_value, new_value, edited_by)
  VALUES (
    p_meal_id,
    'item_weight_g',
    jsonb_build_object(
      'item_id',   p_item_id,
      'weight_g',  v_item.weight_g,
      'calories',  v_item.calories,
      'protein_g', v_item.protein_g
    ),
    jsonb_build_object(
      'weight_g',  p_new_weight_g,
      'calories',  round((v_item.calories  * v_ratio)::NUMERIC, 1),
      'protein_g', round((v_item.protein_g * v_ratio)::NUMERIC, 1)
    ),
    p_user_id
  );

  -- ── Replace: delete old row, insert new (ADR-001) ─────────────────────────
  DELETE FROM meal_items WHERE id = p_item_id;

  INSERT INTO meal_items (
    food_id, meal_id, raw_phrases,
    quantity, unit, weight_g,
    calories, protein_g, carbs_g, fat_g, fibre_g,
    match_confidence, portion_confidence, confidence,
    nutrition_source
  ) VALUES (
    v_item.food_id, p_meal_id, v_item.raw_phrases,
    p_new_weight_g, 'g', p_new_weight_g,
    round((v_item.calories  * v_ratio)::NUMERIC, 1),
    round((v_item.protein_g * v_ratio)::NUMERIC, 1),
    round((v_item.carbs_g   * v_ratio)::NUMERIC, 1),
    round((v_item.fat_g     * v_ratio)::NUMERIC, 1),
    CASE WHEN v_item.fibre_g IS NOT NULL
         THEN round((v_item.fibre_g * v_ratio)::NUMERIC, 1) END,
    v_item.match_confidence,
    'estimated',
    v_item.confidence,
    v_item.nutrition_source
  )
  RETURNING id INTO v_new_id;

  RETURN (
    SELECT row_to_json(r)
    FROM (SELECT * FROM meal_items WHERE id = v_new_id) r
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_edit_meal_item(UUID, UUID, UUID, NUMERIC)
  TO authenticated, service_role;
