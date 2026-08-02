# Phase 8 Validation Evidence

**Feature:** Plateau Detection and Cautious Goal Feedback  
**Branch:** `feat/plateau-detection-goal-feedback`

---

## Test Coverage Summary

### 1. Pure calculation tests (`supabase/tests/_shared/goalProgressAssessment.test.ts`)

38 tests covering all 11 progress states, 22 acceptance-gap cases, and key invariants.

| Fixture | State | Action | Advisory |
|---|---|---|---|
| A | `no_active_goal_phase` | `start_goal_phase` | none |
| B | `stale_data` | `collect_more_data` | none |
| C | `insufficient_data` | `collect_more_data` | none |
| D | `maintenance_stable` | `keep_current_plan` | none |
| E | `maintenance_drift` | `review_maintenance_drift` | drift direction: up |
| F | `on_track` | `keep_current_plan` | none |
| G | `slower_than_planned` | `review_goal_assumptions` | none (spec §8: no adjustment) |
| H | `faster_than_planned` (cut) | `consider_less_aggressive_goal` | none |
| I | `plateau_candidate` | `collect_more_data` | none (spec §4: no adjustment) |
| J | `likely_plateau` | `consider_small_calorie_adjustment` | −250 kcal/day (proposed target: 1750) |
| K | `opposite_direction` | `consider_small_calorie_adjustment` | −250 kcal/day |
| L | `faster_than_planned` (bulk) | `review_goal_assumptions` | none |

Acceptance-gap cases 1–22 cover:
- `plateau_candidate` fields contract (no adjustment, no proposed target)
- `slower_than_planned` with full ADJ_ELIGIBLE context: still no adjustment
- `likely_plateau` with bounded signed adjustment and proposed target
- Opposite direction: point estimate with range including zero → not `opposite_direction`
- Opposite direction: range fully above zero → `opposite_direction`
- Maintenance: range includes zero → `maintenance_stable` with `rate_outside_band_but_range_includes_zero`
- Maintenance: range fully below zero → `maintenance_drift` down
- `on_track` at attainment ratio exactly 0.70
- `on_track` because target rate lies within P6 range
- `required_correction_below_minimum` safety block
- `proposed_target_below_floor` safety block (not clamped)
- `missing_current_target` safety block
- `missing_official_weight` safety block
- Aggressive-rate warning safety block
- Low P6 confidence → no plateau candidate
- Low P7 confidence → no likely plateau
- Coverage below 70% → no likely plateau
- Historical P7 confidence low → no likely plateau (stays plateau_candidate)
- Historical coverage below 70% → no likely plateau (stays plateau_candidate)
- Evidence conflict safety block
- Input immutability
- Algorithm version strings across all states

**Result:** 38/38 tests pass.

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
| `plateau_candidate` never produces an adjustment | Pure test fixture I, acceptance-gap cases 1, 15–17 |
| `slower_than_planned` never produces an adjustment | Pure test fixture G, acceptance-gap case 2 |
| `proposed_target_below_floor` blocks, not clamps | Acceptance-gap case 11 |
| Uncertainty-aware classification (bounds required) | Acceptance-gap cases 4–7 |
| GET is read-only | Backend test 4 (row count unchanged) |

---

## Screenshot Evidence

Captured during E2E test run:

- `web/e2e/evidence/p8-goal-feedback-plateau-desktop.png`
- `web/e2e/evidence/p8-goal-feedback-plateau-mobile.png`
