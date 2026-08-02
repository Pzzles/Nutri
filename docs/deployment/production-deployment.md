# Production Deployment Guide

Version: 0.1.0  
Last updated: 2026-08-02

---

## Prerequisites

- Supabase CLI v1.200+ (`supabase --version`)
- A Supabase project created at [supabase.com](https://supabase.com)
- Anthropic API key
- FatSecret Platform API credentials
- Node.js 20+ (for web build)

---

## Step 1 — Link to your Supabase project

```bash
supabase login
supabase link --project-ref <your-project-ref>
```

Find your project ref in the Supabase dashboard → Project Settings → General.

---

## Step 2 — Apply database migrations

```bash
supabase db push
```

This applies all 28 migrations (0001–0028) to your production database.

To verify: open the Supabase dashboard → SQL Editor and run:
```sql
SELECT COUNT(*) FROM supabase_migrations.schema_migrations;
-- Expected: 28
```

---

## Step 3 — Configure secrets

Create `supabase/.env` from the template:
```bash
cp supabase/.env.example supabase/.env
```

Fill in all values, then push:
```bash
supabase secrets set --env-file supabase/.env
```

Verify:
```bash
supabase secrets list
```

---

## Step 4 — Deploy Edge Functions

```bash
supabase functions deploy
```

This deploys all functions under `supabase/functions/` (excluding `_shared` and `_scheduled`).

Deploy the scheduled function separately:
```bash
supabase functions deploy recalculate-frequency-rankings
```

---

## Step 5 — Set up the scheduled job

In the Supabase SQL Editor, enable `pg_cron` and `pg_net` extensions if not already enabled:
```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
```

Schedule the daily job:
```sql
SELECT cron.schedule(
  'recalculate-frequency-rankings',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://<your-project-ref>.functions.supabase.co/recalculate-frequency-rankings',
    headers := jsonb_build_object('x-cron-secret', '<your-CRON_SECRET>')
  );
  $$
);
```

---

## Step 6 — Deploy the web application

```bash
cd web
npm install
npm run build
```

The build output is in `web/dist/`. Deploy to your hosting provider (Vercel, Netlify, Cloudflare Pages, etc.).

For Vercel:
```bash
npx vercel --prod
```

Set these environment variables in your hosting provider dashboard:
- `VITE_SUPABASE_URL` = your project URL
- `VITE_SUPABASE_ANON_KEY` = your anon key

---

## Step 7 — Smoke test

After deployment, verify core flows work:

1. Open the deployed URL
2. Complete anonymous onboarding
3. Log a test meal (e.g., "100g chicken breast")
4. Log a weight entry
5. Open the Account page and download your data export
6. Verify the health endpoint: `GET https://<project-ref>.functions.supabase.co/health`

---

## Rollback

If a deployment introduces a regression:

1. Redeploy the previous function version:
   ```bash
   git checkout <previous-tag>
   supabase functions deploy <function-name>
   ```

2. For migration rollbacks: Supabase does not support automatic rollbacks.
   Write a compensating migration and apply it via `supabase db push`.

---

## Monitoring

- Function logs: Supabase dashboard → Edge Functions → Logs
- Database metrics: Supabase dashboard → Reports
- Health check: `GET /functions/v1/health` — returns `{ status: "ok", database: "connected" }`

See [observability.md](../operations/observability.md) for structured logging details.
