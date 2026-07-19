# Nutrition Tracker

A working skeleton built from `docs/02-prs.md` (v2.0) through
`docs/07-edge-functions.md` (v2.0) and the 13 ADRs in `docs/decisions/`.
This is not a finished product — it's the core pipeline, for real, plus
clearly-marked stubs for everything not yet wired up.

## What's actually implemented

- **Full database schema** (`supabase/migrations/0001_init_schema.sql`) —
  every table, RLS policy, and Postgres function described in the spec.
- **The core logging pipeline, end to end**: `parse-meal` (Claude) →
  `resolve-foods` (Food Resolution Engine — synonym resolution, tiered
  cache lookup, fuzzy matching, confidence scoring, post-resolution
  duplicate detection) → `calculate-meal` (pure nutrition math) →
  `log-meal` (atomic persistence + idempotency + cache promotion).
- **Supporting functions**: `search-food`, `barcode-lookup`,
  `create-custom-food`, `manage-custom-food`, `save-meal-template`,
  `dashboard-summary` (today's totals), `log-weight`, `recent-foods`,
  `edit-meal` (meal-level fields only), `health`, and the scheduled
  `recalculate-frequency-rankings` job.
- **A working React app** (`web/`) with magic-link auth, a "log a meal"
  flow that exercises the whole pipeline, and a basic dashboard.

## What's honestly stubbed, not faked

- **USDA FDC / Open Food Facts text search** (`resolve-foods` tiers 4-5) —
  the function signature and call site exist; the actual HTTP calls are a
  `TODO`. Verify current API docs for both before wiring this up — external
  API shapes drift and I didn't want to guess at exact params in code you'd
  otherwise trust blindly.
- **`log-meal` source: `'template'` and `'copy_previous'`** — return
  `501 NOT_IMPLEMENTED`. The `draft` path (used by the web app) is fully
  implemented; these two converge on the same persistence logic once
  written (see ADR-013) but the re-resolution step for each isn't built yet.
- **Volume/count → gram conversion** in `calculate-meal` — only mass units
  (`g`/`kg`) convert directly today. "1 cup rice" or "2 eggs" fall back to
  the food's default serving size. Real conversion needs per-food density
  or piece-weight data, which is its own small reference table.
- **7-day dashboard trend** — today's totals are fully correct; the trend
  view is a `TODO` in `dashboard-summary`.
- **`edit-meal`** only supports meal-level fields (`meal_type`, `eaten_at`)
  today. Editing an individual meal item's quantity would need to re-run
  `calculate-meal` to refresh confidence/totals — not yet wired.
- **TanStack Query / React Hook Form / Zod** — named in the original tech
  stack (`01-executive-summary.md`) but not yet added to `web/`. The app
  uses plain `useState` for now. Worth adding once there's more than one
  form to justify it.

## Setup

### 1. Supabase project

```bash
# from the supabase/ directory, against a project you've already created
supabase link --project-ref <your-project-ref>
supabase db push          # runs 0001_init_schema.sql
cp .env.example .env      # fill in the values
supabase secrets set --env-file .env
supabase functions deploy # deploys every function in supabase/functions/
```

For local development instead: `supabase start`, then
`supabase functions serve --env-file .env`.

### 2. Scheduled job

`recalculate-frequency-rankings` needs a `pg_cron` job (or an external
scheduler) hitting it once daily with the `x-cron-secret` header set to
your `CRON_SECRET` value. Not automated by this scaffold — add it via the
Supabase SQL editor:

```sql
select cron.schedule(
  'recalculate-frequency-rankings',
  '0 3 * * *', -- daily at 03:00 UTC
  $$
  select net.http_post(
    url := 'https://<your-project-ref>.functions.supabase.co/recalculate-frequency-rankings',
    headers := jsonb_build_object('x-cron-secret', '<your CRON_SECRET>')
  );
  $$
);
```

(Requires the `pg_cron` and `pg_net` extensions enabled on your project.)

### 3. Web app

```bash
cd web
npm install
cp .env.example .env.local   # fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run dev
```

## Directory layout

```
docs/
  decisions/        ADR-001 through ADR-013
supabase/
  migrations/        0001_init_schema.sql
  functions/
    _shared/          types, envelope, confidence table, unit families, client factories
    _scheduled/       recalculate-frequency-rankings (cron-only, not client-facing)
    <14 functions>/   one folder per Edge Function
web/
  src/
    lib/              supabase client + fetch helper + shared types
    components/       ConfidenceBadge
    pages/            Auth, LogMeal, Dashboard
```

## A note on the spec docs

The canonical `02-prs.md`, `05-database-design.md`, and
`07-edge-functions.md` (all v2.0) exist as text earlier in the conversation
this was built from — this repo doesn't duplicate them as files yet.
`03-domain-model.md` and `04-system-architecture.md` only exist as patch
notes against the original drafts, not fully merged documents. Worth doing
that merge before this grows much further, so the docs and the code don't
drift apart.
