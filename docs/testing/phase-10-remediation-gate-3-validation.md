# Phase 10 Remediation Gate 3 Validation Evidence

Date: 2026-08-03<br>
Branch: `fix/anthropometry-phase10-remediation`<br>
Starting HEAD: `d3e1182536f58c9d404a32a941f78a470e7f1973`<br>
Starting `origin/master`: `478443180fea53653945ff3a3f5d9ac1da9df190`

This record covers measurement context, protocol compatibility, change-summary
v2, canonical Phase 6 interval classification, Phase 5–8 non-interference,
history pagination, export provenance, and the retained Gate 1–2 guarantees.
It does not declare the final Phase 10 audit complete; Gate 4 remains pending.

## Acceptance evidence

- Structured context is optional, strictly typed, stored in explicit columns,
  included in idempotency, returned in history, and exported. `local_time` is
  derived by the server from `measured_at` and the profile time zone.
- Legacy null context remains readable. Context differences produce warning
  codes only and never rewrite, invalidate, or hide a measurement.
- Protocol compatibility is explicit and versioned. Unknown or incompatible
  protocols remain visible but are excluded from automatic change and
  weight/circumference comparisons, with the stable warning code
  `protocol_versions_not_comparable`. Representative v2 and v3 rows remain
  comparable when their anthropometry protocol is compatible.
- `anthropometry_change_summary_v2` uses only observed, eligible, compatible
  points. It does not interpolate dates or values and uses the unrounded 0.5 cm
  direction boundary.
- `anthropometry_weight_comparison_v2` derives direction only from the canonical
  Phase 6 weekly-rate lower and upper bounds. An interval containing zero is
  `broadly_stable_or_uncertain`; no EWMA point-change fallback exists.
- The before/after fixture serializes the canonical Phase 5 target, Phase 6
  trend, Phase 7 maintenance, and Phase 8 assessment outputs and proves byte
  equivalence after executing the anthropometry engine. A static dependency
  check also proves those production modules and endpoints do not import or
  query anthropometry.
- The authenticated history stress fixture creates 1,005 finalized sessions,
  reads them across 11 cursor pages of at most 100, and proves stable ordering,
  unique complete coverage, and correct association of two raw readings and one
  representative per session.
- `nutri_data_export_v3` includes sessions, raw readings, representatives,
  structured context, and current algorithm provenance.
- Account deletion retains the Gate 2 transaction, failure-injection, retry,
  idempotency, and complete anthropometry-cascade coverage.

## Executed command matrix

All commands below exited zero. Passed/failed/skipped counts are test cases when
the runner reports cases; database and build commands report one command-level
pass. Durations are wall-clock durations recorded by the verification wrapper.

| Scope | Working directory | Exact command | Exit | Passed | Failed | Skipped | Duration |
|---|---|---|---:|---:|---:|---:|---:|
| First clean database reset | repository root | `supabase db reset --local --no-seed` | 0 | 1 | 0 | 0 | 33.030 s |
| Second clean database reset | repository root | `supabase db reset --local --no-seed` | 0 | 1 | 0 | 0 | 34.302 s |
| Schema drift | repository root | `supabase db diff --local --schema public` | 0 | 1 | 0 | 0 | 25.853 s |
| Gate 1 representative v3 | `supabase/tests` | `npm test -- _shared/anthropometry.test.ts` | 0 | 16 | 0 | 0 | 1.820 s |
| Gate 2 concurrency | `supabase/tests` | `npm test -- anthropometry-concurrency.test.ts` | 0 | 6 | 0 | 0 | 3.491 s |
| Complete RLS operations and ownership | `supabase/tests` | `npm test -- rls.test.ts anthropometry-security.test.ts anthropometry-query-scope.test.ts` | 0 | 36 | 0 | 0 | 4.221 s |
| Gate 2 deletion/failure/retry | `supabase/tests` | `npm test -- account-deletion.test.ts` | 0 | 5 | 0 | 0 | 6.493 s |
| Context, change-summary, Phase 6 interval | `supabase/tests` | `npm test -- _shared/anthropometryProgress.test.ts` | 0 | 11 | 0 | 0 | 1.246 s |
| Phase 5–8 non-interference | `supabase/tests` | `npm test -- _shared/anthropometryNonInterference.test.ts` | 0 | 2 | 0 | 0 | 1.321 s |
| API, >1,000 pagination, and export | `supabase/tests` | `npm test -- anthropometry-api.test.ts` | 0 | 37 | 0 | 0 | 17.308 s |
| Mocked anthropometry Playwright | `web` | `npx playwright test e2e/anthropometry-measurement.spec.ts e2e/anthropometry-trends.spec.ts --project=mocked --workers=1` | 0 | 2 | 0 | 0 | 4.617 s |
| Real authenticated anthropometry Playwright | `web` | `npx playwright test e2e/integration/anthropometry.spec.ts --project=integration --workers=1` | 0 | 7 | 0 | 0 | 29.567 s |
| Full backend | `supabase/tests` | `npm test` | 0 | 423 | 0 | 0 | 127.446 s |
| Full frontend | `web` | `npm test` | 0 | 1,008 | 0 | 0 | 18.865 s |
| TypeScript typecheck | `web` | `npx tsc -b --pretty false` | 0 | 1 | 0 | 0 | 10.209 s |
| Production build | `web` | `npm run build` | 0 | 1 | 0 | 0 | 23.115 s |

The schema diff was empty. Both resets applied migrations `0001` through `0036`
from clean databases. The known Vite large-chunk advisory and React Router v7
future-flag notices remain non-blocking baseline warnings.

During evidence collection, one preliminary API stress rerun coincided with the
local Supabase Edge Runtime container exiting cleanly and Kong returned one 502.
The unchanged test then passed 37/37 after the local runtime restarted, and the
subsequent clean-reset full backend run passed 423/423 including the same 1,005
row fixture. The isolated real Playwright run also passed 7/7 afterward.

## Scientific wording audit

The prohibited-claim search found no affirmative claim that circumference
change equals fat loss, muscle gain, body-fat change, visceral-fat change, or
body recomposition. Matches were explicit limitations such as “does not infer”
and “does not directly measure.” Server descriptions combine only observed
circumference direction with the Phase 6 interval direction.

## Status

Phase 10 remediation Gates 1–3 are implemented. Gate 4 final validation is
pending. No pull request was created and the branch was not merged.
