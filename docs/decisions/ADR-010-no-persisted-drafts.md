# ADR-010 — No persisted meal_drafts table

**Status:** Accepted

## Decision
Draft meal state (between `parse-meal` and `log-meal`) is transient
client-side state, not a database table. `ai_parse_requests` is the only
server-side trace of an attempt that hasn't yet become a logged meal —
its `meal_id` is null until `log-meal` backfills it.

## Why
A `meal_drafts` table would need its own cleanup/expiry logic for a
concept that only exists for the few seconds between parsing and
confirmation. `ai_parse_requests` already captures what's needed for
debugging without that overhead.

## Consequence
If a user parses a meal and never confirms it, the only trace left is the
`ai_parse_requests` row with `meal_id: null` — which is exactly the intended
behavior, not a data-loss bug.
