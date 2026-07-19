// search-food
// Manual text search, bypassing AI. Used when automatic matching fails or
// the user wants to search directly. See docs/02-prs.md FR-012, FR-075.

import { ok, fail, preflight } from "../_shared/envelope.ts";
import { getUserClient, getServiceClient } from "../_shared/supabaseClient.ts";
import { searchFatSecret, upsertFatSecretFood } from "../_shared/fatsecret.ts";
import { searchUsda, upsertUsdaFood } from "../_shared/usda.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail("UNAUTHENTICATED", "Missing Authorization header", 401);
    const userClient = getUserClient(authHeader);
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return fail("UNAUTHENTICATED", "Invalid session", 401);

    const body = await req.json().catch(() => ({}));
    const query = String(body?.query ?? "").trim().toLowerCase();
    if (query.length < 2 || query.length > 100) {
      return fail("VALIDATION_ERROR", "query must be 2-100 characters");
    }

    const service = getServiceClient();
    const COLS = "id, name, brand, serving_size_g, source, calories_100g, protein_100g, carbs_100g, fat_100g, fibre_100g";

    // Tier 1 — exact local match (covers foods already fetched from FatSecret or custom).
    const { data: exact } = await service
      .from("foods")
      .select(COLS)
      .eq("status", "active")
      .ilike("normalized_name", `%${query}%`)
      .limit(20);

    if (exact && exact.length > 0) {
      return ok({ results: exact.map((f: any) => ({ ...f, match_type: "exact" })) });
    }

    // Tier 2 — fuzzy local match (ADR-005: trigram >= 0.75 or levenshtein <= 2).
    const { data: fuzzy, error: fuzzyErr } = await service.rpc("fn_fuzzy_food_search", {
      search_query: query,
      min_similarity: 0.75,
    });
    if (fuzzyErr) {
      console.error(fuzzyErr);
      return fail("INTERNAL_ERROR", "Search failed", 500);
    }

    if (fuzzy && fuzzy.length > 0) {
      const ids = fuzzy.map((f: any) => f.food_id);
      const { data: enriched } = await service.from("foods").select(COLS).in("id", ids);
      const byId = new Map((enriched ?? []).map((f: any) => [f.id, f]));
      return ok({
        results: fuzzy.map((f: any) => ({
          ...(byId.get(f.food_id) ?? {}),
          id: f.food_id,
          match_type: "fuzzy",
          similarity: f.similarity,
        })),
      });
    }

    // Tier 3 — FatSecret (primary external source, ZA context).
    const fsResults = await searchFatSecret(query, 10);

    if (fsResults.length > 0) {
      const results = (
        await Promise.all(
          fsResults.map(async (food) => {
            const id = await upsertFatSecretFood(service, food);
            if (!id) return null;
            return {
              id,
              name: food.name,
              brand: food.brand,
              serving_size_g: food.servingSizeG,
              source: "fatsecret",
              calories_100g: food.calories100g,
              protein_100g: food.protein100g,
              carbs_100g: food.carbs100g,
              fat_100g: food.fat100g,
              fibre_100g: food.fibre100g,
              match_type: "exact",
            };
          }),
        )
      ).filter(Boolean);
      return ok({ results });
    }

    // Tier 4 — USDA FoodData Central (fallback when FatSecret has nothing).
    const usdaResults = await searchUsda(query, 10);
    if (usdaResults.length === 0) return ok({ results: [] });

    const results = (
      await Promise.all(
        usdaResults.map(async (food) => {
          const id = await upsertUsdaFood(service, food);
          if (!id) return null;
          return {
            id,
            name: food.description,
            brand: food.brandOwner,
            serving_size_g: food.servingSize,
            source: "usda_fdc",
            calories_100g: food.calories,
            protein_100g: food.protein,
            carbs_100g: food.carbs,
            fat_100g: food.fat,
            fibre_100g: food.fibre,
            match_type: "exact",
          };
        }),
      )
    ).filter(Boolean);

    return ok({ results });
  } catch (err) {
    console.error(err);
    return fail("INTERNAL_ERROR", "Unexpected error searching foods", 500);
  }
});
