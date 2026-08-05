# Production Deployment Guide

Version: 0.2.0<br>
Last updated: 2026-08-05

Nutri deploys the database, Edge Functions, and web application as one ordered
release. Never deploy a newer web build against an older backend contract.

## Environment model

| Environment | Supabase target | Web command |
|---|---|---|
| Local development | CLI stack on loopback | `npm run dev` |
| Local personas | CLI stack on loopback | `npm run dev:personas` |
| Staging | Separate hosted Supabase project | Hosting-provider preview configuration |
| Production | Production Supabase project | Hosting-provider production configuration |

`npm run dev` obtains the local URL and anon key directly from `supabase
status`; it does not trust `web/.env.local`. Hosted staging and production
values belong in the hosting provider, not in a developer's local file.

## Prerequisites

- Supabase CLI authenticated and linked to the intended project;
- Node.js 20+;
- a verified database backup or point-in-time recovery window;
- Groq, FatSecret, and cron secrets configured in the target project;
- a separate staging project for release rehearsal;
- clean CI for the release commit.

## 1. Confirm the target

```bash
supabase projects list
cat supabase/.temp/project-ref
```

Stop if the linked project is not the intended staging or production project.

Run the read-only drift gate:

```bash
node scripts/deployment-preflight.mjs --project-ref <project-ref>
```

The command intentionally fails while drift exists. Review every pending
migration and missing function. Unknown remote-only migrations are a blocker.

## 2. Rehearse on staging

```bash
supabase link --project-ref <staging-project-ref>
supabase db push --dry-run
supabase db push
supabase functions deploy --project-ref <staging-project-ref>
node scripts/deployment-preflight.mjs --project-ref <staging-project-ref>
```

The final command must print `DEPLOYMENT_PREFLIGHT: GO`. Run the complete local
and browser regression suites against staging before proceeding.

## 3. Back up production

Create and verify a production database backup before applying migrations.
Record the release commit, project ref, migration ledger, deployed function
versions, backup identifier, operator, and timestamp in the release record.

## 4. Apply production migrations

The current repository contains 35 migration files through `0036`. Migration
numbers are identifiers, not a count; `0027` is intentionally absent.

```bash
supabase link --project-ref <production-project-ref>
supabase migration list --linked
supabase db push --dry-run
supabase db push
```

For the Phase 10 remediation rollout from the `0032` production baseline, the
only expected pending migrations are:

```text
0033_anthropometry_confidence_retake.sql
0034_anthropometry_hybrid_representative_v3.sql
0035_anthropometry_transaction_and_ownership_integrity.sql
0036_anthropometry_context_and_interpretation_v2.sql
```

Any other difference is a stop condition.

## 5. Configure secrets

```bash
supabase secrets set --env-file supabase/.env --project-ref <production-project-ref>
supabase secrets list --project-ref <production-project-ref>
```

Do not print secret values in logs or release evidence.

## 6. Deploy Edge Functions

Deploy functions only after the database accepts the new contracts:

```bash
supabase functions deploy --project-ref <production-project-ref>
node scripts/deployment-preflight.mjs --project-ref <production-project-ref>
```

The preflight checks all source function directories against the remote
function inventory. It must print `DEPLOYMENT_PREFLIGHT: GO` before the web
application is promoted.

If the scheduled frequency-ranking function is used, deploy and verify it
separately according to its operations runbook.

## 7. Build and deploy the web application

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the hosting provider's
production environment. Then build the exact reviewed commit:

```bash
cd web
npm ci
npm test
npm run build
```

Deploy `web/dist/` using the hosting provider. Do not copy a developer
`.env.local` into a production build.

## 8. Production smoke test

Using a disposable test account:

1. sign up, sign out, and sign in;
2. log and edit a meal;
3. log weight and inspect its trend;
4. inspect the active goal and maintenance state;
5. save, resume, retake, and finalise an anthropometry session;
6. verify history, context, and cautious Phase 6 comparison;
7. download and inspect the authenticated export;
8. delete the disposable account and confirm its terminal state;
9. verify the health endpoint and production logs.

## Rollback

Database migrations are forward-only. Do not delete or rewrite an applied
migration. If application rollback is required, redeploy the previously tagged
web and function versions while leaving additive schema in place, then prepare
a reviewed compensating migration for any database correction.

## Monitoring

- Edge Function logs: Supabase dashboard → Edge Functions → Logs
- Database metrics: Supabase dashboard → Reports
- Health endpoint: `/functions/v1/health`
- Operational guidance: [observability.md](../operations/observability.md)
