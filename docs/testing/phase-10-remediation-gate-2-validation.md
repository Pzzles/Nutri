# Phase 10 Remediation Gate 2 Validation

Branch: `fix/anthropometry-phase10-remediation`

Starting HEAD: `a08e20e1d90d844321f7b0ce2971a7e955308174`

Starting `origin/master`: `478443180fea53653945ff3a3f5d9ac1da9df190`

## Pre-fix race reproduction

The `0034` schema was exercised before migration `0035` with independent
PostgreSQL connections. Transaction A updated the locked parent to finalised
without committing. Connection B inserted reading 3 while A's status change
was uncommitted. B did not wait: `pg_stat_activity` reported it `idle` with
`wait_event_type = Client`, and the insert completed before A committed. After
A committed, the session was `finalized` with three readings. Exact result:

```json
{
  "transaction_a_uncommitted": true,
  "mutation_b_completed_before_a_commit": true,
  "b_state": { "wait_event_type": "Client", "state": "idle" },
  "final": { "status": "finalized", "reading_count": 3 }
}
```

This proved a stronger form of the audited race: the original trigger's plain
parent `SELECT` neither locked nor conflicted with finalisation.

## Implemented boundary

- Reading insert, update, and direct delete lock the parent with `FOR UPDATE`,
  then re-check owner and `draft` status.
- Referential cascade deletes are distinguished from direct child deletes.
- Representative updates/deletes are immutable; inserts require the
  transaction-local marker set only by the authoritative finalisation RPC.
- Both child tables carry `user_id NOT NULL` and composite cascading foreign
  keys to `(anthropometric_sessions.id, anthropometric_sessions.user_id)`.
- Authenticated and anonymous mutation privileges are revoked on sessions,
  readings, and representatives. Authenticated direct access is read-only and
  protected by `auth.uid() = user_id` policies.
- History, progress, export, saved-session loads, and deletion explicitly pass
  the authenticated owner into every privileged anthropometry query/RPC.
- Account erasure is one Auth hard-delete transaction backed by PostgreSQL
  cascades. No unchecked REST delete sequence remains.

## Concurrency acceptance

The deterministic suite observes B's backend in `pg_stat_activity` and proceeds
only after `wait_event_type = Lock`; sleeps are used only to poll that database
barrier. Insert, update, and delete all block behind A, then fail with SQLSTATE
`55000` after A commits. Each final session retains exactly two readings and
one matching `80.2 cm` representative. Same-key finalisations return one create
and one replay; different-key finalisations return one create and one stable
`SESSION_IMMUTABLE`; a lost-response retry replays one persisted result.

## Account-deletion failure proof

The local-only harness created a restrictive foreign key to `auth.users`, then
called the real Edge Function against a user populated in all 24 inventoried
private table/child paths. Auth returned a database failure, the endpoint
returned `ACCOUNT_DELETION_RETRY_REQUIRED`, the Auth user remained, and every
pre-deletion row count was identical. Removing the blocker and retrying returned
`ACCOUNT_DELETION_COMPLETE`; Auth and every private row were then absent.

There is no separate Auth stage, so an Auth-stage dependency-injection test is
not applicable. Auth deletion and application cascades are the same PostgreSQL
transaction.

## Verification matrix

| Working directory | Exact command | Exit | Passed | Failed | Skipped | Duration |
|---|---|---:|---:|---:|---:|---:|
| repository root | `supabase db reset` (first clean reset) | 0 | 1 | 0 | 0 | 58.790 s |
| repository root | `supabase db reset` (second clean reset) | 0 | 1 | 0 | 0 | 45.146 s |
| repository root | `supabase db diff --local` | 0 | 1 (empty) | 0 | 0 | 55.506 s |
| `supabase/tests` | `npm test -- --run _shared/anthropometry.test.ts` | 0 | 16 | 0 | 0 | 2.105 s |
| `supabase/tests` | `npm test -- --run anthropometry-api.test.ts` | 0 | 34 | 0 | 0 | 20.914 s |
| `supabase/tests` | `npm test -- --run anthropometry-concurrency.test.ts` | 0 | 6 | 0 | 0 | 8.378 s |
| `supabase/tests` | `npm test -- --run rls.test.ts anthropometry-security.test.ts anthropometry-query-scope.test.ts` | 0 | 36 | 0 | 0 | 5.567 s |
| `supabase/tests` | `npm test -- --run account-deletion.test.ts` | 0 | 5 | 0 | 0 | 10.391 s |
| `supabase/tests` | `npm test -- --run anthropometry-api.test.ts -t "data export"` | 0 | 1 | 0 | 33 (filtered) | 4.601 s |
| `web` | local-env `npx playwright test anthropometry-measurement.spec.ts anthropometry-trends.spec.ts integration/anthropometry.spec.ts` | 0 | 6 | 0 | 0 | 26.196 s |
| `supabase/tests` | `npm test` | 0 | 425 | 0 | 0 | 121.832 s |
| `web` | `npm test` | 0 | 1006 | 0 | 0 | 23.949 s |
| `web` | `npx tsc -b --pretty false` | 0 | 1 | 0 | 0 | 8.383 s |
| `web` | `npm run build` | 0 | 1 | 0 | 0 | 20.098 s |

The first browser invocation reused a stale port-5173 Vite process configured
for a different Supabase host and therefore failed four authentication setup
steps (two mocked tests still passed). It was not counted as acceptance. The
required isolated local-env rerun above passed all six tests. The existing Vite
large-chunk advisory and React Router future-flag warnings remain non-blocking.

## Regression boundary

The Gate 1 pure fixtures remain 16/16 with unchanged expected values.
`anthropometry_representative_v3`, the 1.0 cm repeatability threshold,
closest-pair selection/provenance, high-variability acknowledgement, Phase 6-8
calculations, calorie targets, and active goal-phase behaviour were not changed.
