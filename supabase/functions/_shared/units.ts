// Unit families for duplicate-merge compatibility — see docs/02-prs.md FR-076.
// Duplicate merging only ever combines items within the same family.
// An unrecognized unit blocks silent merging rather than guessing.

const UNIT_FAMILY: Record<string, "mass" | "volume" | "count"> = {
  g: "mass",
  kg: "mass",
  oz: "mass",
  lb: "mass",
  ml: "volume",
  l: "volume",
  cup: "volume",
  tbsp: "volume",
  tsp: "volume",
  piece: "count",
  whole: "count",
  slice: "count",
};

export function unitsCompatible(a: string | null, b: string | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  const famA = UNIT_FAMILY[a.toLowerCase()];
  const famB = UNIT_FAMILY[b.toLowerCase()];
  if (!famA || !famB) return false; // unrecognized unit → never silently merge
  return famA === famB;
}
