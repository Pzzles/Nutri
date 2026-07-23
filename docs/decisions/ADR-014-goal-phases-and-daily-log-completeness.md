# ADR-014: Goal Phases and Daily Log Completeness

**Status:** Accepted  
**Date:** 2026-07-23  
**Deciders:** Pule Tshetlha

---

## Context

Pules needs to support users who are actively managing their weight (cut phase) or maintaining it (maintenance phase). The previous `user_goals` table stored static macro targets via effective-dated rows but had no concept of a phase lifecycle, no status tracking, and no way to represent the start/end of a deliberate dietary period.

Two related problems also exist:

1. **Phase ambiguity.** Users want to know when a goal period started, what it was targeting, and what happened to it — superseded, completed, or cancelled. None of this was modelled.

2. **Log completeness inference.** Prior code would have needed to infer whether a day's log was "done" from meal count or calorie total. This is wrong: a day with zero meals could be a fast; a day with one item could be incomplete. Completeness must be explicit.

---

## Decision

### 1. `goal_phases` as the authoritative model

A new `goal_phases` table replaces `user_goals` as the authoritative source for active phase data. `user_goals` is **retained but deprecated** (Option A: backward-compatibility shim). Any code reading current targets should prefer `goal_phases` when an active phase exists.

Key design choices:
- One active phase per user, enforced by a PostgreSQL partial unique index on `(user_id) WHERE status = 'active'`.
- Status lifecycle: `active → completed | cancelled | superseded` (one-way, no reactivation).
- Phase transitions (supersede, cancel) are atomic via `fn_start_goal_phase` SECURITY DEFINER. The RPC uses `FOR UPDATE` row-locking to prevent race conditions.
- `superseded_by` creates an auditable chain: every superseded phase points to the phase that replaced it.
- `target_change_kg_per_week` uses the sign convention: **negative = weight loss, zero = maintenance**. The field is null when not specified.
- Phase history is preserved permanently. Ended phases are never deleted or reused.
- Bulk/recomposition modes are **explicitly excluded** from this milestone.

### 2. `daily_log_status` as explicit-only completeness

A new `daily_log_status` table tracks whether a user considers a given day's food log to be `unknown`, `partial`, or `complete`. The status is **never inferred** from meal presence, count, or calorie total.

Key invariants:
- `complete` requires `marked_complete_at IS NOT NULL` (DB constraint).
- `marked_complete_at` is **preserved as an audit trail** even when a day is reopened — it records when the user last considered the day done.
- When a meal is logged on a day that was marked `complete`, a PostgreSQL AFTER INSERT trigger (`trg_reopen_daily_log_on_meal`) automatically sets the status to `partial` and stamps `reopened_at`. This fires within the same transaction as `fn_log_meal`, so it cannot be lost.
- The trigger only updates existing rows — it never creates one. A day with no row has implicitly `unknown` status.

### 3. `fn_set_daily_log_status` for atomic upserts

Client code must not read-then-write `daily_log_status` directly. The `fn_set_daily_log_status` RPC handles all transitions atomically, computing correct `marked_complete_at` / `reopened_at` values based on the current row state.

### 4. `auth.uid()` in SECURITY DEFINER functions

When called from the service role (edge functions), `auth.uid()` returns NULL. The functions handle this with `IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN RAISE EXCEPTION`. This allows trusted service-role calls while blocking direct user JWT misuse.

---

## Consequences

**Positive:**
- Full phase history is auditable and never overwritten.
- Completeness is always explicit — no risk of a partial log being treated as done.
- The auto-reopen trigger ensures a completed day is never silently "done" after additional logging.
- RLS on both tables ensures user data isolation at the DB layer.

**Negative / Trade-offs:**
- Two sources of truth for nutrition targets during transition (`user_goals` and `goal_phases`). Resolved by `dashboard-summary` preferring `goal_phases` when an active phase exists.
- Phase transitions require an explicit `transition` parameter on the API call — slightly more verbose, but prevents accidental overwrites.

---

## Explicit non-decisions

The following were deliberately excluded from this milestone to avoid scope creep and to keep the calculations deterministic:

- BMR, TDEE, Mifflin-St Jeor, Cunningham, Katch-McArdle, Hall dynamic model
- Estimated maintenance calories or adaptive calorie targets
- Weight smoothing (EWMA, linear regression, plateau detection)
- Weekly check-in recommendations or behavior correlations
- Micronutrient tracking, water logging, exercise tracking
- Body-fat estimates, tape measurements
- Bulk / recomposition mode
- LLM-based health advice

---

## Alternatives considered

**Option B: deprecate `user_goals` immediately.** Rejected because it would break `dashboard-summary` without a migration that converts existing rows to `goal_phases`. Option A (coexistence) allows a safe incremental cutover.

**Option C: infer daily completeness from calorie total ≥ target.** Rejected. This conflates measurement with classification, produces false positives for under-eating, and violates the product principle "never classify an incomplete day as low calorie intake."
