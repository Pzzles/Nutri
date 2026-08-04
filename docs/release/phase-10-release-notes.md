# Phase 10 release notes — anthropometric progress tracking

Status: implementation and remediation validation complete; subject to final pull-request review and merge. Not deployed.

## User-facing capability

Nutri adds guided circumference tracking for chest, WHO-midpoint waist, abdomen at the navel, maximum hips, left/right relaxed upper arm, left/right mid-thigh, and optional neck. Sessions preserve every raw centimetre reading, support centimetre or inch display, and keep waist, navel, and body sides distinct.

Users can save and resume owner-scoped drafts, record optional measurement context, finalise immutable sessions, view sparse point-based history, inspect representative provenance, export their data, and explicitly delete an entire session. Account deletion removes all anthropometry records transactionally.

## Calculation and interpretation

- New finalisations use `anthropometry_representative_v3` and `anthropometry_repeatability_thresholds_v2`.
- Two readings within 1.0 cm use their mean. Otherwise a third reading is requested and the closest pair is selected with deterministic `12`, `13`, `23` tie order.
- An isolated third reading is preserved but excluded from the representative. No agreeing pair is saved only after explicit low-confidence acknowledgement and remains interpretation-ineligible.
- `anthropometry_change_summary_v2` compares only eligible, same-site observations under compatible anatomical protocols.
- `anthropometry_weight_comparison_v2` derives weight direction only from the canonical Phase 6 weekly-rate uncertainty interval.
- Circumference never changes calorie targets, maintenance estimates, goal phases, plateau logic, or Phase 8 feedback.

Nutri does not infer fat loss, muscle gain, body-fat percentage, visceral-fat change, lean mass, or recomposition from tape measurements.

## Data, privacy, and security

Migrations `0031`–`0036` add the session/readings/representatives model, transactional APIs, representative v3, explicit child ownership, parent locking, RLS hardening, transactional account deletion, structured context, and protocol-safe interpretation. Direct authenticated mutations are revoked; authenticated reads remain owner-scoped; trusted handlers scope service-role queries with the authenticated owner.

Export version `nutri_data_export_v3` contains sessions, normalized context, raw readings, representatives, selected source IDs, warnings, eligibility, protocol/algorithm versions, and canonical centimetres. Legacy absent context is represented honestly.

## Validation summary

- backend: 425/425;
- frontend: 1012/1012;
- complete mocked Playwright: 18/18;
- complete real integration Playwright: 94/94;
- post-reset Gate 4 Playwright with trace collection: 9/9;
- Phase 6 independent Python oracle: 89/89;
- clean database resets: 2/2 through migration `0036`;
- schema drift: none;
- axe critical/serious violations in core Phase 10 states: zero.

See [`phase-10-validation-evidence.md`](../testing/phase-10-validation-evidence.md) for commands, fixtures, responsive evidence, and limitations.

## Rollback

Do not edit or remove released migrations. Roll back the application and Edge Functions together to the pre-Phase-10 release if required; leave the additive Phase 10 tables/columns in place until a reviewed forward migration handles any data disposition. Existing Phase 5–9 calculations do not consume anthropometry, so dormant Phase 10 data does not alter their outputs.

## Known limitations

- No physical screen-reader session was performed; semantic accessibility was validated with accessible-name/ARIA assertions, keyboard-only Playwright, and axe.
- Raw Playwright traces are not committed because they contain short-lived bearer tokens and synthetic email addresses. PII-free screenshots and executable test names are retained instead.
- Groq was exercised through a local OpenAI-compatible provider-boundary stub because no third-party key was available; internal Nutri authentication, APIs, Edge Functions, and persistence were not intercepted.
- Current npm advisories have no non-conflicting React Router release: v6 has two moderate client-routing advisories, while the suggested v7.18 line introduces a high-severity RSC advisory. Nutri uses static internal routes and no SSR/RSC. Dev-only Vite/Vitest/PWA advisories require separate major upgrades.
