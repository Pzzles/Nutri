We've decided to add a body-composition/adiposity layer to Nutri.

I want this implemented carefully and incrementally. Do **not** treat these values as ground-truth body composition, and do not allow them to contaminate the existing calorie, TDEE, maintenance, plateau, or goal algorithms.

---

## Phase completion protocol

This applies to every phase without exception.

When a phase is complete:

1. **Run the tests yourself** before reporting the phase done. Do not report a phase complete if tests are failing or if the relevant test suite has not been run.

2. **Hand me 2–3 tests to run myself**, chosen to cover the most important behaviour introduced in that phase. For each test provide:
   * The exact command to run it
   * What it tests
   * The expected result (pass output or specific assertion)

These should be tests a developer can run in under two minutes. Prefer the existing test runners (`vitest`, `playwright`) over manual steps where possible. Where a test requires real backend data, say so and describe the setup.

Do not hand me tests that only pass because of test doubles or mocked data unless the phase explicitly calls for unit tests in isolation.

---

## Core design principle

Nutri should distinguish between:

### Direct measurements

* Weight
* Waist circumference
* Height
* Other existing anthropometric measurements

### Calculated metrics

* Waist-to-height ratio (WHtR)
* BMI, if we choose to expose it

### Estimated body-composition metrics

* Relative Fat Mass (RFM) estimated body-fat %
* RFM-derived estimated fat mass
* RFM-derived estimated fat-free mass

Estimated fat-free mass must **never be labelled muscle mass**.

Similarly, changes in estimated fat mass / FFM must **not** be presented as proof that the user lost fat, preserved muscle, gained muscle, etc.

The UI should expose the evidence and let the user interpret it.

---

# Phase 0 — Audit the waist measurement protocol

Before implementing RFM, inspect how Nutri currently defines, stores and instructs users to measure `waist`.

This is important because the RFM equation was developed using a specific waist measurement protocol, while common waist-health protocols can use different anatomical landmarks.

Our current proposed illustration/instructions use:

> midpoint between the bottom of the ribs and the top of the hip bone, measured after a normal exhale.

Do not assume that is interchangeable with the measurement site used by the RFM development dataset.

### Tasks

1. Find every definition of `waist` in:

   * database/schema
   * TypeScript types
   * frontend labels
   * anthropometry forms
   * documentation
   * tests
   * validation rules

2. Determine whether Nutri currently specifies an anatomical measurement protocol.

3. Research/document which waist protocol the RFM equation expects.

4. Compare it to Nutri's current/proposed waist protocol.

5. Recommend one of:

   * use the same waist measurement for WHtR and RFM;
   * store a separate RFM-compatible waist measurement;
   * do not use RFM until we have a sufficiently defensible protocol.

### Important

Do not change code in Phase 0.

Give me your conclusion with evidence before proceeding.

### Phase 0 acceptance criteria

* Exact existing Nutri waist definition identified.
* Exact RFM measurement-site requirement documented.
* Any protocol mismatch clearly identified.
* Recommendation made before RFM implementation begins.

---

# Phase 1 — Measurement provenance and domain model

Assuming Phase 0 gives us a defensible path forward, establish the body-composition domain model.

Do not scatter formulas directly through React components.

Create a clear calculation/domain layer.

We need to distinguish:

```text
measured
calculated
estimated
```

Every metric returned to the UI should carry enough metadata for the frontend to know what it is.

Conceptually something like:

```ts
{
  metric: "rfm_body_fat",
  value: 27.4,
  unit: "%",
  type: "estimated",
  method: "RFM",
}
```

Do not use this exact shape if it conflicts with the existing architecture; follow the existing Nutri patterns.

### Metrics

#### Direct

* weight
* waist
* height

#### Calculated

* WHtR
* BMI

#### Estimated

* RFM body-fat %
* estimated fat mass
* estimated fat-free mass

### Acceptance criteria

* Calculations live in a reusable/testable domain/service layer.
* UI components contain no duplicated body-composition formulas.
* Estimated metrics are identifiable as estimates in the domain model.
* Existing anthropometry data remains backwards compatible.

---

# Phase 2 — WHtR

Implement Waist-to-Height Ratio first because it only requires direct measurements.

Formula:

```text
WHtR = waist / height
```

Both values must use the same unit before calculation.

### Behaviour

If either measurement is unavailable or invalid:

```text
WHtR = unavailable
```

Do not invent or interpolate missing measurements.

### Display

Show:

```text
Waist-to-height ratio
0.54
```

Include a short explanation such as:

> Waist size relative to your height. Used as an indicator of central adiposity.

If we expose categories/ranges, keep them in a centralized configuration backed by documented evidence — not arbitrary frontend conditions.

### Trend

Show WHtR over time if multiple valid waist measurements exist.

Remember:

For an adult with fixed height, the WHtR trend is essentially the waist trend normalized by height.

Do not market it as an independent body-composition measurement.

### Acceptance criteria

* Correct formula.
* Correct unit normalization.
* No calculation with missing data.
* Tests for metric/imperial values if Nutri supports both.
* Historical WHtR derives from the historical waist measurement corresponding to that date/session.

---

# Phase 3 — RFM

Only proceed if Phase 0 determined that our waist protocol is acceptable.

RFM equations:

### Male

```text
64 - (20 × height / waist)
```

### Female

```text
76 - (20 × height / waist)
```

Height and waist must use the same units.

Do not silently infer sex if it is absent.

If the user does not have the required inputs, RFM is unavailable.

### Naming

Use:

> Estimated body fat

or

> RFM estimated body fat

Do NOT use:

> Body fat

without qualification.

### Provenance

The user should be able to see that the estimate comes from:

```text
height + waist + sex
```

and uses the Relative Fat Mass equation.

### Acceptance criteria

* RFM formula has unit tests with manually checked examples.
* Missing sex/height/waist returns unavailable rather than guessing.
* UI always identifies the value as estimated.
* No RFM value is written into calorie/TDEE/maintenance logic.

---

# Phase 4 — Estimated fat mass and fat-free mass

Using the RFM estimate:

```text
estimatedFatMassKg =
    weightKg × estimatedBodyFatPercent / 100
```

```text
estimatedFatFreeMassKg =
    weightKg - estimatedFatMassKg
```

These are **derived from RFM**.

They are not independent measurements.

They should therefore be visually grouped with RFM.

Example:

```text
Estimated composition

Body fat        ~27.4%
Fat mass        ~24.1 kg
Fat-free mass   ~63.9 kg
```

With context:

> Derived from weight and the RFM body-fat estimate.

### Critical terminology

Do not call fat-free mass:

* muscle
* muscle mass
* lean muscle

FFM is not equivalent to skeletal muscle mass.

### Acceptance criteria

* Correct derivation.
* All values carry estimated status.
* Fat mass + FFM reconcile with the weight used, allowing for rounding.
* No copy claims fat loss or muscle gain based solely on these values.

---

# Phase 5 — Pair weight and anthropometry correctly

Do not arbitrarily combine distant weight and waist measurements.

The preferred state should be:

> User records weight and waist as part of the same measurement session.

Investigate whether the existing anthropometry session can include or reference weight.

Prefer an explicit relationship if the architecture allows it.

If existing data requires pairing independent records, implement a deterministic proximity rule.

For example:

1. same-calendar-day weight preferred;
2. otherwise nearest measurement within a defined maximum window;
3. outside that window, composition estimate unavailable.

Claude previously suggested ±3 days. Do not hard-code that until you assess the existing logging behaviour.

Recommend the most defensible pairing rule based on Nutri's current data model.

### UI

Tell the user when measurements were paired from different dates.

For example:

```text
Estimated using:
Waist — 21 Aug
Weight — 22 Aug
```

### Acceptance criteria

* No hidden arbitrary pairings.
* Pairing algorithm is deterministic and tested.
* Same-session data wins.
* Old measurements are not silently combined across unreasonable time gaps.

---

# Phase 6 — Measurement flow

Improve the anthropometry logging experience so measurement consistency is encouraged.

For waist:

* show an instructional illustration;
* clearly show anatomical measurement location;
* tell the user to stand relaxed;
* breathe out normally;
* keep the tape horizontal;
* keep it snug but not compressing the skin;
* use the same protocol each time.

We have/will provide our own Nutri illustrations rather than depending on third-party content.

Apply comparable guidance to existing measurements where appropriate.

Do not force the user through the tutorial every time.

Suggested interaction:

```text
Waist
[ 104.2 ] cm

How to measure >
```

Opening `How to measure` shows the illustration + short protocol.

Consider an optional:

```text
I measured under different conditions today
```

only if this fits the existing app without needless complexity.

Do not build AI interpretation around that flag.

### Acceptance criteria

* Instructions accessible from measurement entry.
* Flow remains fast for experienced users.
* Measurement protocol is consistent with whatever decision Phase 0 makes.

---

# Phase 7 — Body Composition section

Add a section under the existing Progress / Anthropometry experience.

Suggested hierarchy:

## Progress measurements

### Weight

```text
96.8 kg
−4.2 kg
```

### Waist

```text
101.5 cm
−6.4 cm
```

Then:

## Central adiposity

### Waist-to-height ratio

```text
0.58
```

Then:

## Estimated body composition

```text
RFM body fat       ~29.1%
Estimated fat mass ~28.2 kg
Estimated FFM      ~68.6 kg
```

Then, secondary/reference:

## Other reference metrics

```text
BMI
31.6
```

BMI does not need to be prominent.

If adding BMI provides no meaningful UX value, flag that before implementing it. We are not adding BMI merely because it is easy.

### Display priority

Highest confidence/prominence:

```text
Weight
Waist
```

Then:

```text
WHtR
```

Then:

```text
RFM + fat mass + FFM estimates
```

Then:

```text
BMI
```

### Acceptance criteria

* Direct measurements visually distinguished from estimated composition.
* Estimates do not look equally certain as direct measurements.
* No health diagnosis language.
* No automatic physiological story such as:

  * "You lost fat"
  * "You preserved muscle"
  * "You gained muscle"
  * "This is water weight"

---

# Phase 8 — Trends

Add trend visualisation where the existing Progress chart architecture makes sense.

Potential lines/cards:

```text
Weight
Waist
WHtR
Estimated RFM BF%
Estimated fat mass
Estimated FFM
```

But do **not** put six lines on one unreadable chart.

Reuse the existing chart design language.

Prefer separate selectable metrics or sensible grouping.

### Estimated trends

RFM/fat-mass/FFM trends must remain labelled estimated.

Do not claim that trend direction proves tissue-level change.

Example acceptable wording:

> Estimated fat mass trend

Not:

> Fat lost

### Acceptance criteria

* Estimated values remain visibly estimated on charts.
* Tooltips show value, date and measurement provenance.
* Missing composition estimates create gaps rather than fabricated/interpolated values unless the existing chart engine explicitly treats missing data appropriately.

---

# Phase 9 — Explainability

The user should be able to tap/click a metric and understand:

### What is this?

A simple explanation.

### What does Nutri use?

For example:

```text
RFM uses your height, waist circumference and sex.
```

### Is it measured?

For example:

```text
No. This is an estimate.
```

### What should I use it for?

For example:

```text
It can provide additional context when viewed alongside your weight and waist trends.
```

Keep this factual.

Do not have an LLM generate these explanations dynamically.

Use deterministic copy.

### Acceptance criteria

* Every derived/estimated metric exposes its method.
* User can distinguish observation from inference.
* No AI-generated interpretation required.

---

# Phase 10 — Safeguards

The following metrics must NOT become inputs into these existing systems unless we explicitly approve a later science review:

```text
RFM
estimated fat mass
estimated FFM
BMI
WHtR
```

Do not feed them into:

* Mifflin-St Jeor BMR
* TDEE
* maintenance estimation
* calorie targets
* deficit/surplus calculations
* expected weight-rate calculations
* plateau detection
* phase recommendations
* progress safety calculations
* future Simulator
* future Constraint Optimizer

Direct waist circumference may eventually be useful as additional longitudinal evidence, but **do not change existing algorithms in this feature**.

### Add regression tests proving this separation.

---

# Phase 11 — Testing

I want tests at several levels.

## Formula unit tests

WHtR:

* normal values
* centimetres
* inches if applicable
* divide-by-zero protection
* missing values

RFM:

* male formula
* female formula
* unit invariance
* invalid/missing sex
* missing waist
* missing height

Fat mass / FFM:

* derivation
* rounding
* reconciliation with weight

## Pairing tests

* same-day weight
* nearest weight
* multiple candidate weights
* outside allowed window
* no weight
* no waist

## UI tests

* direct vs calculated vs estimated labels
* estimated disclaimer
* missing-data states
* trend rendering
* how-to-measure guide
* BMI secondary/hidden behaviour

## Regression tests

Prove body-composition metrics do not change:

* calorie target
* maintenance
* TDEE
* BMR
* plateau status
* safety calculations

for otherwise identical users.

---

# Phase 12 — Documentation

Update the relevant architecture/science documentation.

Document:

### WHtR

* formula
* intended use
* limitations
* references

### RFM

* equation
* required inputs
* waist measurement protocol
* source paper
* known limitations
* why it is labelled an estimate

### Fat mass / FFM

* derivation
* why they inherit RFM uncertainty
* explicit statement that FFM ≠ muscle mass

### BMI

If implemented:

* population/reference role only
* not used by core algorithms

Also document the architectural rule:

> Anthropometric estimates are observational/contextual outputs and must not silently become metabolic inputs.

---

# Rollout order

Do this in small PRs, not one giant implementation.

Suggested PR sequence:

### PR 1

Phase 0 audit + documentation only

### PR 2

Domain calculation layer + WHtR

### PR 3

RFM + estimated fat mass / FFM

### PR 4

Measurement pairing / session integration

### PR 5

Measurement-guide UX + illustrations

### PR 6

Body Composition Progress UI + trends

### PR 7

Explainability, safeguards, regression tests and documentation cleanup

Follow our established Git workflow: branch from the latest master, keep the branch current with master, use appropriate conventional commit types, push, and report outstanding PRs/conflicts as required.

---

# Final acceptance criteria for the feature

The feature is complete when:

* [ ] Waist protocol has been explicitly resolved before RFM is used.
* [ ] Weight and waist remain primary direct measurements.
* [ ] WHtR is calculated correctly.
* [ ] RFM is clearly labelled an estimate.
* [ ] Estimated fat mass and FFM are derived correctly.
* [ ] FFM is never called muscle mass.
* [ ] Nutri never claims estimated changes prove fat loss or muscle gain.
* [ ] Weight/waist pairing is deterministic and transparent.
* [ ] Measurement instructions are available in-app.
* [ ] Direct, calculated and estimated values are visually distinguishable.
* [ ] Body-composition trends are available without overstating certainty.
* [ ] BMI, if added, is secondary/reference-only.
* [ ] None of the new metrics alter BMR, TDEE, maintenance, calorie targets, plateau logic or existing safety calculations.
* [ ] Formula, UI, pairing and regression tests pass.
* [ ] Scientific/architecture documentation is updated.
