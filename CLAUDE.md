# Project Rules — Nutrition Tracker

These rules apply to every conversation in this repository. They override Claude Code defaults.

## Behavioral Constraints (always active)

### Never guess portion sizes
Do not estimate or infer gram weights for food portions. When a portion weight is needed and the
user has not provided one, ask for it explicitly. The `serving_size_g ?? 100` fallback in
`log-meal/index.ts` must only ever be used as a technical fallback that blocks confirmation in the
UI — it must never be surfaced as a "suggested" or "default" value to the user.

### Never implement BMR / TDEE / calorie-target algorithms
Do not implement, suggest, or scaffold any algorithm that estimates daily calorie needs, total daily
energy expenditure, or basal metabolic rate. This includes Harris-Benedict, Mifflin-St Jeor,
Katch-McArdle, and their variants.

### No mocking in tests
All tests must hit the real backend. Do not use `callFunction` mocks, `page.route()` network stubs
(except for the `injectSession` helper and deliberate error-path tests), or in-memory fakes for
Supabase edge functions. The only permitted `page.route()` usages are:
1. `injectSession` — intercepts `/auth/v1/token?grant_type=anonymous` to inject a real user session
2. Deliberate error-path stubs — e.g., forcing `parse-meal` to return 500 to test error UI

### Re-propose authenticated persona testing when authentication is ready
The anonymous SQL persona workflow is a temporary backend/UI inspection tool, not the desired
end-to-end product test. As soon as real sign-in and account switching are implemented, explicitly
propose replacing it with the authenticated persona suite described in
`docs/testing/authenticated-persona-testing.md` -- even if the user does not remember to ask.

Use three non-anonymous test accounts created through the supported Auth flow or Admin API. Test
real login, logout, session restoration, data isolation, and feature behavior through real Edge
Functions. Never commit test passwords, OTPs, service-role keys, or personal email addresses. Seed
and cleanup must be repeatable, narrowly tagged, and must refuse real user accounts.

---

## Git Workflow Rules (enforced by hooks in `.claude/settings.json`)

### master is read-only
Never commit directly to master. Never push directly to master. Every change — however small —
must go through a feature branch and a pull request.

### Branch naming
```
feat/<scope>     — new user-facing capability
fix/<scope>      — bug fix
chore/<scope>    — tooling, deps, CI, config
docs/<scope>     — documentation only
test/<scope>     — tests only, no production code
refactor/<scope> — internal restructure, no behavior change
```

### Start-of-work checklist
Before creating a new branch:
```
git fetch --prune origin
git log --oneline origin/master..HEAD   # must be empty — local master must not be ahead
git switch -c <type>/<scope>            # branch from up-to-date master
```
If `git log origin/master..HEAD` shows commits, sync with origin before branching.

### Commit format — Conventional Commits
```
<type>(<scope>): <imperative-mood description>

Body (optional): explain WHY, not WHAT. One paragraph.
Footer (optional): BREAKING CHANGE: <desc>, Closes #<issue>
```
Types: `feat`, `fix`, `refactor`, `test`, `chore`, `docs`, `perf`, `ci`

Each commit must represent one logical, buildable unit of work. Do not batch unrelated changes.

### Pre-push discipline
```
git fetch --prune origin
git rebase origin/master    # if master has moved since branch was created
npm run typecheck           # must pass before push
```

### Preserve uncommitted work
Before any `git switch`, `git checkout`, or context change — if the working tree is dirty:
```
git stash push -u --message "WIP: <description>"
```
Never use `git checkout -- .`, `git restore .`, or `git reset --hard` to discard work. These are
irreversible. Use `git stash` instead.

### Force-push policy
- `git push --force` — **never**
- `git push --force-with-lease` — permitted only on your own feature branch, never on master
- If `--force-with-lease` is needed, explain why in the PR description

### Pull-request discipline
- Every branch must have a PR before it is merged
- PRs start as **draft** until all checks pass
- Never auto-merge. Never merge a PR with failing CI
- Mark ready for review only when: typecheck passes, unit tests pass, integration tests pass
- Squash commits only if the branch history has fixup! / wip commits — otherwise merge commit

### Conflict resolution
When a rebase or merge produces conflicts:
1. Read both sides (ours and theirs) fully before touching the file
2. Resolve semantically — understand what both changes intended
3. Never blindly accept one side with `git checkout --ours` or `--theirs` across the whole file
4. Never guess at the correct resolution — ask the user if the intent is unclear
5. After resolving, run typecheck and tests before continuing the rebase

### Never discard untracked files automatically
Before `git clean`, show the user what would be deleted (`git clean -n`) and ask for confirmation.
`git clean -f` is blocked by hooks.

---

## Stack Reference

- Runtime: React 18 + Vite + TypeScript 5.5 + Tailwind CSS
- Backend: Supabase PostgreSQL + Deno Edge Functions
- Production project ref: `ipdrzvqhprboqqjhjldj`
- Local Supabase port: 54421
- Tests: Vitest 1.6.1 (unit + API integration) + Playwright (E2E)
- Timezone: SAST = Africa/Johannesburg (UTC+2)

## Current state

All nine implementation phases are **complete**. The codebase is on branch
`feat/product-deployment-hardening` awaiting review and merge to `master`.

Phases 1–9 are implemented, tested (331 backend integration tests pass), and
documented. Do not implement Phase 6 features beyond what is already built
(Hall model, effective-dated activity history, waist-to-height ratio). See
`CHANGELOG.md` for a full list of what each phase delivered.
