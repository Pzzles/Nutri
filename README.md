# Nutri — Nutrition Tracker

Production-ready personal nutrition tracking application.
Nine implementation phases complete. Version 0.1.0.

## What's built

**Meal logging pipeline (end-to-end)**
- `parse-meal` — Claude AI parses natural-language meal descriptions
- `resolve-foods` — 8-tier food resolution waterfall (user-exact → user-partial → user cache → global cache → fuzzy trigram → FatSecret → USDA → unresolved)
- `calculate-meal` — pure nutrition math, unit conversion, confidence scoring
- `log-meal` — atomic persistence with idempotency and cache promotion

**Weight and goal tracking**
- Weight logging with same-day demotion (only one official entry per day)
- EWMA weight smoothing and Theil-Sen rate estimation
- Goal phases (cut/maintenance/bulk) with server-authoritative calorie targets
- Mifflin-St Jeor BMR + activity multiplier TDEE calculation
- Immutable calorie target snapshots with full input provenance
- Adaptive maintenance estimate from observed energy balance
- Goal progress assessment with rate bounds and adjustment proposals
- Anthropometric draft/finalised sessions with preserved tape readings and server-authoritative representatives
- Owner-scoped anthropometric history, cursor pagination and explicit whole-session deletion

**Supporting functions**
- Barcode lookup, custom food management, meal templates
- Dashboard summary (today's totals + latest weight)
- Food search, recent foods, edit/delete meal items
- Daily log status (complete / partial / unknown)
- Health endpoint (`/functions/v1/health`)

**Data privacy**
- `export-my-data` — authenticated GET, downloads `nutri_data_export_v2` JSON including anthropometry
- `delete-account` — permanently deletes all user data with explicit confirmation

**Frontend (React 18 + Vite + TypeScript + Tailwind CSS)**
- Email/password sign-up and sign-in, with in-place upgrade for existing anonymous accounts
- Meal logging flow, dashboard, weight progress, goal phases, account management
- Guided circuit-based tape measurements with precise landmarks, cm/in display, draft saves and accessible mobile controls
- Data export and account deletion UI in the Account page

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite 5, TypeScript 5.5, Tailwind CSS |
| Backend | Supabase (PostgreSQL 15, RLS, Edge Functions) |
| Edge Functions | Deno 1.x |
| AI | Anthropic Claude (parse-meal) |
| Food data | FatSecret Platform API |
| Tests | Vitest 1.6 (backend integration), Playwright (E2E) |

## Quick start

### Prerequisites
- [Supabase CLI](https://supabase.com/docs/guides/cli) v1.200+
- [Deno](https://deno.land/) v1.40+
- Node.js 20+

### Local development

```bash
# 1. Start local Supabase (PostgreSQL + Edge Functions)
supabase start

# 2. Apply all migrations
supabase db reset --local

# 3. Set up Edge Function environment
cp supabase/.env.example supabase/.env
# Edit supabase/.env — fill in ANTHROPIC_API_KEY, FATSECRET_* credentials

# 4. Serve edge functions locally
supabase functions serve --env-file supabase/.env

# 5. Set up the web app
cd web
cp .env.example .env.local
# Edit .env.local — fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
# (get these from: supabase status)
npm install
npm run dev
```

### Run backend integration tests

```bash
# Requires: supabase start + supabase functions serve --env-file supabase/.env
cd supabase/tests
npx vitest run --config vitest.config.ts
# Expected: 381 backend tests, 0 failures
```

### Run E2E tests

```bash
cd web
npx playwright test
```

### Production deployment

See [docs/deployment/production-deployment.md](docs/deployment/production-deployment.md).

## Directory layout

```
supabase/
  migrations/         0001–0032 — schema evolution + bug fixes
  functions/
    _shared/          Shared helpers (envelope, supabase client, energy calc, science config)
    _handlers/        Server-only request handlers shared by multiple endpoints
    _scheduled/       recalculate-frequency-rankings (cron job)
    export-my-data/   GDPR data export
    save-anthropometric-session/       Draft/finalised anthropometry save
    finalize-anthropometric-session/   Strict finalisation contract
    get-anthropometric-sessions/       Owner history with cursor pagination
    delete-anthropometric-session/     Explicit whole-session deletion
    delete-account/   Account + data deletion
    health/           Service health check
    <29 more>/        One folder per Edge Function
  tests/              Backend integration tests (Vitest, real DB)
web/
  src/
    lib/              Supabase client + fetch helpers
    components/       GoalFeedbackCard, ConfidenceBadge, …
    pages/            Auth, Dashboard, LogMeal, Progress, Account
docs/
  deployment/         Production deployment guide, environment variables
  database/           Migration verification
  security/           Secret audit
  operations/         Backup/restore, observability
  privacy/            Data export and deletion
  testing/            Pre-existing baseline, validation evidence
  release/            Phase 9 readiness audit, release rehearsal
```

## Algorithm versions

All algorithm version strings are present in `supabase/functions/_shared/scienceConfig.ts`:

| Algorithm | Version string |
|-----------|---------------|
| BMR (Mifflin-St Jeor) | `weight_time_ewma_v3` |
| Rate estimation | `weight_rate_theil_sen_v1` |
| Rate interval | `weight_rate_interval_sen_v1` |
| Observed maintenance | `observed_maintenance_energy_balance_v1` |
| Goal progress assessment | `goal_progress_assessment_v1` |
| Goal progress thresholds | `goal_progress_thresholds_v1` |

## Security notes

- All secrets via environment variables; zero credentials committed
- RLS enabled on every user-data table
- `SECURITY DEFINER` RPCs verify `auth.uid() = p_user_id`
- Account deletion gated by explicit `"DELETE MY ACCOUNT"` confirmation
- Server-authoritative calorie targets — client cannot supply `target_calories`
- Portion sizes never guessed; `serving_size_g ?? 100` is a UI-blocking fallback only

## Constraints (never implement)

- **No BMR/TDEE algorithm changes** — Mifflin-St Jeor + Harris-Benedict variants are fixed
- **No portion-size guessing** — always require explicit user input
- **No mock tests** — all integration tests hit the real local Supabase stack
