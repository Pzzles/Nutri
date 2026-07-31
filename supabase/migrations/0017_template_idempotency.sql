-- 0017_template_idempotency.sql
-- B3: Make saved-meal-template creation idempotent.
-- The client supplies an idempotency_key; the DB enforces uniqueness so that
-- concurrent duplicate saves cannot create two rows (ON CONFLICT DO NOTHING
-- inside a SECURITY DEFINER function — atomic by default in PL/pgSQL).

-- ── 1. Add idempotency_key column ─────────────────────────────────────────────
ALTER TABLE saved_meals ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Unique per user (NULL keys are allowed for older rows without a key).
-- We explicitly NULLS NOT DISTINCT so two NULLs from the same user do NOT
-- conflict — legacy rows without keys are unaffected.
ALTER TABLE saved_meals
  DROP CONSTRAINT IF EXISTS uq_saved_meals_idem;

-- Standard UNIQUE allows multiple NULLs per PostgreSQL semantics; the unique
-- constraint only fires on non-NULL keys (which is exactly what we want).
ALTER TABLE saved_meals
  ADD CONSTRAINT uq_saved_meals_idem UNIQUE (user_id, idempotency_key);

-- ── 2. Atomic save RPC ────────────────────────────────────────────────────────
-- fn_save_meal_template(user_id, idempotency_key, name, description, items)
-- Returns the saved_meal id (new or existing).
-- Uses ON CONFLICT DO NOTHING so two concurrent calls with the same key
-- produce exactly one row — no TOCTOU window.

CREATE OR REPLACE FUNCTION fn_save_meal_template(
  p_user_id       UUID,
  p_idem_key      TEXT,
  p_name          TEXT,
  p_description   TEXT,
  p_items         JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  -- Try to insert; silently skip if the key already exists for this user.
  INSERT INTO saved_meals (user_id, idempotency_key, name, description)
  VALUES (p_user_id, p_idem_key, p_name, p_description)
  ON CONFLICT (user_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  -- Conflict: the template already exists — return its id without re-inserting items.
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM saved_meals
    WHERE user_id = p_user_id AND idempotency_key = p_idem_key;
    RETURN v_id;
  END IF;

  -- New template: insert items in the same transaction.
  -- If any item insert fails the whole function rolls back.
  INSERT INTO saved_meal_items (saved_meal_id, food_id, default_quantity, default_unit)
  SELECT
    v_id,
    (item ->> 'food_id')::UUID,
    (item ->> 'quantity')::NUMERIC,
    item ->> 'unit'
  FROM jsonb_array_elements(p_items) AS item;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_save_meal_template(UUID, TEXT, TEXT, TEXT, JSONB)
  TO authenticated, service_role;
