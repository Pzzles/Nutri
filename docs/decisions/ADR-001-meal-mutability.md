# ADR-001 — Meal mutability model

**Status:** Accepted

## Decision
Meals are mutable in place, not versioned. Edits update the `meals`/`meal_items`
rows directly. A `meal_edit_log` table records `{meal_id, field_name, old_value,
new_value, edited_at, edited_by}` for every change.

## Why
The domain model's original language ("immutable historical records... editing
updates its current version while preserving an audit trail") was internally
contradictory — immutability and in-place versioned edits are different
patterns. Full versioning (a new row per edit) is more machinery than a
single-user V1 app needs.

## Consequence
Dashboard totals (FR-040) always reflect current state. Historical
reconstruction of a specific past state requires replaying the edit log, not
reading a frozen row. `edit-meal` is the only function permitted to write to
`meal_edit_log`.
