# Phase 10 Gate 3 Validation Evidence

> **Historical pre-remediation record (2026-08-02).** Current API, RLS,
> ownership, context, and final regression evidence is in the
> [Phase 10 remediation final evidence](phase-10-validation-evidence.md).

> Historical evidence for the original Phase 10 Gate 3. Superseded by
> `phase-10-remediation-gate-3-validation.md`; retained for audit history.

Date: 2026-08-02<br>
Branch: `feat/anthropometric-progress-tracking`<br>
Scope: authenticated anthropometric persistence, history, deletion, RLS and real Supabase integration

## Gate-specific evidence

`supabase/tests/anthropometry-api.test.ts` runs against the local Supabase PostgreSQL, Auth and Edge Functions stack without mocks. All 22 tests pass.

The suite proves:

- all four endpoints reject unauthenticated requests;
- drafts preserve partial raw readings and full replacement removes stale readings;
- finalisation calculates representatives and quality metadata on the server;
- calculated fields supplied by a client are rejected, including nested fields;
- failed final validation leaves an existing draft and its readings unchanged;
- finalised sessions, raw readings and representatives cannot be mutated through client access;
- the privileged atomic persistence RPC cannot be executed by `authenticated` clients;
- sequential retries replay one result and different payloads conflict;
- concurrent identical requests serialize to one finalised session;
- two authenticated users cannot read, overwrite or delete each other's data;
- `(measured_at, id)` cursor pagination is stable and has no page overlap;
- exact-site history filtering does not include other measurement sites;
- explicit deletion removes the session and both child collections by cascade;
- `nutri_data_export_v2` includes sessions, raw readings and representatives.

## Regression results

| Gate | Command | Result |
|---|---|---:|
| Real backend and database suite | `cd supabase/tests && npm test` | 381/381 tests passed across 18 files |
| Focused Gate 3 suite after final handler hardening | `cd supabase/tests && npm test -- anthropometry-api.test.ts` | 22/22 passed |
| Frontend regression | `cd web && npm test` | 977/977 tests passed across 21 files |
| TypeScript and production bundle | `cd web && npm run build` | Passed |
| Database migration ledger | `supabase db push --local --dry-run` | Local database up to date through `0032` |
| PostgreSQL schema lint | `supabase db lint --local --level warning` | No schema errors or warnings |

The existing Vite large-chunk advisory and React Router future-flag notices remain non-blocking baseline warnings. No anthropometric measurement code changes calorie targets, goal phases, Phase 8 feedback, or weight trend calculations.
