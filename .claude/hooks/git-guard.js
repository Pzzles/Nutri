#!/usr/bin/env node
/**
 * Pre-bash / pre-PowerShell hook: enforces git workflow rules.
 *
 * Receives tool invocation JSON on stdin.
 * Exits 2 + prints a BLOCKED message to abort the tool call.
 * Exits 0 to allow.
 *
 * Rules enforced:
 *   1. No git commit on master branch
 *   2. No git push directly to master
 *   3. No git push --force (without --force-with-lease)
 *   4. No git push --force-with-lease to master
 *   5. No git reset --hard
 *   6. No git clean -f (any variant)
 *   7. No bulk git restore / checkout -- .
 *   8. No conflict markers in staged files at commit time
 */

'use strict';
const { execSync } = require('child_process');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw);
    const cmd = (input.tool_input && (input.tool_input.command || input.tool_input.script)) || '';
    check(cmd);
  } catch (_) {
    // Never block on hook parse errors
    process.exit(0);
  }
});

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (_) {
    return '';
  }
}

function block(reason) {
  console.log('BLOCKED: ' + reason);
  process.exit(2);
}

function check(cmd) {
  if (!cmd || !cmd.trim()) { process.exit(0); }

  const normalized = cmd.replace(/\s+/g, ' ').trim();

  // ── 1. Force push without --force-with-lease ─────────────────────────────
  if (/\bgit\s+push\b/.test(normalized) && /--force(?!-with-lease)/.test(normalized)) {
    block(
      'git push --force is not allowed.\n' +
      'Use --force-with-lease to ensure you cannot overwrite commits you have not seen:\n' +
      '  git push --force-with-lease origin <branch>\n' +
      'Never use force push on master under any circumstances.'
    );
  }

  // ── 2. Any push to master (direct or via HEAD:master) ─────────────────────
  if (/\bgit\s+push\b/.test(normalized) && /\bmaster\b/.test(normalized)) {
    block(
      'Direct push to master is not allowed.\n' +
      'Push to a feature branch and open a pull request:\n' +
      '  git push -u origin <your-branch-name>\n' +
      '  gh pr create --draft ...'
    );
  }

  // ── 3. Push current branch while it is master ─────────────────────────────
  //    (catches: git push, git push origin, git push -u origin HEAD)
  if (/\bgit\s+push\b/.test(normalized) && !/origin\s+\S/.test(normalized)) {
    const branch = run('git branch --show-current');
    if (branch === 'master') {
      block(
        'You are on master and trying to push. Direct push to master is not allowed.\n' +
        'Switch to a feature branch first:\n' +
        '  git switch -c feat/<scope>'
      );
    }
  }

  // ── 4. git reset --hard ───────────────────────────────────────────────────
  if (/\bgit\s+reset\s+--hard\b/.test(normalized)) {
    block(
      'git reset --hard is not allowed as auto-recovery — it permanently discards uncommitted work.\n' +
      'Safe alternatives:\n' +
      '  git stash push -u    — set work aside temporarily\n' +
      '  git reset --soft HEAD~1  — undo last commit, keep changes staged\n' +
      '  git revert <sha>     — undo a commit safely with a new commit'
    );
  }

  // ── 5. git clean -f (any form: -f, -fd, -fdx, -fX, etc.) ─────────────────
  if (/\bgit\s+clean\b/.test(normalized) && /-[a-zA-Z]*f/.test(normalized)) {
    block(
      'git clean -f is not allowed. It permanently deletes untracked files.\n' +
      'To preview what would be deleted:\n' +
      '  git clean -n\n' +
      'If deletion is truly intended, ask the user to confirm first.'
    );
  }

  // ── 6. Bulk file discard: git checkout -- . or git restore . ─────────────
  if (/\bgit\s+checkout\s+--\s+\./.test(normalized) || /\bgit\s+restore\s+\./.test(normalized)) {
    block(
      'Bulk file restore (git checkout -- . / git restore .) discards all uncommitted changes.\n' +
      'Use git stash to preserve work instead:\n' +
      '  git stash push -u --message "WIP: <description>"\n' +
      'To restore a single file: git restore <specific-file>'
    );
  }

  // ── 7. Commit on master branch ────────────────────────────────────────────
  if (/\bgit\s+commit\b/.test(normalized) && !normalized.includes('--amend')) {
    const branch = run('git branch --show-current');
    if (branch === 'master') {
      block(
        'Committing directly to master is not allowed.\n' +
        'Create a feature branch first:\n' +
        '  git switch -c <type>/<scope>   (e.g. feat/my-feature, fix/crash-in-weight-log)\n' +
        'Then commit there and open a pull request.'
      );
    }
  }

  // ── 7b. --amend on master ─────────────────────────────────────────────────
  if (/\bgit\s+commit\s+--amend\b/.test(normalized)) {
    const branch = run('git branch --show-current');
    if (branch === 'master') {
      block(
        'Amending a commit on master is not allowed.\n' +
        'Master commits are published. Amending rewrites history and requires a force push.\n' +
        'Use git revert instead to create a correcting commit.'
      );
    }
  }

  // ── 8. Conflict markers in staged files ───────────────────────────────────
  if (/\bgit\s+commit\b/.test(normalized)) {
    const stagedFiles = run('git diff --cached --name-only').split('\n').filter(Boolean);
    for (const file of stagedFiles) {
      try {
        const content = execSync(`git show :${JSON.stringify(file)}`, {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
          maxBuffer: 1024 * 1024,
        });
        if (/^(<{7}|>{7}|={7})[ \t]/m.test(content)) {
          block(
            `Conflict marker detected in staged file: ${file}\n` +
            'Resolve the conflict before committing.\n' +
            'Look for lines starting with <<<<<<<, =======, or >>>>>>> and edit them.'
          );
        }
      } catch (_) {
        // Binary file or unreadable — skip
      }
    }
  }

  process.exit(0);
}
