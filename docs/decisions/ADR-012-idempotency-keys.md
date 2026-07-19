# ADR-012 — Idempotency via a dedicated table

**Status:** Accepted

## Decision
Any mutating function that could plausibly be double-submitted (`log-meal`,
`log-weight`) requires a client-generated `idempotency_key` (uuid) in the
request body. The `idempotency_keys` table stores the first response keyed
on `(user_id, idempotency_key, function_name)`; a repeated key returns the
stored response instead of re-executing.

## Why
Mobile clients in particular can double-submit on flaky connections (a
request succeeds server-side but the client times out and retries). Without
this, a retry after a dropped response would log the same meal twice.

## Consequence
Every client-facing mutation that logs data (not pure reads) should generate
a fresh `crypto.randomUUID()` per user action, not per request — retries of
the *same* action reuse the same key.
