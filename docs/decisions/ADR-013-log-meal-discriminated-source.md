# ADR-013 — log-meal takes a discriminated source, rather than three endpoints

**Status:** Accepted

## Decision
One function, `log-meal`, accepts a discriminated `source` field:
`'draft'` (normal AI/manual flow, items already resolved+calculated),
`'template'` (re-fetch a saved meal's current food data fresh — never a
stored total, per ADR-006), `'copy_previous'` (implements FR-033, "same as
yesterday"). All three converge on identical persistence logic afterward.

## Why
The user-visible flow only has two real moments — see the draft, confirm the
draft — regardless of where the draft's contents came from. Three near-
identical endpoints would triplicate the persistence/idempotency/cache-
promotion logic for no real benefit.

## Consequence
`source: 'template'` and `source: 'copy_previous'` are stubbed as
`NOT_IMPLEMENTED` (501) in the initial scaffold — the `draft` path is fully
implemented and is the one exercised by the web app's LogMeal flow.
