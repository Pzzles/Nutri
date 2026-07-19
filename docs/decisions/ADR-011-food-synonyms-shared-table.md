# ADR-011 — food_synonyms is a shared table for V1

**Status:** Accepted

## Decision
`food_synonyms` is not per-user-scoped. `created_by` is nullable (null =
system-seeded, non-null = a user's correction) and retained for future
gating, but every synonym is visible to every user for V1.

## Why
Consistent with the single-user target scope for V1 (`01-executive-summary.md`
→ Target User). Scoping this per-user now would add complexity with no
current benefit, but keeping `created_by` means it can be gated later without
a schema change.
