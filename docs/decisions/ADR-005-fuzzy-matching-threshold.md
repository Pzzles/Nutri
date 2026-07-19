# ADR-005 — Fuzzy matching: fixed threshold, not configurable

**Status:** Accepted

## Decision
Trigram similarity (Postgres `pg_trgm`) >= 0.75 as the primary signal. For
query strings under 8 characters, additionally require Levenshtein distance
<= 2 (trigram similarity is unreliable on short strings). These are hardcoded
constants for V1, not a `system_settings` entry.

## Why
No deployment-specific tuning need exists yet for a single-user app. A config
table adds surface area nobody will use. Becomes a one-line code change later
if the threshold turns out wrong — not a data migration.

## Consequence
`fn_fuzzy_food_search` (Postgres function) is the single implementation of
this rule, used by both `resolve-foods` and `search-food`. A fuzzy hit always
sets `match_confidence: 'partial'`, never `'exact'` (FR-075 AC2).
