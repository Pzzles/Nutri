export type ItemConfidence = "high" | "medium" | "low";

export interface ParsedFoodItem {
  raw_phrase: string;
  normalized_name: string;
  quantity: number | null;
  unit: string | null;
  confidence_hint: ItemConfidence;
  ambiguous: boolean;
}

export interface ResolvedFoodItem {
  raw_phrase: string;
  normalized_query: string;
  food_id: string | null;
  quantity: number | null;
  unit: string | null;
  match_confidence: "exact" | "partial" | "none";
  portion_confidence: "exact" | "estimated" | "assumed_default";
  item_confidence: ItemConfidence;
}

export interface CalculatedItem extends ResolvedFoodItem {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fibre_g: number | null;
  nutrition_source: string;
  portion_g: number;
  portion_source: "explicit" | "history" | "default";
  history_use_count: number | null;
}

export interface MealTotals {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fibre_g: number;
}

export interface FoodSearchResult {
  id: string;
  name: string;
  brand: string | null;
  serving_size_g: number | null;
  source: string;
  calories_100g: number;
  protein_100g: number;
  carbs_100g: number;
  fat_100g: number;
  fibre_100g: number | null;
  match_type: "exact" | "fuzzy";
  similarity?: number;
}

// Options returned when resolve-foods detects food-form ambiguity.
export interface FoodFormOption {
  food_id: string;
  name: string;
  calories_100g: number;
  serving_size_g: number | null;
}

// Structured clarification returned by calculate-meal for portion problems.
export interface PortionClarificationResult {
  raw_phrase: string;
  // food_id is included so the UI can pass it back as extreme_confirmed_ids
  // when the user confirms an EXTREME_PORTION.
  food_id: string;
  code: "UNSUPPORTED_PORTION_UNIT" | "EXTREME_PORTION" | "LIKELY_UNIT_ERROR" | "MISSING_SERVING_SIZE";
  raw_unit: string | null;
  message: string;
  suggested_unit?: string;
  suggested_qty?: number;
}

// Union of all clarification shapes the UI must handle.
export type ClarificationItem =
  | { raw_phrase: string; reason: "ambiguous" | "no_food_match" }
  | { raw_phrase: string; reason: "food_form_ambiguous"; options: FoodFormOption[] }
  | {
      raw_phrase: string;
      reason: "portion_clarification";
      food_id: string;
      code: string;
      message: string;
      suggested_unit?: string;
      suggested_qty?: number;
    };
