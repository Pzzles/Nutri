# Authenticated Persona Testing Plan

## Status

Implemented for Progress and Maintenance testing with eight accounts. See
[`authenticated-progress-personas.md`](./authenticated-progress-personas.md) for the commands,
fixture matrix, login selector, safeguards, and browser acceptance test.

The anonymous scripts may remain useful for isolated backend inspection, but they are not the
acceptance test for authenticated product behavior.

## Why the current approach is temporary

Changing one anonymous user's SQL dataset between personas does not verify:

- the real sign-in, sign-out, or account-recovery path;
- session restoration after refresh or browser restart;
- data isolation between different people;
- whether data follows an account onto another device;
- account linking, email confirmation, or identity transitions;
- cleanup behavior for a normal authenticated account.

It also makes visual testing awkward because each SQL run replaces the person currently being
viewed. The authenticated suite must use separate identities that can be revisited without reseeding
between every screen.

## Required personas

Create three clearly named, non-anonymous test identities. Their exact feature data may evolve, but
they must exercise materially different product states:

1. **Consistent progress**
   - Complete profile and active goal phase.
   - Consistent weight and nutrition history.
   - Exercises ready/high-quality states and the normal happy path.

2. **Stable or boundary case**
   - Different profile, foods, activity, and goal mode.
   - Exercises stable, medium-confidence, or near-threshold behavior.

3. **Needs attention**
   - Different profile, foods, weights, and logging coverage.
   - Exercises provisional, incomplete, stale, drift, opposite-direction, or advisory behavior.

Food records must use explicit gram weights. Do not infer or guess portion sizes. Persona values are
fictional UI fixtures, not recommendations.

## Account provisioning

- Create accounts through the supported application Auth flow or the Supabase Admin API. Do not
  insert directly into `auth.users` with handwritten SQL.
- Use a dedicated non-production email domain, provider sandbox, or documented test-email aliases.
- Store account emails and credentials in local environment variables or the CI secret store.
- Never commit passwords, OTPs, access tokens, refresh tokens, service-role keys, or personal email
  addresses.
- Mark accounts with unambiguous test metadata such as `test_suite=authenticated_personas_v1`.
- Provisioning must refuse to reuse an account without that exact test marker.

Preferred environment-variable shape:

```text
TEST_PERSONA_1_EMAIL
TEST_PERSONA_1_PASSWORD
TEST_PERSONA_2_EMAIL
TEST_PERSONA_2_PASSWORD
TEST_PERSONA_3_EMAIL
TEST_PERSONA_3_PASSWORD
```

The names document the interface only. Real values belong outside the repository.

## Seed and reset design

Build a small authenticated-persona harness rather than asking a developer to paste UUIDs into SQL.
It should:

1. Sign in or use the Admin API to resolve each allowlisted test identity.
2. Verify every resolved user is non-anonymous and carries the exact test-suite marker.
3. Refuse any user that is unmarked, ambiguous, or looks like a real account.
4. Reset only rows owned by the selected test identities.
5. Seed complete, relative-date datasets through real database contracts.
6. Tag all seed-owned records with a stable suite/version marker where the schema permits.
7. Print a compact verification summary for each persona.
8. Be idempotent: rerunning reset then seed must produce the same state.

Prefer two explicit commands or scripts:

```text
authenticated-personas seed
authenticated-personas reset
```

Reset normally returns the three test accounts to an empty baseline so they can be reused. A separate
explicit `destroy` operation may delete the Auth identities, but it must require stronger confirmation
and the same marker checks.

## End-to-end acceptance flow

Run each persona through the real browser and backend:

1. Sign in through the visible application UI.
2. Confirm the expected dashboard, log, progress, maintenance, and feedback states.
3. Refresh and confirm the session and selected account persist correctly.
4. Sign out, sign in as the next persona, and confirm no previous persona data is visible.
5. Sign back into the first persona and confirm its data remains unchanged.
6. Where practical, sign into the same persona in a second browser context to verify account
   portability.
7. Exercise read and save actions through real Edge Functions. Do not intercept successful requests.
8. Confirm every used endpoint has a deployed function and successful CORS preflight.
9. Run reset and verify no tagged feature rows remain for any persona.
10. Confirm reset did not affect any unmarked account.

## Minimum assertions

- All three users have `is_anonymous = false`.
- Authentication succeeds using the supported UI.
- Logout removes access to the previous account's data.
- Each account sees only its own meals, weight logs, phases, snapshots, and assessments.
- Expected feature states match the seeded evidence.
- Save actions persist and remain visible after refresh.
- No successful request is mocked.
- Seed and reset are repeatable.
- No credentials appear in Git diffs, test reports, screenshots, or command output.

## Trigger for future agents

An agent must bring this plan back to the user when any of the following occurs:

- a sign-in page or complete sign-in flow is added;
- sign-out or account switching is implemented;
- the user says authentication is ready;
- the user asks for persona, acceptance, E2E, maintenance, or feedback testing after Auth exists.

At that point, do not silently continue using anonymous SQL persona swapping. Present this plan,
confirm the safe test-account email mechanism, then implement the authenticated harness.
