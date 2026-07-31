# Skill: Git Workflow

Invoked when the user asks to start a new feature, create a branch, commit work, open a PR,
resolve a conflict, or perform any git operation in this repository.

---

## When invoked

This skill activates on prompts such as:
- "start work on X"
- "commit this"
- "push my changes"
- "open a PR"
- "resolve this conflict"
- "I'm done with this branch"
- Any git command that touches master or creates a commit

---

## Step-by-step procedures

### A. Starting new work

1. **Confirm working tree is clean.**
   ```
   git status
   ```
   If anything is modified or untracked: `git stash push -u --message "WIP: <description>"` before
   continuing. Report what was stashed and where (stash index and message).

2. **Fetch and sync.**
   ```
   git fetch --prune origin
   git switch master
   git pull --ff-only origin master
   ```
   If `--ff-only` fails (diverged), stop and report to the user. Do NOT force-reset master.

3. **Confirm local master matches remote.**
   ```
   git log --oneline origin/master..HEAD
   ```
   Must produce zero output. If it does not, investigate before continuing.

4. **Create branch.**
   ```
   git switch -c <type>/<scope>
   ```
   Branch name format: `feat/`, `fix/`, `chore/`, `docs/`, `test/`, `refactor/` + kebab-case scope.
   Example: `feat/template-copy-flow`, `fix/weightlog-is-official-crash`

5. **Confirm branch.**
   ```
   git branch
   ```
   Active branch should be the new branch, not master.

---

### B. Making commits

1. **Review what will be staged** — never `git add -A` blindly.
   ```
   git status
   git diff
   ```

2. **Check for secrets before staging.**
   Look at any `.env` files, config files, or files with names containing `key`, `secret`, `token`,
   `password`, `credential`. If content looks like a real secret (long opaque string, JWT, API key):
   stop and warn the user before staging.

3. **Stage files explicitly.**
   ```
   git add path/to/file1 path/to/file2
   ```
   Avoid `git add .` unless you have reviewed every file that would be included (`git status`).

4. **Check for conflict markers in staged files.**
   ```
   git diff --cached | grep -n "^+.*<<<<<<<\|^+.*>>>>>>>\|^+.*======="
   ```
   If any conflict markers are present: stop, report, and resolve before committing.

5. **Commit with Conventional Commits format.**
   ```
   git commit -m "$(cat <<'EOF'
   type(scope): imperative description

   Optional body explaining the WHY.

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
   EOF
   )"
   ```
   Types: `feat`, `fix`, `refactor`, `test`, `chore`, `docs`, `perf`, `ci`

6. **Never commit on master.** If `git branch --show-current` returns `master`, stop.
   The hook in `.claude/settings.json` enforces this — if it triggers, respect it.

---

### C. Preparing to push

1. **Run checks locally.**
   ```
   cd web && npm run typecheck
   cd web && npm run test:unit -- --run    (or equivalent)
   ```
   If any check fails: fix it on this branch. Never push with failing checks.

2. **Rebase onto latest master.**
   ```
   git fetch --prune origin
   git rebase origin/master
   ```
   If conflicts arise during rebase: follow the conflict resolution procedure (Section E).
   After rebase: re-run checks.

3. **Push.**
   ```
   git push -u origin <branch-name>
   ```
   First push uses `-u` to set the upstream. Subsequent pushes use plain `git push`.
   Never push to `origin master`.

---

### D. Opening a pull request

1. **Push the branch** (Section C).

2. **Create a DRAFT PR.**
   ```
   gh pr create --draft \
     --title "<type>(<scope>): <description>" \
     --body "$(cat <<'EOF'
   ## Summary
   - <bullet 1>
   - <bullet 2>

   ## Test plan
   - [ ] TypeScript typecheck passes
   - [ ] Unit tests pass
   - [ ] Backend integration tests pass (117/117)
   - [ ] Playwright E2E passes (if applicable)

   ## Phase 5 gate
   <!-- Remove this section if this PR is not a Phase 5 prerequisite -->
   This PR addresses NO-GO blocker: <blocker description from verification doc>

   🤖 Generated with Claude Code
   EOF
   )"
   ```

3. **List open PRs and report.**
   ```
   gh pr list
   ```
   Report the PR number, title, URL, and total count of open PRs.

4. **Never mark ready until all checks pass.** Leave as draft until CI is green.

5. **Never merge from the CLI without explicit user instruction.**

---

### E. Conflict resolution

When `git rebase` or `git merge` hits a conflict:

1. **Stop. Read both sides completely** before touching the file.
   ```
   git diff
   ```
   Identify: what did `ours` intend? what did `theirs` intend? Are they compatible?

2. **Resolve semantically.** Edit the file to combine both intentions correctly. Do not use:
   - `git checkout --ours <file>` — silently discards the other side
   - `git checkout --theirs <file>` — silently discards our side
   Unless you have fully read both sides and confirmed one is a subset of the other.

3. **Never guess.** If the correct resolution is ambiguous, stop and ask the user.
   Describe both sides and what you believe each intended. Let the user decide.

4. **After resolving:**
   ```
   git add <resolved-file>
   git rebase --continue   (or git merge --continue)
   ```
   Then run typecheck and tests to confirm correctness.

---

### F. Stashing and context switching

Before switching branches or starting unrelated work:

```
git status     # confirm what is present
git stash push -u --message "WIP: <description of what was in progress>"
git stash list # confirm stash was saved
```

When returning to stashed work:
```
git stash list         # find the right stash
git stash pop          # apply and drop (only if there is one stash and it is unambiguous)
git stash apply stash@{N}  # apply without dropping (safer when multiple stashes exist)
```

**Never** `git stash drop` without confirming the work has been committed or is truly unwanted.

---

### G. Before closing a branch

1. Confirm the PR is merged or explicitly abandoned.
2. Delete the local branch:
   ```
   git branch -d <branch-name>    # -d = safe delete (only if merged)
   ```
   Never use `-D` (force delete) unless you have confirmed the commits are preserved elsewhere.

---

## Invariants

These conditions must always be true. Treat a violation as a hard stop.

| Invariant | Check command |
|-----------|--------------|
| Never on master | `git branch --show-current` must not return `master` before any commit |
| No conflict markers staged | `git diff --cached \| grep -c "^+.*<<<<<<<"` must return 0 |
| Checks pass before push | tsc exit 0, unit tests exit 0 |
| No direct push to master | `git remote show origin` — master push should never appear in your history |
| Stash preserved, not discarded | `git stash list` before and after any context switch |

---

## Blocked operations (enforced by `.claude/hooks/git-guard.js`)

The following commands will be blocked by the pre-bash hook. If a hook fires, do not attempt to
work around it — report the block to the user and follow the safe alternative.

| Blocked | Reason | Safe alternative |
|---------|--------|-----------------|
| `git commit` on master | Protected branch | `git switch -c feat/<scope>` first |
| `git push origin master` | Direct push to master | Create a PR |
| `git push --force` (without `--force-with-lease`) | Overwrites remote without safety net | Use `--force-with-lease` on feature branches only |
| `git reset --hard` | Irreversible, discards all uncommitted work | `git stash -u` then `git reset --soft HEAD~N` |
| `git clean -f` | Permanently deletes untracked files | `git clean -n` to preview, then ask user |
| `git checkout -- .` / `git restore .` | Discards all working-tree changes | `git stash -u` |
| `git push --force-with-lease` to master | Master is always protected | Never push to master directly |

---

## Dry-run verification

To confirm the hooks are active, run these commands and verify they are blocked:

```bash
# Should be blocked if on master:
git commit --allow-empty -m "test: hook verification"

# Should always be blocked:
git push --force origin HEAD
git reset --hard HEAD
git clean -fn    # preview only — -fn is safe; -f would be blocked
```

Expected output for each: `BLOCKED: ...` message from the hook, exit code 2.
