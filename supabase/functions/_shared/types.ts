// Shared types across Edge Functions.
// ParsedFoodItem is the frozen `FoodParserAdapter` output shape (ADR-003) —
// this is the ONLY shape any AI parser (Claude, or a future replacement) may
// produce. Nothing downstream may accept nutrition fields on this type.

export type MatchConfidence = "exact" | "partial" | "none";
export type PortionConfidence = "exact" | "estimated" | "assumed_default";
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
  // The synonym-resolved, normalized query string that produced this match —
  // carried through to log-meal so cache promotion (FR-011) can key on it
  // without re-deriving it.
  normalized_query: string;
  food_id: string | null;
  quantity: number | null;
  unit: string | null;
  match_confidence: MatchConfidence;
  portion_confidence: PortionConfidence;
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
