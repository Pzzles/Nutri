// Pure body-composition domain layer.
// Phases 1–2: WHtR. Phases 3–4: RFM, fat mass, fat-free mass (reserved).
//
// Measurement-protocol note (Phase 0 decision):
//   WHtR — uses Nutri's WHO mid-axillary midpoint waist. No protocol mismatch.
//   RFM  — equation developed on NHANES iliac-crest waist data, which is a
//           different landmark from Nutri's WHO midpoint waist. RFM values
//           will carry this limitation in their provenance field. See
//           docs/body-composition-feature.md.
//
// References:
//   WHO waist/hip report; WHO STEPwise manual — WHO midpoint landmark.
//   Woolcott OO, Bergman RN. Sci Rep. 2018;8(1):10980 — RFM source paper.

export type BodyCompositionProvenance = "measured" | "calculated" | "estimated";

export interface BodyCompositionMetric {
  value: number | null;
  provenance: BodyCompositionProvenance;
  method: string;
  inputs: readonly string[];
  unavailable_reason?: string;
}

// WHtR = waist_cm / height_cm.
// Both values must be in the same unit (Nutri stores all measurements in cm).
// Returns null value — never fabricates or interpolates missing measurements.
export function calculateWHtR(
  waist_cm: number | null | undefined,
  height_cm: number | null | undefined,
): BodyCompositionMetric {
  const INPUTS = ["waist_cm", "height_cm"] as const;
  if (waist_cm == null) {
    return { value: null, provenance: "calculated", method: "WHtR", inputs: INPUTS, unavailable_reason: "waist_missing" };
  }
  if (height_cm == null) {
    return { value: null, provenance: "calculated", method: "WHtR", inputs: INPUTS, unavailable_reason: "height_missing" };
  }
  if (waist_cm <= 0 || height_cm <= 0) {
    return { value: null, provenance: "calculated", method: "WHtR", inputs: INPUTS, unavailable_reason: "invalid_measurement" };
  }
  return {
    value: Math.round((waist_cm / height_cm) * 1000) / 1000,
    provenance: "calculated",
    method: "WHtR",
    inputs: INPUTS,
  };
}
