# ADR-003 — Food Resolution Engine supersedes "Nutrition Lookup Service"

**Status:** Accepted

## Decision
One canonical component, the **Food Resolution Engine**, absorbs synonym
resolution, all cache/API tiers, portion resolution, confidence calculation,
and duplicate detection as internal sub-modules. Any AI parser (Claude, or a
future replacement) must implement a frozen `FoodParserAdapter` interface
producing only `ParsedFoodItem[]` — nothing else may cross that boundary.

Duplicate detection runs **after** resolution, on resolved `food_id`, not on
raw `normalized_name`.

## Why
Naming this as one component (rather than "Nutrition Lookup Service" plus
several unnamed peers) makes the AI/business-logic boundary from
`04-system-architecture.md` explicit rather than implied. Running duplicate
detection post-resolution catches cases like "coke" and "coca-cola" that only
reveal themselves as duplicates once both resolve to the same food — which is
impossible to catch on raw text alone.

## Consequence
Swapping the AI provider means writing a new adapter that produces the same
`ParsedFoodItem[]` shape; nothing downstream of that boundary changes. FR-005
(duplicate detection) is implemented in `resolve-foods`, after the lookup
chain, not in `parse-meal`.
