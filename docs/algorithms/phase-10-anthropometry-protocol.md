# Phase 10 anthropometry protocol and interpretation

Status: Remediation Gates 1–3 implemented; Gate 4 pending.

## Frozen versions

| Concern | Version |
|---|---|
| Measurement context | `anthropometry_measurement_context_v1` |
| Context comparison | `anthropometry_context_comparison_v1` |
| Change summary | `anthropometry_change_summary_v2` |
| Protocol compatibility | `anthropometry_protocol_compatibility_v1` |
| Weight comparison | `anthropometry_weight_comparison_v2` |

Representative calculation remains `anthropometry_representative_v3` with
`anthropometry_repeatability_thresholds_v2`. Gate 3 does not change raw readings or representatives.

## Protocol compatibility

Compatibility v1 recognises only `anthropometry_protocol_v1` compared with itself. Unknown, legacy, or future strings are retained in history but are incompatible by default. Representative v2 and v3 results may be compared when their protocol and site match and both values are interpretation-eligible.

## Change summary v2

For each site, the server orders actual finalised points by `measured_at`, then session ID. It selects the latest eligible point, nearest prior compatible eligible point, and earliest compatible eligible baseline. It returns values, deltas, calendar-day spans, quality, protocol, representative algorithm provenance, and context warnings. It never inserts dates or values.

Direction uses the unrounded circumference delta: at most −0.5 cm is `decreasing`, at least +0.5 cm is `increasing`, and values between are `broadly_stable`.

## Context comparison v1

Recorded differences generate cautions for meal timing, bathroom state, exercise within 12 hours, assistance, clothing, and local times more than four hours apart. Missing context creates no difference warning. Warnings do not invalidate measurements, alter representatives, or block a numeric change.

## Phase 6 comparison v2

The comparison is calculated as of the latest eligible anthropometry session. Only weight logs at or before that timestamp enter the canonical Phase 6 `calculate()` pipeline. Direction comes only from the Phase 6 weekly-rate uncertainty interval:

- upper bound below zero: `decreasing`;
- lower bound above zero: `increasing`;
- interval includes zero: `broadly_stable_or_uncertain`;
- either bound missing: `unavailable`.

Eligibility also requires a compatible central-site comparison at least 14 calendar days long, eligible representatives, Phase 6 `usable` or `provisional` status, medium/high confidence, a non-stale interval, and a latest weight no more than seven calendar days from the anthropometry session. The response includes rate, bounds, status, confidence, selected window, as-of time, latest weight time, evidence periods, eligibility, and stable reason codes.

Descriptions are observational. Nutri never translates circumference change into fat, muscle, visceral fat, body-fat percentage, or recomposition claims. Anthropometry does not alter calorie targets, maintenance estimates, or goal feedback.
