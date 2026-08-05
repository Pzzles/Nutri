# Environment and stale-branch audit — 2026-08-05

## Repository result

The remote branch `fix/anthropometry-retake-confidence` ended at
`7b9a2c1a6310b6fcb06da57092d3cb104927f256`. Its complete patch was identical
to `81f4ba33310aa68cf315e1a5099b94c6158cc641`, which was incorporated into the
Phase 10 remediation history and merged through PR #28.

Later representative-v3 commits intentionally superseded the v2 behavior that
always blocked finalisation. Current behavior preserves all readings, selects
the deterministic closest pair, allows an explicitly acknowledged
high-variability result to be finalised, and excludes that result from automatic
interpretation. The stale branch contains no unique release work.

## Environment result

Read-only Supabase CLI inspection found:

| Target | Migration state | Function state |
|---|---|---|
| Local CLI stack | Through `0036` | Current source served locally |
| Linked production project | Through `0032` | Anthropometry endpoints deployed before remediation |

Production was missing migrations `0033`–`0036`. Its remote function inventory
also lacked `delete-account`, `export-my-data`, and `save-maintenance-estimate`.
No production mutation was performed during this audit.

## Controls added

- default development now injects only the loopback Supabase CLI target;
- Playwright uses a separate internal Vite command and supplies its own target;
- deployment preflight compares migration and function inventories;
- CI validates the preflight parser and local deployment contract;
- production documentation requires staging rehearsal, backup, ordered backend
  deployment, a zero-drift gate, and smoke tests before web promotion.
