// USDA FoodData Central helpers — shared by search-food and resolve-foods.

const DEPRIORITIZE = /dried|powder|dehydrated|concentrate|instant|fluid,\s*canned/i;
const PREFER = /raw|fresh|whole|cooked|boiled|low.fat|skim/i;

export interface UsdaFood {
  fdcId: number;
  description: string;
  brandOwner: string | null;
  servingSize: number | null;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fibre: number | null;
}

export function parseNutrients(foodNutrients: any[]): Pick<UsdaFood, "calories" | "protein" | "carbs" | "fat" | "fibre"> {
  const get = (id: number) => (foodNutrients ?? []).find((n: any) => n.nutrientId === id)?.value ?? 0;
  return {
    calories: get(1008),
    protein: get(1003),
    carbs: get(1005),
    fat: get(1004),
    fibre: get(1079) || null,
  };
}

export async function searchUsda(query: string, pageSize = 10): Promise<UsdaFood[]> {
  const apiKey = Deno.env.get("USDA_FDC_API_KEY") ?? "DEMO_KEY";
  const url =
    `https://api.nal.usda.gov/fdc/v1/foods/search` +
    `?query=${encodeURIComponent(query)}` +
    `&api_key=${apiKey}` +
    `&dataType=Foundation,SR%20Legacy` +
    `&pageSize=${pageSize}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) {
      console.error(`[USDA] HTTP ${resp.status} for "${query}"`);
      return [];
    }
    const json = await resp.json();
    return (json?.foods ?? [])
      .filter((f: any) => f.fdcId && f.description)
      .map((f: any) => ({
        fdcId: f.fdcId,
        description: f.description,
        brandOwner: f.brandOwner ?? null,
        servingSize: f.servingSize ?? null,
        ...parseNutrients(f.foodNutrients ?? []),
      }));
  } catch (err) {
    clearTimeout(timeout);
    console.error(`[USDA] fetch error for "${query}":`, String(err));
    return [];
  }
}

// Pick the most relevant single result for AI-driven resolution.
export function pickBestMatch(candidates: UsdaFood[]): UsdaFood | null {
  if (candidates.length === 0) return null;
  return (
    candidates.find((f) => PREFER.test(f.description) && !DEPRIORITIZE.test(f.description)) ??
    candidates.find((f) => !DEPRIORITIZE.test(f.description)) ??
    candidates[0]
  );
}

// Upsert a USDA food into the local foods table; returns the local UUID.
// Idempotent — safe to call repeatedly for the same fdcId.
export async function upsertUsdaFood(service: any, food: UsdaFood): Promise<string | null> {
  const { data: existing } = await service
    .from("foods")
    .select("id")
    .eq("source", "usda_fdc")
    .eq("source_identifier", String(food.fdcId))
    .maybeSingle();
  if (existing) return existing.id;

  if (!food.description) {
    console.error("[USDA] skipping food with no description, fdcId:", food.fdcId);
    return null;
  }

  const { data: inserted, error } = await service
    .from("foods")
    .insert({
      name: food.description,
      normalized_name: food.description.trim().toLowerCase(),
      source: "usda_fdc",
      source_identifier: String(food.fdcId),
      serving_size_g: food.servingSize,
      calories_100g: food.calories,
      protein_100g: food.protein,
      carbs_100g: food.carbs,
      fat_100g: food.fat,
      fibre_100g: food.fibre,
      verified: true,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[USDA] insert failed:", JSON.stringify(error));
    return null;
  }
  return inserted.id;
}
