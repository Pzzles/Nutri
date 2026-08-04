# Phase 10 final validation evidence

Date: 2026-08-04  
Branch: `fix/anthropometry-phase10-remediation`  
Status: implementation and remediation validation complete, subject to final PR review and merge; not deployed.

## Architecture reconstruction

The trusted write path is `Measurements.tsx` → authenticated save/finalise Edge Function → `_handlers/anthropometricSession.ts` → `_shared/anthropometryApi.ts` validation → `_shared/anthropometry.ts` representative v3 → service-only transactional RPC. PostgreSQL locks the parent session during finalisation, owns child rows explicitly through `(session_id, user_id)`, and prevents mutation after finalisation. The browser predicts only whether another input is needed; it does not authoritatively calculate representative value, selected pair, quality, eligibility, protocol compatibility, change direction, weight direction, or cross-signal text.

The read path is owner-scoped session/progress Edge Functions → `_shared/anthropometryProgress.ts` → stored representatives plus the canonical Phase 6 calculator as of the latest eligible measurement. History renders observed points only. Export and account deletion use separately authenticated, explicitly scoped handlers.

No duplicate trusted anthropometry calculation was found. The frontend `needsThirdReading` helper is presentation-only and finalisation always returns the server result.

## Scientific protocol audit

All nine metric identifiers and displayed landmarks match the frozen protocol: chest; WHO midpoint waist; abdomen at navel; maximum hips; left/right relaxed upper arm; left/right mid-thigh; and optional neck. Waist copy specifies the midpoint between the lower margin of the last palpable rib and top of the iliac crest, horizontal tape, normal standing, relaxed abdomen, and normal exhalation. Navel copy specifies a horizontal tape through the centre of the navel and labels it a distinct personal-progress measure. Waist/navel and left/right limbs are stored, calculated, charted, and exported separately. Missing sites remain absent; no clinical threshold or cross-site average exists.

The production-copy search found only explicit non-inference boundaries for body fat, fat loss, muscle gain, body composition, visceral fat, and lean mass. The unrelated goal-safety copy warns about rapid goal rates; it does not infer composition from circumference.

## Representative-v3 fixtures

Expected values were frozen independently of the production function. Pure tests also assert unchanged inputs, exact source-row IDs, selected indices, the unselected ID, all three pair differences, and legacy v1/v2 retention.

| Raw readings (cm) | Expected | Actual |
|---|---|---|
| `82.0, 82.4` | `82.2`, pair agree, eligible | Pass |
| `82.0, 84.0, 82.3` | pair `1,3`, `82.15`, isolated, eligible | Pass in pure/API/real browser |
| `80.0, 80.2, 50.0` | pair `1,2`, `80.1`, isolated, eligible | Pass |
| `80.0, 81.0, 82.0` | tie selects `1,2`, `80.5` | Pass |
| `80.0, 82.0, 84.5` | pair `1,2`, `81.0`, high variability, ineligible | Pass |
| `90.0, 90.0, 90.0` | tie selects `1,2`, `90.0` | Pass |

One reading returns `SECOND_READING_REQUIRED`; two readings over 1.0 cm return `THIRD_READING_REQUIRED`; no agreeing pair returns `HIGH_VARIABILITY_CONFIRMATION_REQUIRED`. Explicit acknowledgement permits finalisation but does not change `eligible_for_interpretation=false`.

## Transaction, ownership, and deletion

Gate 2 regressions passed unchanged: six deterministic multi-connection race tests, 36 RLS/ownership operation tests, and five failure-injection/retry account-deletion tests. Child insert/update/delete waits behind the locked parent and is rejected after commit. Same-key concurrency converges on one result; different-key finalisation conflicts honestly; timeout retry is idempotent. Direct authenticated mutations remain revoked and anonymous access fails.

The populated-account browser flow confirmed the terminal UI only after the server removed the Auth user, session/context, raw readings, and representatives. A successful server deletion is not reclassified as failure if local sign-out cleanup cannot contact the deleted session.

## Context, compatibility, spacing, and Phase 6

`anthropometry_measurement_context_v1` stores server-derived local time from `measured_at` and the profile timezone plus optional meal timing, bathroom state, prior-12-hour exercise, assistance, clothing, and private notes. Invalid types/enums/trusted fields are rejected. Legacy context is `Not recorded`; notes do not enter progress points or chart tooltips.

`anthropometry_context_comparison_v1` emits all six frozen warning codes, including material local-time differences strictly greater than four hours. Warnings preserve the numeric observations and do not assert causation.

`anthropometry_protocol_compatibility_v1` allows only protocol v1 with v1. Unknown protocols remain visible and suppress previous/baseline/cross-signal comparisons with `protocol_versions_not_comparable`. Representative v2/v3 rows can compare when their anatomical protocol is compatible.

`anthropometry_change_summary_v2` uses finalised, eligible, same-site, compatible observations only. It does not interpolate, smooth, forward-fill, or insert zero. Automated cross-signal interpretation requires at least 14 calendar days; shorter sessions remain visible and return `sessions_too_close_for_interpretation`.

Weight direction comes only from Phase 6 bounds: upper `< 0` decreasing; lower `> 0` increasing; interval containing zero uncertain/broadly stable; absent bounds unavailable. Eligibility also proves usable/provisional status, medium/high confidence, non-stale evidence, and a latest weight within seven days. No EWMA-endpoint, raw-endpoint, OLS, percentage, absolute-threshold, or point-estimate fallback is used.

## Phase 5–8 non-interference and dependency result

The before/after fixture adds ordinary, isolated, high-variability, structured-context, and incompatible-protocol anthropometry, removes nondeterministic envelope fields, and proves byte-equivalent Phase 5–8 outputs for calorie target, maintenance source, Phase 6 trend/rate/bounds/confidence, Phase 7 estimate/range/confidence, Phase 8 state/action/adjustment/proposed target, and active goal phase. Result: 3/3 pass.

A static search of Phase 5–8 production modules returned `NO_PHASE_5_8_ANTHROPOMETRY_DEPENDENCIES`. Anthropometry consumes Phase 6; Phases 5–8 do not consume anthropometry.

## Pagination, export, and deletion

The real pagination fixture returned exactly 1,005 finalised sessions in 11 pages of at most 100 in 2,926.7 ms. Ordering was deterministic; the cursor terminated; IDs were unique; nothing was missing; readings and representatives remained associated with their session.

`nutri_data_export_v3` includes sessions, normalized context, raw readings, representatives, source IDs/indices, warning codes, eligibility, protocol/algorithm versions, and canonical centimetres. The real browser download contained the owner fixture and excluded the other user. Cross-user session deletion returned 404. Legacy absent context exports honestly.

## Real-browser flows

| Flow | Executed proof | Result |
|---|---|---|
| 1 agreeing waist `88.0, 88.8 → 88.4` | `authenticated mobile user finalizes raw waist readings and sees real history` | Pass |
| 2 closest pair `82.0,84.0,82.3 → 82.15`, pair 1/3 | `Flow 2: real third reading...` | Pass |
| 3 isolated `80.0,80.2,50.0 → 80.1` | `real isolated reading remains optional...` | Pass |
| 4 high variability `80.0,82.0,84.5 → 81.0` | `real high variability requires confirmation...` | Pass |
| 5 deterministic tie `80.0,81.0,82.0 → 80.5` | `real closest-pair tie...` | Pass |
| 6 waist/navel separation | `Flows 6-8...` | Pass |
| 7 left/right limb separation | `Flows 6-8...` | Pass |
| 8 inches with canonical cm persistence | `Flows 6-8...` | Pass |
| 9 optional context | authenticated mobile and axe-matrix context detail | Pass |
| 10 context mismatch caution | authenticated mobile comparison fixture | Pass |
| 11 irregular sparse history | `Flow 11...only three recorded points` | Pass |
| 12 Phase 6 interval includes zero | `real Phase 6 interval containing zero...` | Pass |
| 13 incompatible protocols | `real incompatible protocols remain visible...` | Pass |
| 14 authenticated export | `Flows 14-15...` | Pass |
| 15 cross-user rejection | `Flows 14-15...` | Pass |
| 16 populated account deletion | `Flow 16...` | Pass |
| 17 real mobile guided session | authenticated mobile test at 390×844 | Pass |
| 18 target/Phase 8 non-interference | `real browser measurement leaves active target...` | Pass |

## Accessibility, keyboard, and responsive evidence

`@axe-core/playwright` scanned selection, guided entry, third-reading warning, isolated warning, low-confidence confirmation, finalised session, history/chart text alternative, context details, export, session deletion, and account deletion. Final result: zero critical and zero serious violations. No moderate or minor findings remained in the final core-state scan. Definition-list structure, light-theme contrast, confidence colors, and the aria-hidden Recharts focus target were corrected.

Keyboard-only Playwright completed selection through history using Tab, Space, and Enter; focus moved to reading three; the delete dialog trapped focus, closed with Escape, and returned focus to its trigger. Accessible-name/ARIA assertions cover headings, named instructions/fields/units, reading number, status/errors, low-confidence acknowledgement, representative provenance, interpretation eligibility, context warning, chart text alternative, and cross-signal summary. This is automated semantic validation; no physical screen-reader session was performed.

Reduced-motion mode completed the workflow. Meaning never depends on animation or color alone. Both light and dark presentations were exercised. All tested action controls meet the product’s 44 px minimum target convention.

| Viewport | Guided screenshot SHA-256 | History screenshot SHA-256 | Result |
|---|---|---|---|
| 360×640 | `a7e1328ba72d707061f765b2ebf658727a0fc6e84bbca413c8b804129afeb6aa` | `e0b7760b20b61cb522cdf428f20675a405c7efbaf0fdd54027ffbf8ef34b5f46` | Pass |
| 390×844 | `d5c93a62744e64ffa9a46c37fb83b0fdb0fb391ece1716abf675d39257c62a30` | `c6390f62e5f993806328c71daa2d3a4c56f775ce09cd18f35884299a501ae0ab` | Pass |
| 412×915 | `b16456cac275fc60c683ddda3d85eaf0127d1800e6f77aa82261be0e19bb0442` | `8770c3de4b341e0189bd84f67be8f841df56ff0c975a7552169b8247787a7ffa` | Pass |
| 768×1024 | `20dbaaeff127fb7e1f81d3589083c0a6dd1e7c1d1dd827617f3d8c669cef36bf` | `72f50989c777c1697edbaa1bd604f645fbb55516585718e8aec5774e141387f8` | Pass |
| 1440×900 | `a348563b8907dd3a6dc41ccdeb6b0c10691186670b0ac4eafbf434d3f0d1aa7c` | `c217edfe051a6c4674616b85d5262256df6eaf249952f77eefc5f76a11e2b8f1` | Pass |

All screenshots are under `docs/testing/evidence/phase-10/`. They use synthetic values and contain no email, private note, token, or key. Raw Playwright `trace.zip` files were generated for the final 9/9 clean-schema run but are deliberately not retained because traces include authorization headers and synthetic email addresses. Scenario trace path: `not retained—security exclusion`; trace hash: `not applicable`.

## Scenario evidence index

| Scenario | Test name | Expected and actual | Screenshot path | Trace path | SHA-256 |
|---|---|---|---|---|---|
| waist protocol / third reading / isolated warning | `Flow 2: real third reading...` | pair 1/3, 82.15; pass | `evidence/phase-10/guided-390x844.png` | security exclusion | `d5c93a...c62a30` |
| waist versus navel / limbs / inches | `Flows 6-8...` | four distinct series, cm persisted; pass | `evidence/phase-10/history-1440x900.png` | security exclusion | `c217ed...e2b8f1` |
| high variability confirmation | `Gate 4 axe matrix...` | acknowledgement required; ineligible; pass | `evidence/phase-10/guided-412x915.png` | security exclusion | `b16456...b0442` |
| structured context / mismatch caution | authenticated mobile + axe matrix | context retained; caution does not invalidate; pass | `evidence/phase-10/history-390x844.png` | security exclusion | `c6390f...c62a30` |
| protocol incompatibility / uncertain Phase 6 | original real anthropometry suite | visible numeric history, no automatic claim; pass | `evidence/phase-10/history-768x1024.png` | security exclusion | `72f509...387f8` |
| sparse/desktop/mobile history | Flow 11 + responsive matrix | exactly three real points; no overflow; pass | all ten viewport files | security exclusion | hashes above |
| export / account deletion | Flows 14–16 | owner-only export and terminal deletion; pass | none retained to avoid account identifiers | security exclusion | not applicable |
| keyboard / axe | keyboard-only + axe matrix | complete; 0 critical/serious | `evidence/phase-10/guided-360x640.png` | security exclusion | `a7e132...feb6aa` |

## Final command matrix

Environment values below name local endpoints only; secrets are intentionally omitted.

| Working directory | Exact command | Exit | Passed / failed / skipped | Duration |
|---|---|---:|---|---:|
| `supabase/tests` | `npm test` | 0 | 425 / 0 / 0 | 131.07 s |
| `web` | `npm test` | 0 | 1012 / 0 / 0 | 39.58 s final post-install run |
| `web` | `npm run build` | 0 | production build / 0 / 0 | 14.90 s final post-install build |
| `web` | `npx playwright test --project=mocked --workers=1` | 0 | 18 / 0 / 0 | 28.8 s final run |
| `web` | local env + `npx playwright test --project=integration --workers=1` | 0 | 94 / 0 / 0 | 469.9 s |
| `web` | local env + `npx playwright test --project=integration --workers=1 --trace=on e2e/integration/anthropometry-gate4.spec.ts` | 0 | 9 / 0 / 0 | 121.1 s |
| `web` | local env + `npx playwright test --project=integration e2e/integration/anthropometry.spec.ts` | 0 | 7 / 0 / 0 | 28.4 s |
| `tools/weight-trend-oracle` | `$env:PYTHONUTF8='1'; python test_oracle.py` | 0 | 89 / 0 / 0 | 1.1 s combined |
| `tools/weight-trend-oracle` | `node verify_fixture_a.mjs` | 0 | independent fixture / 0 / 0 | 0.7 s |
| repository root | `npx supabase db reset --local` (reset 1) | 0 | migrations 0001–0036 / 0 / 0 | 90.3 s |
| repository root | `npx supabase db reset --local` (reset 2) | 0 | migrations 0001–0036 / 0 / 0 | 82.5 s |
| repository root | `npx supabase db diff --local --schema public` | 0 | empty diff / 0 / 0 | 78.4 s |

The full backend run includes representative (16), progress/context (11), non-interference (3), anthropometry API/pagination/export (38), concurrency (6), account deletion (5), RLS (22), anthropometry security (11), privileged query scope (3), and all Phase 5–9 backend tests. The frontend run includes 393 Phase 6 parity fixtures plus Phase 5–9 and 35 Phase 10 unit/component tests. The complete browser projects cover Phase 5–9 Playwright as well as Phase 10.

Pre-fix evidence was preserved during remediation: stale reason code, inaccessible drafts, missing session deletion UI, axe definition-list/contrast/chart-focus violations, dishonest account-deletion terminal routing, stale absolute base URLs/tab roles/login controls, non-UUID meal idempotency fixtures, fixed-date history assumptions, an unmocked post-goal dashboard destination, and the unavailable provider configuration each failed before the smallest correction and passed after it. A first Python invocation failed only because Windows CP1252 could not print `→`; the correctly scoped UTF-8 command passed 89/89. A serial browser attempt was also killed by an insufficient 10-minute shell ceiling, and a four-worker attempt overloaded the local Edge Runtime; neither is reported as a test pass.

## Security and provider boundary

No real third-party provider key was available. `parse-meal` now defaults to the unchanged official Groq URL but accepts an environment-only `GROQ_API_URL`; the final integration run used the local OpenAI-compatible provider stub. Authentication, Nutri APIs, Edge Functions, database operations, export, and deletion were real and were not intercepted.

The 2026-08-04 npm advisory database has no React Router version that clears both current ranges: v6 reports two moderate client-routing advisories, while the suggested v7.18 line reports a high-severity RSC CSRF advisory. Nutri constructs only static internal routes and has no SSR/RSC action surface. Dev-only Vite/Vitest/PWA advisories require coordinated major upgrades. These are documented dependency follow-ups, not unexplained test failures.

## Final result

All scientific, transactional, ownership, interpretation, accessibility, responsive, recovery, migration, and regression acceptance criteria passed. The remaining work is repository workflow only: commit the Gate 4 changes, synchronize and push the feature branch, create the draft remediation PR, and obtain human review. Do not merge or deploy automatically.
