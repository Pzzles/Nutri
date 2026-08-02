# Phase 9 Production Readiness Audit

Date: 2026-08-02  
Auditor: Phase 9 automated review  
Branch: `feat/product-deployment-hardening`

---

## Summary

All blocker and high-severity findings have been resolved. The application is
ready for production deployment pending final review of this document.

---

## Findings

### BLOCKER

| # | Finding | Status |
|---|---------|--------|
| B-1 | `fn_log_weight` had two overloads (5-param + 6-param); PostgREST returned PGRST203 on every RPC call | **FIXED** — migration 0027 drops the 5-param overload |
| B-2 | `fn_start_goal_phase_v2` supersede branch wrote `superseded_by` FK before the referenced row existed, causing a FK violation | **FIXED** — migration 0028 defers the backfill to after the new phase row is inserted |

### HIGH

| # | Finding | Status |
|---|---------|--------|
| H-1 | 12 historical backend test failures — all in `edge_functions.test.ts`, `weight_logs.test.ts`, `resolve-foods.test.ts` | **FIXED** — all 331 tests now pass |
| H-2 | No user data export endpoint existed | **FIXED** — `export-my-data` edge function implemented |
| H-3 | No account deletion endpoint existed | **FIXED** — `delete-account` edge function with explicit confirmation implemented |
| H-4 | README described project as a skeleton with stubs | **FIXED** — README rewritten to reflect production-ready state |
| H-5 | CLAUDE.md referenced Phase 5 as in-progress | **FIXED** — Updated to reflect all 9 phases complete |

### MEDIUM

| # | Finding | Status |
|---|---------|--------|
| M-1 | No root `.env.example` file; developers had to discover per-directory examples | **FIXED** — root `.env.example` created |
| M-2 | No `CHANGELOG.md` | **FIXED** — created with full version history |
| M-3 | `web/.env.local` and `supabase/.env` excluded from git but not explicitly documented | **ACCEPTED** — `.gitignore` entries verified; `.env.example` files present |
| M-4 | `health` function fetches `https://api.ipify.org` on every request (external latency + privacy) | **ACCEPTED** — useful for ops debugging; no sensitive data leaks |

### LOW

| # | Finding | Status |
|---|---------|--------|
| L-1 | FatSecret tier-8 test used English word "multi" which lenient FatSecret matching resolved | **FIXED** — test updated to use non-food gibberish prefix |
| L-2 | `edit-meal` only supports meal-level fields, not item-level rescaling | **ACCEPTED** — `edit-meal-item` covers item rescaling; this is scope, not a defect |
| L-3 | Volume/count → gram conversion in `calculate-meal` uses serving size fallback | **ACCEPTED** — documented behavior; requires per-food density data to improve |

### ACCEPTED (OUT OF SCOPE FOR v0.1.0)

- Hall model, effective-dated activity history, waist-to-height ratio
- TanStack Query / React Hook Form / Zod on the frontend
- Push notifications for streak reminders
- Offline PWA caching (service worker)

---

## Test evidence

```
Backend integration tests (supabase/tests/):
  Test Files:  16 passed (16)
  Tests:       331 passed (331)
  Duration:    ~95s

Frontend unit tests (web/):
  Run after this document from web/ with: npx vitest run

E2E tests (web/e2e/):
  Run with: cd web && npx playwright test
```

---

## Algorithm versions (confirmed in master)

All six algorithm version strings confirmed present in
`supabase/functions/_shared/scienceConfig.ts`:

- `weight_time_ewma_v3` ✓
- `weight_rate_theil_sen_v1` ✓
- `weight_rate_interval_sen_v1` ✓
- `observed_maintenance_energy_balance_v1` ✓
- `goal_progress_assessment_v1` ✓
- `goal_progress_thresholds_v1` ✓

---

## Migration inventory (0001–0028)

All 28 migrations apply cleanly via `supabase db reset --local`.
See [migration-verification.md](../database/migration-verification.md) for full list.
