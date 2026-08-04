# Environment Variables

All runtime configuration is supplied through environment variables. Never
commit real values; use the repository templates as field references.

## Web application

| Variable | Required | Description |
|---|---:|---|
| `VITE_SUPABASE_URL` | Yes | Hosted staging or production Supabase URL |
| `VITE_SUPABASE_ANON_KEY` | Yes | Browser-safe anon key; RLS remains authoritative |

`npm run dev` and `npm run dev:personas` inject the local CLI stack's URL and
anon key automatically. An existing `web/.env.local` cannot redirect those
commands to a hosted project. Configure staging and production values in the
hosting provider's environment settings.

## Edge Functions

| Variable | Required | Description |
|---|---:|---|
| `SUPABASE_URL` | Platform | Supabase project URL |
| `SUPABASE_ANON_KEY` | Platform | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Platform | Privileged server-only key; never expose publicly |
| `GROQ_API_KEY` | Yes | Groq key used by `parse-meal` |
| `GROQ_API_URL` | No | OpenAI-compatible endpoint override for isolated testing |
| `FATSECRET_CONSUMER_KEY` | Yes | FatSecret OAuth consumer key |
| `FATSECRET_CONSUMER_SECRET` | Yes | FatSecret OAuth consumer secret |
| `USDA_FDC_API_KEY` | No | USDA key; defaults to the limited `DEMO_KEY` |
| `CRON_SECRET` | Yes | Secret used by scheduled frequency ranking |

Deployed functions receive the Supabase platform variables automatically. Set
the provider and cron secrets explicitly:

```bash
supabase secrets set --env-file supabase/.env --project-ref <project-ref>
supabase secrets list --project-ref <project-ref>
```

Do not set `GROQ_API_URL` in production unless a reviewed provider proxy is
intentional. Omitting it uses Groq's official endpoint.

## Rotation procedure

1. Create the replacement provider key.
2. Update the corresponding Supabase secret.
3. Redeploy only the affected functions.
4. Exercise the real provider path.
5. Revoke the old key.
