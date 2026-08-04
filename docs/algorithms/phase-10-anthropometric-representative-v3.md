# Phase 10 Remediation Gate 1 — Hybrid Representative v3

**Data contract:** `anthropometry_data_contract_v3`<br>
**Representative:** `anthropometry_representative_v3`<br>
**Protocol:** `anthropometry_protocol_v1`<br>
**Repeatability thresholds:** `anthropometry_repeatability_thresholds_v2`

The anatomical protocol and the 1.0 cm product repeatability threshold are
unchanged. This remediation replaces v2's median/mandatory-retake behavior for
new finalisations only. Historical v1/v2 rows are not recalculated.

## Authoritative calculation

One reading returns `SECOND_READING_REQUIRED`. Two readings at most 1.0 cm
apart use their mean and `pair_agree`; a wider pair returns
`THIRD_READING_REQUIRED`.

For three readings the server calculates `d12`, `d13`, and `d23`, then chooses
the smallest spread. Exact ties resolve in `(1,2)`, `(1,3)`, `(2,3)` order. The
representative is the selected pair's mean. All raw readings remain stored.

When the chosen pair is within 1.0 cm and the remaining reading is more than
1.0 cm from both members, quality is
`pair_agree_with_isolated_reading`, warning
`isolated_reading_excluded`, and the result remains interpretation-eligible.
Retaking is optional.

When the closest spread exceeds 1.0 cm, quality is `high_variability`, warning
`no_pair_within_repeatability_threshold`, and interpretation eligibility is
false. Finalisation returns `HIGH_VARIABILITY_CONFIRMATION_REQUIRED` unless the
request explicitly acknowledges that server-calculated metric. An accepted
acknowledgement stores its server timestamp and
`anthropometry_high_variability_ack_v1` provenance.

## Persisted v3 provenance

Migration `0034_anthropometry_hybrid_representative_v3.sql` adds:

- exactly two `source_reading_ids` and matching `selected_reading_indices`;
- `unselected_reading_id` for three-reading results;
- `selected_pair_spread_cm` and all `pairwise_differences`;
- `warning_codes`, `eligible_for_interpretation`, and the algorithm version;
- `quality_acknowledged_at` and `quality_acknowledgement_version`.

Database validation re-derives the closest pair from same-session, same-site
raw readings and rejects contradictory provenance or quality. New provenance
columns remain null on legacy v1/v2 rows because their source selection cannot
be reconstructed safely.

## Frozen fixtures

| Fixture | Readings (cm) | Selected | Representative | Quality | Eligible |
|---|---|---|---:|---|---:|
| A | 82.0, 82.4 | 1, 2 | 82.2 | `pair_agree` | yes |
| B | 82.0, 84.0, 82.3 | 1, 3 | 82.15 | `pair_agree_with_isolated_reading` | yes |
| C | 80.0, 80.2, 50.0 | 1, 2 | 80.1 | `pair_agree_with_isolated_reading` | yes |
| D | 80.0, 81.0, 82.0 | 1, 2 | 80.5 | `pair_agree` | yes |
| E | 80.0, 82.0, 84.5 | 1, 2 | 81.0 | `high_variability` | no |
| F | 90.0, 90.0, 90.0 | 1, 2 | 90.0 | `pair_agree` | yes |

The engine also freezes rejection of non-finite, zero, negative,
out-of-contract, and over-precision inputs, and guarantees that input arrays,
objects, IDs, and reading order are not mutated.

## Interpretation and export

Every recorded representative remains visible in history. Expanded history and
authenticated export expose raw readings and calculation provenance.
`high_variability` points are excluded from automatic circumference/weight
interpretation but do not alter Phase 6–8 algorithms, calorie targets, or goal
phases.
