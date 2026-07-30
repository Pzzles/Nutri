export interface MealItemData {
  id: string;
  food_id: string;
  food_name: string;
  brand: string | null;
  quantity: number | null;
  unit: string | null;
  weight_g: number | null;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fibre_g: number | null;
  confidence: "high" | "medium" | "low";
  match_confidence: "exact" | "partial" | "none";
  portion_confidence: "exact" | "estimated" | "assumed_default";
  nutrition_source: string;
}

export interface MealTotals {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fibre_g: number;
}

export interface MealData {
  id: string;
  meal_type: "breakfast" | "lunch" | "dinner" | "snack";
  eaten_at: string;
  meal_confidence: string;
  totals: MealTotals;
  items: MealItemData[];
}

export interface GetMealsResponse {
  date: string;
  meals: MealData[];
  day_totals: MealTotals;
}
