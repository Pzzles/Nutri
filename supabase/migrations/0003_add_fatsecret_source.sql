-- Add 'fatsecret' as a valid foods.source value.
-- The check constraint must be dropped and re-added; PostgreSQL has no ALTER CONSTRAINT.
ALTER TABLE foods DROP CONSTRAINT IF EXISTS foods_source_check;
ALTER TABLE foods ADD CONSTRAINT foods_source_check
  CHECK (source IN ('usda_fdc', 'open_food_facts', 'user_manual', 'imported', 'fatsecret'));
