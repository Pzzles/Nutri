-- 0010_fix_role_grants.sql
--
-- Supabase hosted automatically grants SELECT/INSERT/UPDATE/DELETE on public
-- schema tables to authenticated and service_role via default privileges that
-- are configured before migrations run. Local development does not replicate
-- this automatically, so this migration makes those grants explicit for all
-- existing tables and sets default privileges for any future tables.
--
-- This migration is safe to apply to a hosted project — GRANT is idempotent.

-- ── Existing tables ───────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.ai_parse_requests,
  public.api_cache,
  public.daily_log_status,
  public.food_synonyms,
  public.foods,
  public.global_cache_promotion_votes,
  public.global_food_cache,
  public.goal_phases,
  public.idempotency_keys,
  public.meal_edit_log,
  public.meal_items,
  public.meals,
  public.profiles,
  public.saved_meal_items,
  public.saved_meals,
  public.system_settings,
  public.user_food_cache,
  public.user_food_portions,
  public.user_goals,
  public.user_saved_foods,
  public.weight_logs
TO anon, authenticated, service_role;

-- ── Future tables ─────────────────────────────────────────────────────────────

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
