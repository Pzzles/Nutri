# Body measurement API contract

All endpoints require an authenticated user. Envelopes use `{ success, data, error }`.

## Save and finalise

`POST save-anthropometric-session` accepts `draft` or `finalized`. `POST finalize-anthropometric-session` forces finalisation. The optional `measurement_context` object accepts only the five client fields defined in the data contract. Omitted enum fields become `not_recorded`; omitted booleans remain null.

Wrong types, unknown enums, and extra context keys are validation errors. Clients cannot supply `user_id`, `logged_date`, `timezone`, `local_time`, context version, representative fields, quality, weight evidence, or other calculated provenance. Finalisation requires an idempotency key; context is part of its canonical payload hash.

## History

`GET get-anthropometric-sessions` returns finalised sessions newest-first using the `(measured_at, id)` cursor. Limit is 1–100. Each row includes structured context, notes, readings, representative provenance, and stored versions. A real 1,005-session fixture proves bounded pages, stable ordering, no duplicates/skips, and correct child association.

## Progress

`GET get-anthropometric-progress` returns chronological site series, structured context without notes, `anthropometry_change_summary_v2`, protocol/context warnings, and optional `anthropometry_weight_comparison_v2`. Query parameters are `from`, `to`, `site_code`, and `include_weight_comparison`. The public API does not accept an arbitrary Phase 6 as-of timestamp.

Weight evidence includes `weekly_rate_kg`, `lower_kg`, `upper_kg`, direction, Phase 6 status/confidence, selected window, server-selected `as_of`, latest weight timestamp, Phase 6 window, eligibility, stable reason codes, a stable `message_code`, and evidence period. Eligible message codes use `{site}_{circumference_direction}_weight_{weight_direction}`; ineligible responses return null. The frontend displays server results and performs no science calculation.

## Export and deletion

`GET export-my-data` returns `nutri_data_export_v3`, normalized structured context, raw records, representative provenance, and Gate 3 algorithm versions. `POST delete-account` remains the transactional erasure boundary; all anthropometry rows cascade and retry/idempotency behavior remains covered by Gate 2 tests.
