# Pre-existing Backend Test Baseline

Recorded against both `origin/master` (a2021db) and `feat/weight-trend-modelling` (d5cc288)
before any Prompt 4 frontend work. Used to distinguish pre-existing failures from
regressions introduced by this branch.

## Failure count

| Branch | Files failed | Tests failed | Tests passed |
|---|---|---|---|
| `origin/master` | 3 | 12 | 153 |
| `feat/weight-trend-modelling` (pre-P4) | 3 | 12 | 227 |

The 74-test increase on this branch comes from `weight-trend.test.ts` added in Prompt 3.
The 12 failures are identical on both branches.

## Failing test files

1. `edge_functions.test.ts`
2. `weight_logs.test.ts`
3. `resolve-foods.test.ts`

## Failing test names

### `weight_logs.test.ts`

```
fn_log_weight — same-day official flip (FR-042 AC2)
  > demotes earlier same-day entry when a new one is logged
  TypeError: Cannot read properties of null (reading 'is_official')

fn_log_weight — same-day official flip (FR-042 AC2)
  > all three same-day entries retained — only latest is official
  AssertionError: expected [] to have a length of 3 but got +0

weight_logs RLS
  > user A can see their own weight logs
  AssertionError: expected 0 to be greater than 0
```

### Other files

Failures in `edge_functions.test.ts` and `resolve-foods.test.ts` are also pre-existing.
The exact names are visible in the full test output.

## Root cause

Not investigated. These failures exist on `origin/master` before any Phase 6 work
and are unrelated to the weight-trend feature. Prompt 4 must not introduce any new
failures relative to this baseline.

## Test command

```
cd supabase/tests && npm test
```

## Acceptance criterion

`feat/weight-trend-modelling` after Prompt 4: 12 failures, same 3 files, zero new failures.
