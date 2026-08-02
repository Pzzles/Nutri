# Data Export and Deletion

Nutri provides users with full control over their personal data in accordance
with good data stewardship practices.

---

## Data export

**Endpoint**: `GET /functions/v1/export-my-data`  
**Auth**: Required (Bearer token)  
**Response**: `application/json` with `Content-Disposition: attachment`

Returns a `nutri_data_export_v2` JSON document containing all personal data
stored for the authenticated user.

### Export format

```json
{
  "export_version": "nutri_data_export_v2",
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
|-----------|-------------|
| `profile` | Birth date, sex, height, activity level, timezone |
| `weight_logs` | All weight measurements with timestamps and is_official flag |
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

### What is excluded

- `global_food_cache` — shared across all users; not personal data
- Foods not owned by this user (global food database entries)
- Auth metadata (managed by Supabase Auth)

### Frontend usage

The Account page (`/account`) has a "Download my data" button that calls this
endpoint and triggers a browser file download.

---

## Account deletion

**Endpoint**: `POST /functions/v1/delete-account`  
**Auth**: Required (Bearer token)  
**Body**: `{ "confirm": "DELETE MY ACCOUNT" }`

Permanently and irreversibly deletes:
1. All rows in all tables associated with the user's ID (in FK-safe order)
2. The Supabase Auth user account

The explicit confirmation string (`DELETE MY ACCOUNT`) prevents accidental deletion.
No email is sent. Deletion is immediate and cannot be undone.

### Deletion order

```
goal_feedback_assessments
calorie_target_snapshots
goal_phases
meals (cascades → meal_items)
daily_log_status
weight_logs
user_food_cache
foods (user-owned only)
profiles
  └─ anthropometric_sessions
       ├─ anthropometric_readings
       └─ anthropometric_representatives
auth.users
```

### Frontend usage

The Account page (`/account`) has a "Delete my account" button that shows
a confirmation input. The user must type `DELETE MY ACCOUNT` exactly before
the deletion button becomes active. After deletion, the user is signed out
and shown a confirmation message.

---

## Data retention

Nutri does not retain user data after account deletion. There are no backups
that selectively restore deleted accounts — database backups are for disaster
recovery of the entire database, not per-user restoration.

If a user deletes their account and wants to return, they start fresh as a
new user with no data.
