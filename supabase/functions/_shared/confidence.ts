import { ItemConfidence, MatchConfidence, PortionConfidence } from "./types.ts";

// Exhaustive mapping — see docs/02-prs.md FR-020. This table is the single
// place item_confidence is decided anywhere in the system. If a combination
// isn't in this table, that's a bug upstream (an unmapped enum value), and
// this throws rather than silently guessing.
const TABLE: Record<MatchConfidence, Record<PortionConfidence, ItemConfidence>> = {
  exact: { exact: "high", estimated: "medium", assumed_default: "low" },
  partial: { exact: "medium", estimated: "low", assumed_default: "low" },
  none: { exact: "low", estimated: "low", assumed_default: "low" },
};

export function computeItemConfidence(
  match: MatchConfidence,
  portion: PortionConfidence,
): ItemConfidence {
  const row = TABLE[match];
  if (!row) throw new Error(`Unmapped match_confidence: ${match}`);
  const result = row[portion];
  if (!result) throw new Error(`Unmapped portion_confidence: ${portion} for match ${match}`);
  return result;
}

// Meal confidence = strict minimum of all item confidences. Deterministic —
// this is the resolution of an earlier ambiguity in the domain model (see
// docs/decisions/ADR-013 and the "A1" finding in the PRS audit). One low
// item always makes the whole meal low; there is no other possible outcome.
export function computeMealConfidence(items: ItemConfidence[]): ItemConfidence {
  if (items.length === 0) return "low";
  if (items.some((c) => c === "low")) return "low";
  if (items.some((c) => c === "medium")) return "medium";
  return "high";
}
