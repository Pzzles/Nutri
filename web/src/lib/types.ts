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
