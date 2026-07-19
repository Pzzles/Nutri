# ADR-002 — Barcode lookup uses its own chain

**Status:** Accepted

## Decision
Barcode scanning does not use the 6-tier text lookup chain (FR-010). It uses:
1. Local `api_cache` (keyed by barcode)
2. `foods` matched by stored `barcode` column
3. Open Food Facts

USDA FoodData Central is not queried for barcode lookups.

## Why
USDA's branded-food barcode coverage is weak relative to this access pattern,
and Open Food Facts is barcode-native. Including USDA here would add latency
for a near-zero hit rate.

## Consequence
`barcode-lookup` is a separate Edge Function from `resolve-foods`, with its own
3-tier flow. See FR-014.
