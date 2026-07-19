# ADR-009 — Formally supersedes "insert new versions" from the original database draft

**Status:** Accepted

## Decision
An earlier draft of the database design proposed "insert new versions" as the
migration strategy for meal edits. This is superseded by ADR-001: meal history
is append-only via `meal_edit_log`, not through row versioning.

## Why
Consistency — this ADR exists purely to make sure no future doc silently
reintroduces the versioning approach that ADR-001 already rejected.
