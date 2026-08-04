# Phase 10 Gate 5 Validation Evidence

> **Historical pre-remediation record (2026-08-02).** Current change-summary,
> Phase 6 interval, and cross-signal evidence is in the
> [Phase 10 remediation final evidence](phase-10-validation-evidence.md).

Date: 2026-08-02<br>
Branch: `feat/anthropometric-progress-tracking`<br>
Scope: anthropometric trends and Phase 6 cross-signal interpretation

## Implemented behavior

- `GET /functions/v1/get-anthropometric-progress` authenticates the caller, queries only that user's finalised sessions, and returns site series in frozen order with points in chronological `(measured_at, session_id)` order.
- `anthropometry_change_v1` calculates latest-versus-previous and latest-versus-first changes from stored two-decimal representatives. It preserves fractional elapsed days and does not create dates, values, zeros, smoothing, forward fills or interpolated endpoints.
- `anthropometry_weight_comparison_v1` considers waist first and abdomen at navel only when waist lacks eligible endpoints. Other sites retain numeric history but do not generate cross-signal narratives.
- Eligibility requires endpoints at least 14 days apart, no endpoint repeatability warning, a provisional/usable Phase 6 result with medium/high confidence, and two distinct observed trend points aligned within seven days.
- Nearest weight-point selection uses absolute elapsed time and chooses the earlier point on an exact tie. The server returns the aligned timestamps and values; it never interpolates weight.
- Versioned direction bands are exactly 1.0 cm for circumference and `max(0.5 kg, 0.5% of starting trend weight)` for weight. Only the six frozen descriptive templates can be returned.
- The authenticated browser consumes the server result and shows actual-point charts, latest value, change from previous, change from first, chronological history, quality notes, algorithm versions and scientific limitations.
- Waist and abdomen at navel remain independently selectable and labelled. The navel view explicitly states that it is not the WHO waist site and is not used with waist-risk thresholds.
- Centimetres remain canonical; every history value and change can be converted for display in inches without altering the response.

## Non-interference evidence

- The progress endpoint is read-only: it contains no insert, update, upsert, delete or RPC operation.
- A real-backend test snapshots `goal_phases`, `calorie_target_snapshots` and `goal_feedback_assessments`, calls the progress endpoint, and proves all three snapshots are unchanged afterward.
- The endpoint calls the canonical Phase 6 `calculate` function as a read-only dependency. Anthropometry is not passed into Phase 6, Phase 7 observed maintenance or Phase 8 goal-feedback code.
- UI copy states that the comparison does not infer fat loss, muscle gain or body recomposition and does not alter targets or goal feedback.

## Automated results

| Gate | Command | Result |
|---|---|---:|
| Frozen change/comparison fixtures | `cd supabase/tests && npm test -- _shared/anthropometryProgress.test.ts` | 13/13 passed |
| Authenticated endpoint integration | `cd supabase/tests && npm test -- anthropometry-api.test.ts` | 28/28 passed |
| Full backend/database regression | `cd supabase/tests && npm test` | 400/400 passed across 19 files |
| Focused frontend history/workflow | `cd web && npm test -- anthropometry.test.ts Measurements.test.tsx AnthropometryTrends.test.tsx` | 25/25 passed |
| Full frontend regression | `cd web && npm test` | 1002/1002 passed across 24 files |
| TypeScript and production bundle | `cd web && npm run build` | Passed |
| Mobile Chromium record + history flows | `cd web && npx playwright test e2e/anthropometry-measurement.spec.ts e2e/anthropometry-trends.spec.ts --project=mocked` | 2/2 passed |

The existing Vite large-chunk advisory, React Router future-flag notices and optional GROQ-key warning remain non-blocking baseline warnings. The meal parser is outside this gate and was not exercised by the targeted mocked Playwright flows.
