# ADR-008 — Cache becomes three tables, not one

**Status:** Accepted

## Decision
`user_food_cache` (per-user), `global_food_cache` (cross-user, service-role
write only), and `global_cache_promotion_votes` (tracks distinct confirming
users via a unique constraint, so counting is a plain row count).

## Why
A single `food_lookup_cache` table with no `user_id` column can't actually
implement the two-tier User Cache / Global Cache distinction FR-010 requires,
nor can it track distinct-user promotion counts (FR-011) without an extra
counter column that's easy to get wrong under concurrent writes. A unique
constraint on the votes table makes the count trivially correct.

## Consequence
Promotion to `global_food_cache` happens when
`count(*) from global_cache_promotion_votes where (query, food_id) >=
system_settings.global_cache_promotion_threshold`.
