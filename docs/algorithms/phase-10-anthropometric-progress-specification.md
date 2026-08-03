# Phase 10 — Anthropometric Progress Tracking Specification

**Protocol:** `anthropometry_protocol_v1`<br>
**Representative algorithm:** `anthropometry_representative_v3` (current; this document retains the original v2 freeze below)<br>
**Repeatability thresholds:** `anthropometry_repeatability_thresholds_v2`<br>
**Longitudinal change algorithm:** `anthropometry_change_v1`<br>
**Cross-signal description:** `anthropometry_weight_comparison_v1`<br>
**Status:** Gate 1 frozen; persisted-draft lifecycle amended by Gate 2<br>
**Scope:** Gate 1 scientific specification plus Gate 2 lifecycle/schema amendment; no authenticated API or production UI changes

> The v2 median/mandatory-retake section is retained as historical design
> context. It is superseded for new finalisations by [the v3 hybrid representative protocol](phase-10-anthropometric-representative-v3.md).

## 1. Purpose and interpretation boundary

Nutri records standardised tape-measure circumferences as a progress signal alongside scale weight. It preserves every entered reading, calculates a representative value for each measured site on the server, displays observed changes without smoothing or interpolation, and may make limited descriptive comparisons with the existing Phase 6 weight trend.

Nutri reports measurements of body size. It does not directly measure fat, muscle, glycogen, fluid, digestive contents, or tissue distribution.

Allowed examples:

- “Waist circumference decreased by 3.4 cm over 8 weeks.”
- “Weight trend was broadly stable while abdomen-at-navel circumference decreased.”
- “Weight trend and waist circumference both increased over this period.”

Prohibited examples:

- “You lost 3.4 cm of fat.”
- “You gained muscle while losing fat.”
- “Your body-fat percentage decreased by 4%.”
- “You preserved all your muscle.”
- “Your visceral fat decreased.”

All user-facing interpretation must include or link to this limitation:

> Circumference changes can reflect combinations of fat, muscle, glycogen, fluid, digestion, breathing, posture, and measurement technique.

Phase 10 v1 does not calculate body-fat percentage, lean mass, muscle mass, visceral fat, waist-to-hip ratio, or any clinical risk category. It does not use circumference data to change calorie targets, observed maintenance, goal states, or Phase 8 feedback.

## 2. Scientific basis and product adaptation

The protocol uses these primary references:

- The [WHO waist and hip circumference report](https://iris.who.int/bitstream/handle/10665/44583/9789241501491_eng.pdf?sequence=1) specifies a stretch-resistant tape, the waist midpoint between the last palpable rib and iliac crest, hip measurement at the widest buttock circumference, a horizontal tape, normal expiration, and repeated measurements.
- The [WHO STEPwise surveillance manual](https://www.who.int/docs/default-source/ncds/ncd-surveillance/steps/steps-manual.pdf?sfvrsn=c281673d_5) provides the same waist landmark and standing technique.
- The [NHANES 2021 Anthropometry Procedures Manual](https://wwwn.cdc.gov/nchs/data/nhanes/2021-2023/manuals/2021-Anthropometry-Procedures-Manual-508.pdf) documents trained-examiner waist, hip, and mid-upper-arm measurements and reinforces explicit landmarks and standard positioning.
- The [ISAK accreditation scheme](https://www.isak.global/FormationSystem/AccreditationScheme) treats standardisation and technical error of measurement as core anthropometry competencies.

Nutri is a self-measurement product, not a trained-examiner survey. `anthropometry_protocol_v1` therefore asks for a third reading when the first two differ by more than 1.0 cm. Under the v2 representative rule, the median is used only when at least one pair among the three agrees within 1.0 cm. If no pair agrees, the site is marked low confidence, finalisation is blocked, and the user is asked neutrally to retake that site only.

## 3. Frozen site dictionary and landmarks

Site codes are stable API and database identifiers. Labels may be translated, but a code’s anatomical meaning must not change without a protocol-version bump.

| Order | Site code | Required label | Frozen landmark and position |
|---:|---|---|---|
| 1 | `chest` | Chest | Tape horizontal around the thorax at the mid-sternal level: the midpoint between the suprasternal notch and the lower end of the sternum. Arms relaxed at the sides; measure at the end of a normal expiration. The tape follows the body contour without compressing tissue. |
| 2 | `waist` | Waist (WHO midpoint) | Midpoint on each side between the lower margin of the last palpable rib and the top of the iliac crest in the mid-axillary line. Tape horizontal; feet close together, weight evenly distributed, arms relaxed; measure at the end of a normal expiration. |
| 3 | `abdomen_navel` | Abdomen at navel | Tape centred through the middle of the umbilicus and horizontal around the torso. Stand normally with abdomen relaxed; measure at the end of a normal expiration. This is a personal-progress site, not the WHO waist site. |
| 4 | `hips` | Hips | Maximum circumference over the buttocks, checked from the side so the tape is horizontal. Feet close together, weight evenly distributed, arms clear of the tape; no tissue compression. |
| 5 | `left_upper_arm_relaxed` | Left relaxed upper arm | Left arm midpoint between the lateral tip of the acromion and the tip of the olecranon. Arm hangs loose at the side, palm facing the thigh; tape perpendicular to the long axis of the arm. |
| 6 | `right_upper_arm_relaxed` | Right relaxed upper arm | Right arm, using the same acromion-to-olecranon midpoint and relaxed position as the left. |
| 7 | `left_mid_thigh` | Left mid-thigh | Left anterior midpoint between the inguinal crease and the proximal border of the patella. Stand upright with weight evenly distributed and thigh muscles relaxed; tape horizontal and perpendicular to the long axis of the thigh. |
| 8 | `right_mid_thigh` | Right mid-thigh | Right leg, using the same inguinal-crease-to-patella midpoint and relaxed position as the left. |
| 9 | `neck` | Neck (optional) | Immediately below the laryngeal prominence, with the tape perpendicular to the long axis of the neck. Head neutral, eyes forward, shoulders relaxed; tape snug without compression. |

`waist` and `abdomen_navel` are never aliases. They are stored, calculated, charted, compared, exported, and described independently. No abdomen-at-navel value may be substituted for a missing waist value. Phase 10 v1 displays no waist-risk thresholds; if a later version adds them, only measurements made with the frozen `waist` protocol may be eligible.

Left and right sites are also independent. They are never averaged into an unlabelled “arm” or “thigh” value, and one side never fills a missing value for the other.

## 4. Standardised session procedure

### 4.1 Preparation

1. Use the same stretch-resistant tape when practical, marked in centimetres with at least 1 mm divisions.
2. Measure directly on skin or over thin, close-fitting clothing. Record a note if conditions differ from usual; do not mathematically correct for clothing.
3. Prefer a similar time of day and similar pre-measurement conditions across sessions. These are consistency recommendations, not validity gates.
4. Stand upright without deliberately pulling in the abdomen, expanding the chest, flexing muscles, or changing normal posture.
5. Mark limb midpoints with a skin-safe marker if helpful. Re-identify the landmark every session rather than relying on an old mark.
6. The tape must be flat, untwisted, snug, and not tight enough to indent or compress tissue.

### 4.2 Reading order

The app presents sites in the frozen order in section 3. A session may contain any non-empty subset; missing sites remain absent and are not errors. `neck` is hidden or off by default and can be enabled explicitly.

Take readings in circuits to reduce immediate recall of the prior number:

1. First circuit: take reading 1 for every selected site.
2. Second circuit: return to the start and take reading 2 for every selected site.
3. Resolution circuit: take reading 3 only for sites whose first two readings differ by more than 1.0 cm.

The session must contain at least one site before finalisation. A user may skip any site for privacy, accessibility, injury, pregnancy, equipment, or preference. Nutri does not invent a reason and does not turn an omission into zero.

### 4.3 Precision and breathing

- Record centimetres to one decimal place (`0.1 cm`).
- Chest, waist, and abdomen-at-navel are read at the end of a normal, unforced expiration after normal breathing.
- Do not ask the user to hold a maximal inhalation or exhalation.
- Hips, arm, thigh, and neck are recorded while relaxed and breathing normally.

## 5. Repeated-reading algorithm

All arithmetic uses integer tenths of a centimetre to avoid floating-point tie ambiguity.

For each site:

```text
d12 = abs(reading_2_tenths - reading_1_tenths)

if d12 <= 10:
    require exactly 2 readings
    representative = arithmetic mean(reading_1, reading_2)
    method = mean_of_two
    quality = within_repeatability_threshold

if d12 > 10:
    require exactly 3 readings
    if min(d12, d13, d23) <= 10:
        representative = median(reading_1, reading_2, reading_3)
        method = median_of_three
        quality = repeatability_warning
    else:
        do not calculate a representative
        block finalisation with RETAKE_SITE_REQUIRED
        request a fresh set for this site only
```

The threshold comparison is exact: a difference of `1.0 cm` passes; `1.1 cm` requires a third reading. A third reading is rejected when the first pair passes, preventing discretionary selection of a preferred result. A failed set is not extended with a fourth reading: its raw draft values remain stored until the user starts a fresh set for that site.

The representative of a passing pair can fall on `0.05 cm`. It is stored exactly to two decimal places. The median of three is one of the raw `0.1 cm` readings. Raw readings are never rounded again or overwritten.

Display values and displayed changes use one decimal place with decimal half-up rounding. Calculation and API values retain two decimal places.

`repeatability_warning` does not discard the site. The numeric value remains visible, but that endpoint is ineligible for a generated cross-signal sentence. The UI explains that the readings differed and that technique may have contributed.

## 6. Validation thresholds

`anthropometry_repeatability_thresholds_v2` freezes these product rules:

| Rule | Value |
|---|---:|
| Input precision | 0.1 cm |
| Minimum accepted raw reading | 5.0 cm |
| Maximum accepted raw reading | 300.0 cm |
| Passing first-pair difference | ≤ 1.0 cm |
| Readings when first pair passes | exactly 2 |
| Readings when first pair fails | exactly 3 |
| Passing three-reading set | at least one pair differs by ≤ 1.0 cm |
| Three-reading set with no passing pair | block finalisation and retake that site |
| Sites required to finalise | at least 1 |
| Future timestamp tolerance | 5 minutes beyond server clock |

The range check is a corruption/input-error guard, not a claim about biologically normal values. Nutri does not flag “implausible change” using body-composition assumptions in v1.

## 7. Session lifecycle and authority

Gate 2 amends the Gate 1 lifecycle to support persisted drafts. This is a versioned data-contract change (`anthropometry_data_contract_v2`); it does not change the anatomical protocol or representative algorithm.

A user may create a draft session and add, replace, or remove its raw readings. Drafts have no representatives and are excluded from progress history. Draft ownership cannot change. A draft may be deleted by its owner.

Finalisation sends the complete draft to a server-authoritative operation. In one transaction the server:

1. authenticates the user;
2. validates site codes, raw values, reading counts, timestamp, and protocol version;
3. derives the user-local calendar date from `profiles.timezone` (default `Africa/Johannesburg`);
4. calculates every representative and quality field;
5. changes the draft session to finalised and freezes its calculation versions;
6. inserts the calculated representatives against that finalised parent.

If any step fails, nothing is stored. Clients cannot supply representatives, changes, quality classifications, or cross-signal text.

Finalised sessions, readings, and representatives cannot be updated or reopened. A correction is a new session with an optional note referencing the mistake; the old raw record remains unless the user explicitly invokes the authenticated deletion operation introduced in Prompt 3. Whole-account deletion removes the data by cascade, and data export includes all three record types.

Idempotency is required. Repeating the same finalisation request with the same user-scoped idempotency key returns the original finalised session; reusing the key with a different payload returns `IDEMPOTENCY_CONFLICT`.

## 8. Longitudinal change algorithm

`anthropometry_change_v1` operates separately for every site.

- Sort finalised representatives by `measured_at`, then `session_id` as a deterministic tie-breaker.
- A point exists only on the recorded session timestamp and local date.
- Do not create missing dates, forward-fill values, interpolate endpoints, or add a smoothing line.
- `change_cm = end.representative_cm - start.representative_cm` using the stored two-decimal representatives.
- `elapsed_days = (end.measured_at - start.measured_at) / 86,400,000` and is returned as a fractional number; user copy may show an appropriate whole-day or whole-week duration without changing the endpoints.
- “Previous change” compares the latest point with the immediately preceding available point for that same site, even if other sessions between them omitted the site.
- “Since first” compares the latest point with the earliest available point for that same site in the requested range.
- A user-selected comparison must reference two actual points for the same site. Reversing the selection reverses the sign.
- One point yields `change: null`. A missing site yields no series member, not a zero-valued point.

Numeric change is always reportable when two points exist. Direction words used in generated summaries apply the `1.0 cm` circumference materiality threshold in section 9; this threshold does not hide smaller numeric changes.

## 9. Phase 6 cross-signal description

`anthropometry_weight_comparison_v1` can generate at most one descriptive sentence for `waist`, or if waist lacks eligible endpoints, `abdomen_navel`. Other sites retain numeric histories but do not generate body-composition narratives in v1.

### 9.1 Eligibility

All conditions must pass:

1. The selected circumference site has two finalised points at least 14 elapsed days apart.
2. Neither circumference endpoint has `repeatability_warning`.
3. The Phase 6 result has status `provisional` or `usable`, confidence `medium` or `high`, and at least two returned trend points.
4. Each circumference endpoint can be aligned to an observed Phase 6 trend point within 7 elapsed days.
5. The aligned weight points are distinct and ordered.

For each circumference endpoint, choose the Phase 6 trend point with the smallest absolute timestamp difference. On an exact tie, choose the earlier trend point. The timestamp and value of the chosen point are returned. No weight date or value is interpolated.

### 9.2 Versioned descriptive thresholds

```text
circumference_delta = end_circumference - start_circumference
weight_delta        = end_trend_weight - start_trend_weight
weight_stable_band  = max(0.5 kg, start_trend_weight * 0.005)
```

| Signal | Decreased | Broadly stable | Increased |
|---|---|---|---|
| Circumference | delta ≤ −1.0 cm | −1.0 cm < delta < 1.0 cm | delta ≥ 1.0 cm |
| Weight trend | delta < −stable band | −stable band ≤ delta ≤ stable band | delta > stable band |

The `0.5 kg / 0.5%` weight band and `1.0 cm` circumference band are product description thresholds, not diagnostic or biological cut-offs.

### 9.3 Permitted templates

- `Weight trend was broadly stable while {site label} circumference decreased.`
- `Weight trend was broadly stable while {site label} circumference increased.`
- `Weight trend and {site label} circumference both decreased over this period.`
- `Weight trend and {site label} circumference both increased over this period.`
- `Weight trend decreased while {site label} circumference increased.`
- `Weight trend increased while {site label} circumference decreased.`

When either circumference or weight is inside its broadly stable band and no listed template applies, show the two numeric changes without a generated cross-signal sentence. Never append causal language such as “therefore,” “suggesting fat loss,” or “indicating muscle gain.”

The comparison is display-only. It is not an input to Phase 5 calorie calculations, Phase 6 weight modelling, Phase 7 observed maintenance, or Phase 8 goal feedback.

## 10. Repository audit and integration boundaries

Audit baseline: `origin/master` at `daadeeb` on 2026-08-02.

| Existing area | Finding | Phase 10 constraint |
|---|---|---|
| Progress UI | `web/src/pages/Progress.tsx` owns four state-based tabs: Goals, Weight, Maintenance, Feedback. Weight content is `WeightLogPage`. | A later prompt may add a Measurements tab/page; Prompt 1 changes no production UI. Existing tabs and their behavior remain intact. |
| Weight storage | `weight_logs` preserves same-day rows but atomically marks the latest local-day row official through `fn_log_weight`. | Anthropometry uses session-level repeated readings, not `weight_logs` and not an `is_official` demotion model. Multiple finalised sessions on one date remain valid. |
| Phase 6 calculation | `get-weight-trend` loads all weight rows, uses the profile timezone, calls the shared server calculation, and returns versioned representatives, EWMA points, Theil-Sen rate, quality, and warnings. | Weight calculation remains unchanged. Phase 10 may read its output for an eligible descriptive comparison but cannot rewrite or reinterpret it. |
| API conventions | Edge functions use `{ success, data, error }`, authenticated user lookup, server/service data access, and server time. | New endpoints must use the same envelope and server-authoritative calculation pattern. |
| Immutable records | Calorie snapshots and saved goal-feedback assessments establish write-once, versioned, provenance-rich patterns. | Finalised sessions follow the same write-once pattern, with raw readings normalised into child rows. |
| Phase 8 feedback | Goal assessment consumes Phase 6/7 evidence and can offer advisory adjustments, but does not automatically mutate goals. | Tape measurements do not enter the assessment input, alter states, or unlock/modify adjustments in v1. |
| Privacy lifecycle | `export-my-data` enumerates user tables; `delete-account` deletes in dependency order before the auth user. | Implementation must extend export format/version deliberately and include session/readings/representatives; account deletion must remove them by cascade or explicit dependency order. |
| Generated types/tests | Frontend has generated database types; backend integration tests use the real local Supabase stack; mocking is prohibited. | Later schema work regenerates types. API/integration tests must exercise the real backend. Pure deterministic algorithm unit tests may call pure functions without mocking network/database behavior. |

No existing schema can safely represent repeated circumference readings without conflating sites or discarding raw data. Phase 10 therefore requires dedicated session, reading, and representative records in a later prompt.

## 11. Gate 1 acceptance checklist

- [x] Stable site codes, labels, landmarks, side handling, and waist/navel separation are frozen.
- [x] Preparation, reading order, breathing, precision, repeat rule, threshold boundary, and representative algorithm are frozen.
- [x] Missingness, irregular cadence, immutable finalisation, server authority, idempotency, and correction behavior are frozen.
- [x] Longitudinal endpoint selection and no-interpolation/no-smoothing rules are frozen.
- [x] Cross-signal eligibility, alignment, thresholds, templates, and inference limits are frozen and versioned.
- [x] Existing Progress, weight, goal feedback, API, privacy, and testing integration points are audited.
- [x] Deterministic fixtures exist in `docs/testing/phase-10-anthropometry-fixtures.json`.
- [x] No database migration or production UI code is included in Gate 1.

**GATE 1: ANTHROPOMETRY SPECIFICATION FROZEN**
