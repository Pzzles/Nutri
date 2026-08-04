# Changelog

All notable changes to Nutri are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- Phase 10 remediation Gate 3 structured measurement context with server-derived local time.
- Protocol-compatible change summaries and cautious context-difference warnings.
- Phase 6 uncertainty-interval cross-signal comparison anchored at the anthropometry timestamp.
- `nutri_data_export_v3`, 1,005-session pagination proof, and Phase 5–8 non-interference fixtures.
- Resumable owner-scoped measurement drafts, whole-session deletion controls, and accessible responsive validation.
- Complete real-browser Phase 10 coverage, automated axe checks, keyboard navigation, and clean-schema evidence.

### Status

- Phase 10 implementation and remediation validation complete, subject to final PR review and merge. Not deployed.

## [0.1.0] — 2026-08-02

First production-ready release. All nine implementation phases complete.

### Added

**Phase 1 — Core schema and meal logging pipeline**
- Full PostgreSQL schema with RLS: `profiles`, `foods`, `meals`, `meal_items`, `weight_logs`, `goal_phases`, `daily_log_status`, and cache tables
- End-to-end meal logging: `parse-meal` (Claude AI) → `resolve-foods` (tiered resolution waterfall) → `calculate-meal` → `log-meal`
- Barcode lookup via `barcode-lookup`
- Custom food management via `create-custom-food` / `manage-custom-food`
- Meal editing via `edit-meal` / `edit-meal-item` / `delete-meal`
- Weight logging via `log-weight` / `get-weight-logs`
- Daily log status via `set-daily-log-status` / `get-daily-log-status`
- Dashboard summary via `dashboard-summary`
- Food search via `search-food` / `recent-foods`
- FatSecret external food provider integration

**Phase 2 — Authentication and anonymous-to-email upgrade**
- Anonymous auth with magic-link email upgrade flow in `AccountLink` page

**Phase 3 — Weight tracking and goal phases**
- Goal phase management: `start-goal-phase`, `end-goal-phase`, `get-goal-phases`, `update-goal-phase`
- Weight trend calculation via `get-weight-trend`

**Phase 4 — Frontend foundations**
- React 18 + Vite + TypeScript + Tailwind CSS application
- Pages: Auth, Dashboard, LogMeal, Progress, Account
- Navigation with active-route highlighting
- Confidence badge component

**Phase 5 — Scientific baseline energy calculations**
- Server-authoritative calorie targets (Mifflin-St Jeor BMR, activity multiplier)
- Immutable `calorie_target_snapshots` table — full provenance for every target
- `preview-energy-calc` for dry-run previews before committing a phase
- Aggressive-rate acknowledgement gate (>1% body weight/week)
- Calorie floor enforcement (1,200 kcal/day)

**Phase 6 — Adaptive maintenance and weight trend**
- EWMA weight smoothing (`weight_time_ewma_v3`)
- Theil-Sen rate estimation (`weight_rate_theil_sen_v1`, `weight_rate_interval_sen_v1`)
- Observed-maintenance energy balance tracking (`observed_maintenance_energy_balance_v1`)
- Adaptive maintenance estimate via `save-maintenance-estimate` / `get-adaptive-maintenance`

**Phase 7 — Goal feedback and progress assessment**
- Goal progress assessment engine (`goal_progress_assessment_v1`, `goal_progress_thresholds_v1`)
- `get-goal-feedback`, `save-goal-feedback-assessment` edge functions
- `GoalFeedbackCard` React component

**Phase 8 — Calculation snapshots and provenance**
- Input provenance JSONB on all snapshots
- `weight_measured_at`, `weight_log_source` on `calorie_target_snapshots`
- Full Phase 8 validation test suite (backend + E2E)

**Phase 9 — Product, security, and deployment hardening**
- `export-my-data` edge function (GET, returns `nutri_data_export_v1` JSON)
- `delete-account` edge function with `DELETE MY ACCOUNT` confirmation gate
- Account page extended with data export and account deletion UI
- `health` endpoint (already present, documents here for completeness)
- Root `.env.example` consolidating all required secrets
- 28 database migrations (schema + 2 bug-fix migrations in Phase 9)
- 331 backend integration tests — zero unexplained failures

### Fixed (Phase 9 — historical failures)
- **PGRST203** on `fn_log_weight`: migration 0021 created an ambiguous second overload; migration 0027 drops the original 5-parameter signature
- **FK violation** on `fn_start_goal_phase_v2` supersede: `superseded_by` was written before the new phase row existed; migration 0028 defers the backfill
- **FatSecret lenient matching** in resolve-foods tier-8 test: test used words FatSecret resolves; fixed by using non-food gibberish prefixes

### Security
- All secrets via environment variables; no credentials committed
- RLS enabled on all user-data tables
- `SECURITY DEFINER` functions verify `auth.uid() = p_user_id`
- Account deletion requires explicit `"DELETE MY ACCOUNT"` confirmation string

---

## [0.0.1] — 2026-07-01 (internal)

Initial skeleton commit from spec docs.
