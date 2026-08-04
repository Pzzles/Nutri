# Data Export and Deletion

Nutri provides users with full control over their personal data in accordance
with good data stewardship practices.

## Data export

**Endpoint**: `GET /functions/v1/export-my-data`  
**Auth**: Required (Bearer token)  
**Response**: `application/json` with `Content-Disposition: attachment`

Returns a `nutri_data_export_v3` JSON document containing the personal data
currently supported by the export contract for the authenticated user.

### Export format

```json
{
  "export_version": "nutri_data_export_v3",
  "exported_at": "2026-08-02T10:00:00.000Z",
  "user_id": "<uuid>",
  "data": {
    "profile": { ... },
    "weight_logs": [ ... ],
    "goal_phases": [ ... ],
    "calorie_target_snapshots": [ ... ],
    "meals": [ ... ],
    "meal_items": [ ... ],
    "daily_log_status": [ ... ],
    "user_foods": [ ... ],
    "user_food_cache": [ ... ],
    "goal_feedback_assessments": [ ... ],
    "anthropometric_sessions": [ ... ],
    "anthropometric_readings": [ ... ],
    "anthropometric_representatives": [ ... ]
  }
}
```

### What is included

| Collection | Description |
|---|---|
| `profile` | Birth date, sex, height, activity level, timezone |
| `weight_logs` | All weight measurements with timestamps and `is_official` flag |
| `goal_phases` | All goal phases (active, superseded, cancelled) |
| `calorie_target_snapshots` | Full calculation provenance for every calorie target |
| `meals` | All logged meals |
| `meal_items` | All individual food items within meals |
| `daily_log_status` | Daily completion status records |
| `user_foods` | Foods the user created manually |
| `user_food_cache` | User's per-food resolution preferences |
| `goal_feedback_assessments` | All goal progress assessments |
| `anthropometric_sessions` | All draft and finalised tape-measure sessions |
| `anthropometric_readings` | Every preserved raw circumference reading |
| `anthropometric_representatives` | Server-calculated representative values and quality metadata |

The three anthropometry queries are independently scoped by the authenticated
`user_id`, including child queries; session UUIDs are not treated as ownership
proof.

### What is excluded

- `global_food_cache` — shared across all users; not personal data
- Foods not owned by this user (global food database entries)
- Auth metadata (managed by Supabase Auth)

The Account page (`/account`) provides the download action.

## Account deletion

**Endpoint**: `POST /functions/v1/delete-account`  
**Auth**: Required (Bearer token)  
**Body**: `{ "confirm": "DELETE MY ACCOUNT" }`

The explicit confirmation string prevents accidental deletion. Deletion is
immediate, permanent, and cannot be undone.

### Transaction boundary

Account deletion is one database transaction, not a sequence of REST deletes.
The trusted endpoint performs one hard deletion of `auth.users`. PostgreSQL
then follows `profiles.id -> auth.users.id ON DELETE CASCADE`; every private
root row cascades from `profiles`, and child rows cascade from their private
parent. Supabase Auth and the application schema use the same PostgreSQL
transaction for this operation. A foreign-key failure rolls back the Auth row
and every application cascade together.

The endpoint returns `ACCOUNT_DELETION_COMPLETE` only after the Auth Admin
deletion succeeds. Complete means the Auth user no longer exists and the
database transaction containing every configured cascade committed. The
endpoint never reports completion after a failed Auth Admin response.

### User-owned table inventory

| Data | Ownership / parent | Delete action |
|---|---|---|
| `profiles` | `id -> auth.users.id` | Cascade |
| `user_goals`, `weight_logs`, `daily_log_status` | `user_id -> profiles.id` | Cascade |
| `goal_phases` | `user_id -> profiles.id` | Cascade |
| `calorie_target_snapshots` | `user_id -> profiles.id`; optional goal/weight links | Cascade by user; dependent links cascade or become null |
| `maintenance_estimate_snapshots`, `goal_feedback_assessments` | `user_id -> profiles.id`, `goal_phase_id -> goal_phases.id` | Cascade |
| `meals` | `user_id -> profiles.id` | Cascade |
| `meal_items`, `meal_edit_log` | `meal_id -> meals.id` | Cascade |
| `saved_meals` | `user_id -> profiles.id` | Cascade |
| `saved_meal_items` | `saved_meal_id -> saved_meals.id` | Cascade |
| User-created `foods` | `owner_user_id -> profiles.id` | Cascade |
| `user_saved_foods`, `user_food_cache`, `user_food_portions` | `user_id -> profiles.id` | Cascade |
| `ai_parse_requests`, `idempotency_keys` | `user_id -> profiles.id` | Cascade |
| `global_cache_promotion_votes`, user-created `food_synonyms` | confirming/creating user -> `profiles.id` | Cascade |
| `anthropometric_sessions` | `user_id -> profiles.id` | Cascade |
| `anthropometric_readings`, `anthropometric_representatives` | `(session_id, user_id) -> anthropometric_sessions.(id, user_id)` | Cascade |

Shared canonical foods, provider API caches, global lookup caches, system
settings, and seed synonyms are not user-owned and have no identity link to the
deleted account. No deletion-state or tombstone row remains after completion.

### Failure and retry states

| Situation | Response | Data state |
|---|---|---|
| Transaction commits | `ACCOUNT_DELETION_COMPLETE` (200) | Auth user and private rows are gone |
| Database/Auth transaction fails | `ACCOUNT_DELETION_RETRY_REQUIRED` (503) | Transaction rolled back; Auth user and private rows remain |
| Double-click while both requests are authenticated | One completes; the other may also return complete or become unauthenticated | Never a partial-data server error |
| Client loses the successful response | Retry while the token remains valid is safe | Same atomic operation; no private data is recreated |
| Request after completion | `UNAUTHENTICATED` (401) | Terminal safe state because the deleted user's token is no longer valid |

There is no separate application-data stage and therefore no resumable partial
deletion state. On a retry-required response, the user can retry with the same
confirmation while their session remains valid.

The Account page (`/account`) provides the confirmation UI. After a successful
response it clears the local session and shows the terminal confirmation view.

## Data retention

Nutri does not retain private application rows after account deletion. Database
backups are used for whole-system disaster recovery, not selective restoration
of an individual deleted account.

If a user returns after deleting an account, they start as a new user with no
private data restored from the deleted account.
