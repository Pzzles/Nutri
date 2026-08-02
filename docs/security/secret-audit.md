# Secret Audit

Date: 2026-08-02  
Scope: `supabase/` and `web/` directories  
Branch: `feat/product-deployment-hardening`

---

## Summary

**No secrets committed to git.** All credential files are git-ignored.

---

## Files checked

### Committed files (present in git history)

| File | Contains secrets? | Notes |
|------|------------------|-------|
| `web/.env.example` | No | Template with empty values only |
| `supabase/.env.example` | No | Template with empty values only |
| `.env.example` | No | Root template, empty values only |
| `CLAUDE.md` | No | — |
| `README.md` | No | — |

### Git-ignored files (NOT in history)

| File | Purpose | Git-ignored via |
|------|---------|----------------|
| `web/.env.local` | Vite env vars (URL + anon key) | `web/.gitignore` |
| `supabase/.env` | Edge function secrets | `supabase/.gitignore` |

### Verification

```bash
# Confirm no .env files are tracked
git ls-files | grep -E '\.env($|\.local)'
# Expected output: (empty)

# Confirm .env.example files are the only env-related tracked files
git ls-files | grep env
# Expected output:
#   .env.example
#   supabase/.env.example
#   web/.env.example
```

---

## Secrets inventory

All secrets are set via environment variables. For production deployment they
must be added as Supabase project secrets:

```bash
supabase secrets set --env-file supabase/.env
```

| Secret | Where used | Rotation impact |
|--------|-----------|----------------|
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions (admin ops) | High — rotate if exposed |
| `ANTHROPIC_API_KEY` | `parse-meal` only | Medium — rotate if exposed; no user data sent |
| `FATSECRET_CONSUMER_KEY` | `resolve-foods` food lookup | Low — public search API |
| `FATSECRET_CONSUMER_SECRET` | `resolve-foods` food lookup | Low |
| `CRON_SECRET` | `_scheduled/recalculate-frequency-rankings` | Low |

The `SUPABASE_ANON_KEY` is intentionally semi-public (sent to the browser via
`VITE_SUPABASE_ANON_KEY`). RLS policies ensure anonymous access is safe.

---

## Local dev keys

The local Supabase stack uses well-known development keys published by the
Supabase project. These are not real credentials:
- Anon key: `eyJhbGci...` (standard demo key, expires 2033)
- Service role key: `eyJhbGci...` (standard demo key, expires 2033)

These are only valid against `http://127.0.0.1:54421` and are never deployed.

---

## Finding

No secret history issues found. The git history has been reviewed and contains
no credentials, tokens, or private keys.
