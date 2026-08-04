# Body measurement data contract

Current write contract: `anthropometry_data_contract_v4`.

`anthropometric_sessions` owns immutable finalised sessions. `anthropometric_readings` preserves ordered raw centimetre readings and `anthropometric_representatives` preserves the server-authoritative representative plus provenance. Child ownership is explicit and constrained to the parent owner.

## Structured context

New sessions store:

| Column | Values |
|---|---|
| `local_time` | server-derived `HH:mm:ss` from `measured_at` and the frozen profile timezone |
| `measurement_context_version` | `anthropometry_measurement_context_v1` |
| `meal_timing` | `before_food`, `after_food`, `not_recorded` |
| `after_bathroom` | boolean or null |
| `exercise_within_previous_12_hours` | boolean or null |
| `measurement_assistance` | `self`, `assisted`, `not_recorded` |
| `clothing_level` | `minimal`, `light`, `normal`, `other`, `not_recorded` |
| `notes` | optional, trimmed, maximum 500 characters |

Legacy rows retain null database columns. Read and export contracts normalize their enums to `not_recorded`, booleans to null, version to null, and local time to null. No history is fabricated.

Migration `0036_anthropometry_context_and_interpretation_v2.sql` is forward-only. It preserves v2/v3 data-contract rows and representative v1/v2/v3 rows. The API accepts only protocol v1 for new writes; the database can retain syntactically valid unknown protocols so compatibility logic can safely default them to incompatible.

Finalised sessions remain immutable. RLS is owner-scoped and direct authenticated insert/update/delete remains revoked. The service-only save RPC writes session, raw readings, context, representatives, and idempotency evidence in one transaction.
