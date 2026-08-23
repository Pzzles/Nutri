// Frontend mirror of supabase/functions/_shared/bodyComposition.ts
// Pure functions — no I/O, no side effects.

export type BodyCompositionProvenance = "measured" | "calculated" | "estimated";

export interface BodyCompositionMetric {
  value: number | null;
  provenance: BodyCompositionProvenance;
  method: string;
  inputs: readonly string[];
  unavailable_reason?: string;
}

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
