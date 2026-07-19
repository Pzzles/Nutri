# ADR-006 — Saved meal totals are computed live, never stored

**Status:** Accepted

## Decision
A Saved Meal (template)'s nutrition totals are always computed from current
food data on read. Only an actual **logged** meal instance stores a frozen
snapshot.

## Why
Templates should reflect current reality. If a referenced food's nutrition
data is later corrected (e.g. a USDA record is fixed), a template with a
stored total would silently go stale. Logged meals are historical records
(Domain Rule 2) and are the only thing that should freeze.

## Consequence
`saved_meal_items` stores only `food_id` + default quantity/unit — no
calorie/macro columns. `log-meal`'s `source: 'template'` path re-runs the
full resolve/calculate logic against current `foods` data every time.
