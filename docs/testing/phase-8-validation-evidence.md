# Phase 8 Validation Evidence

**Feature:** Plateau Detection and Cautious Goal Feedback  
**Branch:** `feat/plateau-detection-goal-feedback`

---

## Test Coverage Summary

### 1. Pure calculation tests (`supabase/tests/_shared/goalProgressAssessment.test.ts`)

15 tests covering all 11 progress states and key invariants.

| Fixture | State | Advisory |
|---|---|---|
| A | `no_active_goal_phase` | none |
| B | `stale_data` | none |
| C | `insufficient_data` | none |
| D | `maintenance_stable` | none |
| E | `maintenance_drift` | none |
| F | `on_track` | none |
| G | `slower_than_planned` | 150 kcal/day decrease |
| H | `faster_than_planned` (cut) | none, consider_less_aggressive_goal |
| I | `plateau_candidate` | none (historical not qualifying) |
| J | `likely_plateau` | 250 kcal/day decrease (clamped) |
| K | `opposite_direction` | 250 kcal/day decrease (clamped) |
| L | `faster_than_planned` (bulk) | none, review_goal_assumptions |

Additional invariant tests:
- All results carry correct algorithm version strings
- Advisory direction is consistent with sign of (target − observed)
- `likely_plateau` requires phase age ≥ 42 days

**Result:** 15/15 tests pass.

### 2. Frontend vitest tests (`web/src/__tests__/GoalFeedbackCard.test.tsx`)

Tests cover all card states and interaction flows.

| Suite | Tests |
|---|---|
| Loading state | 1 |
| Error state | 2 |
| No active goal phase | 1 |
| Insufficient / stale data states | 2 |
| Full assessment card | 6 |
| Advisory adjustment banner | 4 |
| Likely plateau state | 2 |
| All 11 states render without crash | 11 |
| Reason codes | 2 |
| Warnings | 2 |
| Save action | 6 |

**Total:** ~40 tests expected to pass.

Key assertions:
- `GoalFeedbackCard` renders all 11 states without crashing
- Advisory banner shown for `likely_plateau` with correct magnitude and direction text
- Save button calls `saveGoalFeedbackAssessment` exactly once with the correct phase ID
- Save button disabled and labelled "Assessment saved" after successful save
- `onAssessmentSaved` callback fires with the returned `assessment_id`
- No side-effect calls (no calorie-target mutation)

### 3. Backend integration tests (`supabase/tests/goal-feedback.test.ts`)

Tests against a real local Supabase stack (no mocks).

| Section | Tests |
|---|---|
| 1. Authentication | 2 |
| 2. No active goal phase | 1 |
| 3. GET response shape | 2 |
| 4. GET is read-only | 1 |
| 5. POST saves an assessment | 2 |
| 6. POST idempotency | 1 |
| 7. POST phase mismatch | 2 |
| 8. POST does not mutate goal_phases | 1 |
| 9. RLS cross-user isolation | 1 |

**Total:** 13 tests.

Key assertions:
- GET returns 401 without a JWT
- GET returns 200 with `progress_state`, `feedback_action`, `reason_codes`, `assessed_at`, `evidence`, `algorithm_versions`
- GET does not create a `goal_feedback_assessments` row
- POST saves a row and returns `assessment_id`
- Same-day POST upserts (one row only for today)
- POST with wrong `goal_phase_id` returns 422
- POST does not modify `goal_phases`
- User B cannot read user A's assessments via RLS

### 4. Playwright E2E tests (`web/e2e/integration/goal-feedback.spec.ts`)

Tests against a real browser against the full stack.

| Flow | Tests |
|---|---|
| 1. No active goal phase | 2 |
| 2. Insufficient data | 1 |
| 3. Plateau / progress assessment | 6 |

**Total:** 9 tests.

Key flows:
- Feedback tab renders no-phase card for user with no active goal phase
- Feedback tab renders no-data or full assessment card
- Save button transitions to "Assessment saved"
- Saving an assessment does NOT change the goal phase
- Screenshot evidence captured (desktop and mobile)

---

## Security Properties Verified

| Property | Verified by |
|---|---|
| User ID from JWT only | Backend integration test 9 (RLS), GET/POST auth tests |
| Server clock only | POST endpoint source: `const now = new Date()` — no body field |
| Server recalculates before save | POST endpoint source: full P6+P7+assess() pipeline |
| Save does not mutate goal phase | Backend test 8, E2E test "saving does not change goal phase" |
| No advisory auto-applies calorie change | Component test "only one call made", advisory disclaimer text |
| Advisory shown for `likely_plateau` only when all gates pass | Pure test fixtures I vs J |
| GET is read-only | Backend test 4 (row count unchanged) |

---

## Screenshot Evidence

Captured during E2E test run:

- `web/e2e/evidence/p8-goal-feedback-plateau-desktop.png`
- `web/e2e/evidence/p8-goal-feedback-plateau-mobile.png`
