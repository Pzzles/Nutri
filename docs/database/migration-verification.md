# Database Migration Verification

Date: 2026-08-02  
Verified on: local Supabase stack (PostgreSQL 15)  
Command: `supabase db reset --local`

All 28 migrations apply cleanly in order with zero errors.

---

## Migration inventory

| # | File | Purpose |
|---|------|---------|
| 0001 | `0001_init_schema.sql` | Full schema: profiles, foods, meals, meal_items, weight_logs, goal_phases, daily_log_status, caches, RLS policies, fn_log_weight, fn_start_goal_phase |
| 0002 | `0002_add_meal_templates.sql` | Meal templates table |
| 0003 | `0003_add_portion_history.sql` | Portion history table and fn_upsert_portion_history |
| 0004 | `0004_add_fuzzy_search.sql` | pg_trgm extension, fn_fuzzy_food_search |
| 0005 | `0005_add_barcode_lookup.sql` | Barcode column on foods table |
| 0006 | `0006_add_global_food_cache.sql` | global_food_cache table |
| 0007 | `0007_add_user_food_cache.sql` | user_food_cache table |
| 0008 | `0008_add_system_settings.sql` | system_settings table (used by health endpoint) |
| 0009 | `0009_goal_phase_and_daily_log.sql` | goal_phases table, fn_start_goal_phase (v1) |
| 0010 | `0010_add_weight_trend.sql` | Weight trend calculation infrastructure |
| 0011 | `0011_fix_goal_phase_function.sql` | Bug fixes in fn_start_goal_phase |
| 0012 | `0012_add_activity_history.sql` | Activity level history table |
| 0013 | `0013_add_fibre_targets.sql` | Fibre target column on goal_phases; fn_start_goal_phase with fibre |
| 0014 | `0014_add_meal_type_constraint.sql` | CHECK constraint on meals.meal_type |
| 0015 | `0015_add_edit_meal_item.sql` | fn_edit_meal_item RPC |
| 0016 | `0016_add_delete_meal.sql` | fn_delete_meal RPC |
| 0017 | `0017_add_daily_log_reopen_trigger.sql` | trg_reopen_daily_log_on_meal trigger |
| 0018 | `0018_edit_meal_item_rpc.sql` | Revised fn_edit_meal_item (row-replace pattern) |
| 0019 | `0019_calculation_snapshots.sql` | calorie_target_snapshots table, fn_start_goal_phase_v2 |
| 0020 | `0020_snapshot_provenance.sql` | Adds weight_measured_at, weight_log_source, input_provenance to snapshots; rebuilds fn_start_goal_phase_v2 |
| 0021 | `0021_weight_logs_source.sql` | Adds source column to weight_logs; recreates fn_log_weight with 6 params (BUG: creates second overload) |
| 0022 | `0022_fix_goal_phase_insert_order.sql` | Fixes circular FK between goal_phases and calorie_target_snapshots |
| 0023 | `0023_adaptive_maintenance.sql` | maintenance_estimates table, adaptive maintenance infrastructure |
| 0024 | `0024_fix_daily_log_status_constraint.sql` | Fixes daily_log_status unique constraint |
| 0025 | `0025_goal_feedback_assessments.sql` | goal_feedback_assessments table v1 |
| 0026 | `0026_goal_feedback_assessment_v2.sql` | Adds rate bounds and adjustment columns to goal_feedback_assessments |
| 0027 | `0027_fix_fn_log_weight_overload.sql` | **Phase 9 fix**: drops the original 5-param fn_log_weight overload (resolves PGRST203) |
| 0028 | `0028_fix_supersede_fk_order.sql` | **Phase 9 fix**: defers superseded_by FK backfill until after new phase row exists |

---

## RLS verification

All user-data tables have RLS enabled and at minimum one policy:

| Table | Policy | Condition |
|-------|--------|-----------|
| profiles | `profiles_all_own` | `auth.uid() = id` |
| weight_logs | `weight_logs_all_own` | `auth.uid() = user_id` |
| goal_phases | `goal_phases_all_own` | `auth.uid() = user_id` |
| calorie_target_snapshots | `calorie_target_snapshots_all_own` | `auth.uid() = user_id` |
| meals | `meals_all_own` | `auth.uid() = user_id` |
| meal_items | `meal_items_all_own` | via meals FK |
| daily_log_status | `daily_log_status_all_own` | `auth.uid() = user_id` |
| user_food_cache | `user_food_cache_all_own` | `auth.uid() = user_id` |
| goal_feedback_assessments | `goal_feedback_assessments_all_own` | `auth.uid() = user_id` |

`foods` table: global foods have `owner_user_id IS NULL`; user-created foods have `owner_user_id = auth.uid()`.

---

## Known clean-apply result

```
supabase db reset --local output (2026-08-02):
  Applying migration 0001_init_schema.sql...
  [...]
  Applying migration 0027_fix_fn_log_weight_overload.sql...
  Applying migration 0028_fix_supersede_fk_order.sql...
  WARN: no files matched pattern: supabase/seed.sql
  Restarting containers...
  Finished supabase db reset on branch feat/product-deployment-hardening.
```
