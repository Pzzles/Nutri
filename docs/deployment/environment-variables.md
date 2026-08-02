# Environment Variables

All runtime configuration is supplied via environment variables.
Never commit real values — use `.env.example` templates as a guide.

---

## Web application (`web/.env.local`)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | Yes | Supabase project URL, e.g. `https://abc.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Yes | Supabase anon key (safe to expose to browser — RLS enforces access) |

**Local dev values**: run `supabase status` to get `API URL` and `anon key`.

---

## Edge Functions (`supabase/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Same as VITE_SUPABASE_URL (without VITE_ prefix) |
| `SUPABASE_ANON_KEY` | Yes | Same as VITE_SUPABASE_ANON_KEY |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key — full DB access, bypasses RLS. Never expose publicly. |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key — used by `parse-meal` only |
| `FATSECRET_CONSUMER_KEY` | Yes | FatSecret OAuth 1.0 consumer key |
| `FATSECRET_CONSUMER_SECRET` | Yes | FatSecret OAuth 1.0 consumer secret |
| `CRON_SECRET` | Yes | Shared secret for the `recalculate-frequency-rankings` scheduled function |

---

## Production deployment

1. Create a `.env` file from `supabase/.env.example` with real values
2. Push all secrets to Supabase:
   ```bash
   supabase secrets set --env-file supabase/.env
   ```
3. Verify secrets are set:
   ```bash
   supabase secrets list
   ```

Edge Functions automatically receive `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
from the Supabase platform; you don't need to set these manually for deployed functions.
The other secrets (`ANTHROPIC_API_KEY`, `FATSECRET_*`, `CRON_SECRET`) must be set
explicitly.

---

## Rotation procedure

1. Generate a new key at the relevant provider dashboard
2. Update the secret in Supabase:
   ```bash
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-new-key
   ```
3. Redeploy affected functions:
   ```bash
   supabase functions deploy parse-meal
   ```
4. Verify the function works with the new key
5. Revoke the old key at the provider dashboard
