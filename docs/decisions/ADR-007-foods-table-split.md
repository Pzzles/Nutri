# ADR-007 — Split canonical foods from user preferences

**Status:** Accepted

## Decision
`foods` holds canonical nutrition definitions only (with `owner_user_id` for
private custom foods). `user_saved_foods` holds pure preference data —
nickname, favorite flag, default serving, usage count — referencing `foods`.

## Why
The original single-table draft conflated "a food exists" with "this user
likes/uses this food," which are different lifecycles (a food is shared or
owned once; a preference is per-user and can exist independently of whether
the food is a favorite). Resolves an ambiguity flagged during the PRS audit
(finding C1: Saved Food vs. favorite food).

## Consequence
`create-custom-food` always writes both rows. Favoriting a food that has no
existing `user_saved_foods` row creates one rather than erroring.
