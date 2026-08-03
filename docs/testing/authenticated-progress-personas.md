# Authenticated Progress Personas

This suite provisions eight real, non-anonymous Supabase Auth users for repeatable Progress testing.
Each account has a complete fictional profile, an active cut, maintenance, or bulk phase, 84 days of
weight history, and 28 days of deliberately varied nutrition-log coverage.

The accounts are tagged with `test_suite=authenticated_progress_personas_v1`. The harness refuses
to modify an identity without that exact marker and an address in the reserved `example.invalid`
domain. Fixture values are test data, not calorie recommendations or body-composition claims.

## Personas

| Selector | Phase | Intended state |
| --- | --- | --- |
| Alex — steady cut | Cut | Consistent loss, frequent weights, high nutrition coverage |
| Bea — variable cut | Cut | Gradual loss with noisier scale readings |
| Casey — stable maintenance | Maintenance | Stable weight and high coverage |
| Devon — maintenance drift | Maintenance | Sustained upward weight drift |
| Ellis — steady bulk | Bulk | Consistent gain and high coverage |
| Frankie — provisional bulk | Bulk | Slower gain and incomplete nutrition coverage |
| Gray — sparse maintenance | Maintenance | Weekly weights and sparse complete food logs |
| Harper — cut plateau | Cut | Early loss followed by a recent plateau |

## Seed the hosted test project

From `supabase/tests`:

```powershell
npm run personas:seed -- --project-ref ipdrzvqhprboqqjhjldj
```

The command obtains keys from the authenticated Supabase CLI without printing them, creates or
updates only the marked accounts, resets their owned rows, seeds the datasets, authenticates every
persona, and calls the real maintenance endpoint. It then writes credentials to
`web/.env.personas.local`, which Git ignores. Emails and passwords are never printed.

Rerunning `seed` is intentionally destructive only for these eight marked test identities: manual
changes made while testing them are replaced by the canonical fixture.

To target a running local Supabase stack, replace the project option with `--local`.

## Use the login selector

From `web`:

```powershell
npm run dev:personas
```

Open the app, use **Test persona (development only)** on the sign-in page, and choose a person. The
selection signs in immediately and opens **Progress → Maintenance**. The selector is compiled only
in Vite development mode and only when the generated opt-in flag is present.

## Verify or reset

From `supabase/tests`:

```powershell
npm run personas:verify -- --project-ref ipdrzvqhprboqqjhjldj
npm run personas:reset -- --project-ref ipdrzvqhprboqqjhjldj
```

`verify` signs into all eight accounts, validates profile/phase/history counts, and calls the real
maintenance function. `reset` retains the Auth users and ignored credentials but removes their
seeded application data and recreates empty marked profiles.

To restore the full fixtures after a reset, run `personas:seed` again.

## Browser acceptance test

After seeding, from `web`:

```powershell
$env:E2E_VITE_MODE = "personas"
$env:E2E_BASE_URL = "http://localhost:5184"
npm run test:e2e:integration -- authenticated-personas.spec.ts
```

The browser test uses the visible selector, the real Auth service, and the real maintenance Edge
Function for each account. It does not intercept successful requests.

## Destroy the identities

Destruction is separate and requires the suite marker as explicit confirmation:

```powershell
npm run personas:destroy -- --project-ref ipdrzvqhprboqqjhjldj --confirm authenticated_progress_personas_v1
```

This deletes only the eight revalidated marked users and removes the ignored credential file.
