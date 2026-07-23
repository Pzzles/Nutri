// Pure food-form ambiguity detection for the Food Resolution Engine.
// No Supabase, Deno or network dependencies — safe to import in any test runner.
// Extracted from resolve-foods/index.ts so tests exercise the real production code.

// When top candidates' calorie densities span more than this ratio, the food name
// is ambiguous (e.g. "oatmeal" could be cooked ≈ 71 kcal/100 g or dry ≈ 380 kcal/100 g).
export const FOOD_FORM_RATIO_THRESHOLD = 3.0;

export interface AmbiguityCandidate {
  calories100g: number;
}

/**
 * Detect whether a set of food search candidates represents food-form ambiguity.
 *
 * Returns true when the top-3 non-zero-calorie non-duplicate candidates' calorie
 * densities span more than FOOD_FORM_RATIO_THRESHOLD, indicating materially different
 * food preparations (e.g. dry oats vs cooked oatmeal).
 *
 * Known limitation: this is calorie-density comparison only. It cannot determine
 * whether two candidates are genuine preparation variants or merely unrelated search
 * results — that distinction requires semantic understanding of the food names, which
 * is not available here. The caller should ensure candidates are relevance-ranked
 * before calling this function.
 */
export function detectFoodFormAmbiguity(candidates: AmbiguityCandidate[]): boolean {
  const deduped = deduplicateCandidates(candidates);
  const top = deduped.slice(0, 3).filter((c) => c.calories100g > 0);
  if (top.length < 2) return false;
  const calValues = top.map((c) => c.calories100g);
  const maxCal = Math.max(...calValues);
  const minCal = Math.min(...calValues);
  return maxCal / minCal > FOOD_FORM_RATIO_THRESHOLD;
}

/**
 * Remove candidates with duplicate calorie values (within 1 kcal).
 * A duplicate likely represents the same food from different data sources.
 * Preserves the first occurrence and insertion order.
 */
export function deduplicateCandidates<T extends AmbiguityCandidate>(candidates: T[]): T[] {
  const seen = new Set<number>();
  return candidates.filter((c) => {
    const key = Math.round(c.calories100g);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
