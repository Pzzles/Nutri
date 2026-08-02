# Phase 9 Validation Evidence

Date: 2026-08-02  
Branch: `feat/product-deployment-hardening`

---

## Backend integration tests

```
Command: cd supabase/tests && npx vitest run --config vitest.config.ts
Result:  Test Files: 16 passed (16)  |  Tests: 331 passed (331)
Duration: ~95s
```

### Test files

| File | Tests | Focus |
|------|-------|-------|
| `edge_functions.test.ts` | 23 | HTTP edge functions (log-weight, get-weight-logs, dashboard-summary, start-goal-phase, get-meals, edit-meal-item, delete-meal, set/get-daily-log-status) |
| `resolve-foods.test.ts` | 9 | Food resolution waterfall (tiers 1–5, tier 8 unresolved) |
| `weight_logs.test.ts` | varies | Weight log CRUD + RLS isolation |
| `fn_upsert_portion_history.test.ts` | varies | Portion history RPC |
| `meal_daily_status_integration.test.ts` | varies | Meal→daily-status reopen trigger |
| *(12 more files)* | — | Individual RPC/table coverage |

### Historical failures resolved in Phase 9

| Failure | Root cause | Fix |
|---------|-----------|-----|
| `log-weight` PGRST203 (×9 cascading) | Two `fn_log_weight` overloads | Migration 0027 |
| `start-goal-phase` profile missing | Test setup incomplete | Added profile+weight in beforeAll |
| `start-goal-phase` response shape | Phase 5 changed to `{phase, snapshot}` | Updated assertions to `resp.data.phase.id` |
| `start-goal-phase` supersede FK | `superseded_by` written before new row | Migration 0028 |
| `resolve-foods` mixed tier-8 | "multi" prefix triggered FatSecret match | Changed prefix to `zzz-unresolvable-gibberish-` |

---

## Confirmed: zero unexplained failures

All 331 tests pass. No test was skipped, disabled, or modified to pass artificially.
Every fix addresses the actual root cause:
- 2 migrations correct DB-level bugs
- 3 test corrections fix assertions that tested stale expectations

---

## Frontend typecheck

```
Command: cd web && npm run typecheck
Expected: 0 errors
```

(Run separately — included in CI pipeline.)

---

## Phase 9 new features tested via edge functions

| Feature | How tested |
|---------|-----------|
| `export-my-data` | Manual smoke test: GET returns 200 with Content-Disposition header and nutri_data_export_v1 JSON |
| `delete-account` | Manual smoke test: POST without confirm body returns 400; with correct confirm deletes all data |
| `health` endpoint | Existing in codebase; confirmed at `GET /functions/v1/health` |

---

## Pre-existing baseline

See [pre-existing-test-baseline.md](pre-existing-test-baseline.md) for the
documented state of 12 failures on origin/master before Phase 9 work began.
