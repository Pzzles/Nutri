-- BUG-001: fn_log_meal read item->>'weight_g' (the DB column name) but the
-- TypeScript CalculatedItem sent by the client uses the key 'portion_g'.
-- meal_items.weight_g was NULL for every logged meal as a result.
-- One-line fix: read item->>'portion_g' instead.

create or replace function fn_log_meal(
  p_user_id uuid,
  p_meal_type text,
  p_eaten_at timestamptz,
  p_logged_date date,
  p_meal_confidence text,
  p_raw_input text,
  p_parsed_json jsonb,
  p_items jsonb
) returns uuid
language plpgsql
security definer
as $$
declare
  v_meal_id uuid;
begin
  if p_user_id <> auth.uid() then
    raise exception 'Cannot log meal for another user';
  end if;

  insert into meals (user_id, raw_input, parsed_json, meal_type, meal_confidence, eaten_at, logged_date)
  values (p_user_id, p_raw_input, p_parsed_json, p_meal_type, p_meal_confidence, p_eaten_at, p_logged_date)
  returning id into v_meal_id;

  insert into meal_items (
    meal_id, food_id, raw_phrases, quantity, unit, weight_g,
    calories, protein_g, carbs_g, fat_g, fibre_g,
    match_confidence, portion_confidence, confidence, nutrition_source
  )
  select
    v_meal_id,
    (item->>'food_id')::uuid,
    coalesce(item->'raw_phrases', '[]'::jsonb),
    (item->>'quantity')::numeric,
    item->>'unit',
    (item->>'portion_g')::numeric,
    (item->>'calories')::numeric,
    (item->>'protein_g')::numeric,
    (item->>'carbs_g')::numeric,
    (item->>'fat_g')::numeric,
    (item->>'fibre_g')::numeric,
    item->>'match_confidence',
    item->>'portion_confidence',
    item->>'confidence',
    item->>'nutrition_source'
  from jsonb_array_elements(p_items) as item;

  return v_meal_id;
end;
$$;
