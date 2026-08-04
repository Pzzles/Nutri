# Phase 10 Final Audit

> **Historical pre-remediation record (2026-08-02).** This audit covers the
> original feature branch through migration `0032`. It is superseded by the
> [Phase 10 remediation final evidence](phase-10-validation-evidence.md).

Date: 2026-08-02

Branch: `feat/anthropometric-progress-tracking`

Scope: full validation and PR readiness for anthropometric progress tracking

## Final behavior audited

- Raw centimetre readings are preserved independently from server-calculated representatives.
- Draft sessions remain editable and deletable; finalised sessions are immutable.
- Waist uses the named WHO midpoint landmark. Abdomen at navel remains a separate personal-progress site and is never compared with waist-risk thresholds.
- Missing sites remain absent. No missing value becomes zero, and no date or value is interpolated.
- Longitudinal charts contain recorded points only, with no smoothing line.
- Cross-signal descriptions use versioned server output and nearby observed Phase 6 trend points only.
- Anthropometry does not write calorie targets, goal phases, maintenance estimates, or goal-feedback assessments.

## Clean database and migration verification

`npx supabase db reset --local` recreated the local PostgreSQL database and applied every repository migration in order from `0001` through `0032`, including:

- `0031_anthropometric_progress_model.sql`
- `0032_anthropometric_api_rpcs.sql`

The reset completed successfully. `npx supabase migration list --local` then reported matching local and applied versions for every migration, with no pending or divergent entry.

The full backend suite ran after this clean reset, so schema, RLS, RPC, Edge Function, and legacy behavior were exercised against the newly created database rather than retained local state.

## Real authenticated end-to-end flow

The Chromium integration test `web/e2e/integration/anthropometry.spec.ts` uses a real local Supabase user, real JWT, real Edge Functions, and the real database. At a 390 × 844 viewport it verifies:

1. A prior finalised WHO-waist session is created through the authenticated API.
2. The user opens the guided measurement workflow and completes two current raw readings using the keyboard.
3. Draft saves and finalisation use the production endpoints.
4. The UI displays the server representative of 88.4 cm and states that the finalised session cannot be edited or reopened.
5. The database contains two finalised sessions, four unmodified raw readings, and two `mean_of_two` representatives calculated under `anthropometry_representative_v1`.
6. History displays exactly two recorded points, the −3.6 cm observed change, and the no-smoothing/no-interpolation chart description.
7. Neither the record flow nor the history view creates horizontal overflow at the mobile viewport.

The test deletes its temporary auth user in `finally`; database cascades remove the test user's anthropometry records.

## Irregular cadence matrix

Deterministic pure fixtures pass for all required schedules:

| Schedule | Recorded dates | Proven result |
|---|---:|---|
| Daily | 4 | Four actual ordered points; previous interval 1 day; baseline interval 3 days |
| Fortnightly | 3 | Three actual ordered points; previous interval 14 days; baseline interval 28 days |
| Monthly | 3 | Calendar dates spanning 28- and 31-day gaps remain untouched; previous interval 31 days; baseline interval 59 days |
| Sporadic | 3 | Uneven 9- and 73-day gaps remain untouched; previous interval 73 days; baseline interval 82 days |

Each fixture is supplied in reverse order to prove deterministic chronological ordering. Point counts and timestamps must equal the input exactly, which detects smoothing, fills, interpolation, or manufactured dates.

## Accessibility and mobile audit

- The real and mocked mobile flows pass at 390 × 844 without horizontal overflow.
- Every reading input has a programmatic label, instruction and error associations, invalid state, and an autofocus target.
- Enter advances readings; the resolution warning uses `role="status"` and neutral wording.
- Record/history navigation uses the tab, tablist, and tabpanel pattern with arrow, Home, and End key handling.
- Progress exposes current and maximum circuit steps through a labelled progressbar.
- Draft deletion uses a modal alert dialog, traps keyboard focus, supports Escape, and restores focus after close.
- Save errors use alerts and retain the user's entered value.
- Main touch controls meet the feature's 44–48 px minimum target sizing.
- The chart exposes a text alternative that states its point count and that values are not smoothed or interpolated.

These behaviors are covered by component tests plus the two mocked mobile journeys and the real authenticated mobile journey.

## Scientific wording audit

Production anthropometry copy was searched for the prohibited causal claims. No text states or implies that a circumference change equals fat loss, muscle gain, a body-fat-percentage change, preserved muscle, visceral-fat change, or recomposition.

The interface and server limitations consistently state that:

- circumference can vary with fat, muscle, glycogen, fluid, digestion, breathing, posture, and technique;
- the feature does not measure body-fat percentage, muscle mass, visceral fat, or body recomposition;
- weight comparison is descriptive and does not alter targets or goal feedback;
- abdomen at navel is not the WHO waist measurement.

## Privacy, authority, and non-interference

- All three anthropometry tables retain RLS and owner-scoped policies.
- Real two-user API tests prove cross-user isolation for reads, writes, history, and deletion.
- Final representatives, method, quality, and algorithm versions are server-authoritative; calculated client fields are rejected.
- Finalised session mutation is rejected, and idempotency is proven sequentially and concurrently.
- Progress reads are paginated and owner scoped.
- The progress endpoint contains no database write or RPC invocation.
- Snapshot tests prove anthropometry reads leave goal phases, calorie target snapshots, and goal-feedback assessments unchanged.

## Regression results

| Gate | Command | Result |
|---|---|---:|
| Clean migration apply | `npx supabase db reset --local` | `0001`–`0032` applied |
| Migration ledger | `npx supabase migration list --local` | All local/applied versions match |
| Full backend/database regression | `cd supabase/tests && npx vitest run --config vitest.config.ts` | 404/404 across 19 files |
| Full frontend regression | `cd web && npm test` | 1002/1002 across 24 files |
| TypeScript and production bundle | `cd web && npm run build` | Passed |
| Complete mocked browser regression | `cd web && npm run test:e2e:mocked` | 18/18 |
| Real anthropometry browser flow | `cd web && npx playwright test e2e/integration/anthropometry.spec.ts --project=integration` with local Supabase environment | 1/1 |

The existing Vite large-chunk advisory, React Router future-flag notices, deprecated local Inbucket configuration warning, and absent optional `GROQ_API_KEY` notice remain non-blocking. The key is needed only for a live third-party meal-parser browser call; the meal backend tests and all mocked meal browser journeys passed in this audit.

## Release boundary

This audit authorises PR creation and review only. The feature branch must not be merged until the final gate is explicitly returned.
