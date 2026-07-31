// resolve-foods
// HTTP entry point into the Food Resolution Engine (ADR-003). Turns
// ParsedFoodItem[] into resolved, confidence-scored, deduplicated matches.
// See docs/02-prs.md FR-005, FR-010, FR-074, FR-075, FR-076 and
// docs/07-edge-functions.md → resolve-foods for the full flow this mirrors.

import { ok, fail, preflight } from "../_shared/envelope.ts";
import { getUserClient, getServiceClient } from "../_shared/supabaseClient.ts";
import { computeItemConfidence } from "../_shared/confidence.ts";
import { unitsCompatible } from "../_shared/units.ts";
import {
  ParsedFoodItem,
  ResolvedFoodItem,
  MatchConfidence,
  PortionConfidence,
} from "../_shared/types.ts";
import { searchFatSecret, upsertFatSecretFood, FatSecretFood } from "../_shared/fatsecret.ts";
import { searchUsda, upsertUsdaFood, pickBestMatch, UsdaFood } from "../_shared/usda.ts";
import { detectFoodFormAmbiguity, deduplicateCandidates } from "../_shared/foodFormAmbiguity.ts";

interface FoodFormOption {
  food_id: string;
  name: string;
  calories_100g: number;
  serving_size_g: number | null;
}

type ClarificationItem =
  | { raw_phrase: string; reason: "ambiguous" | "no_food_match" }
  | { raw_phrase: string; reason: "food_form_ambiguous"; options: FoodFormOption[] };

type ResolveOneResult =
  | { kind: "match"; foodId: string | null; matchConfidence: MatchConfidence }
  | { kind: "ambiguous"; options: FoodFormOption[] };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail("UNAUTHENTICATED", "Missing Authorization header", 401);

    const userClient = getUserClient(authHeader);
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return fail("UNAUTHENTICATED", "Invalid session", 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const items: ParsedFoodItem[] = body?.items ?? [];
    const userSelections: Array<{ raw_phrase: string; food_id: string }> = body?.user_selections ?? [];

    if ((!Array.isArray(items) || items.length === 0) && userSelections.length === 0) {
      return fail("VALIDATION_ERROR", "items must be a non-empty array");
    }

    const service = getServiceClient();
    const resolved: ResolvedFoodItem[] = [];
    const clarificationRequired: ClarificationItem[] = [];

    // User-confirmed food form selections: write to per-user cache and include as resolved.
    for (const sel of userSelections) {
      if (!sel.raw_phrase || !sel.food_id) continue;
      const normalized = String(sel.raw_phrase).trim().toLowerCase();
      try {
        await service
          .from("user_food_cache")
          .upsert(
            {
              user_id: userId,
              normalized_query: normalized,
              matched_food_id: sel.food_id,
              confidence: "partial",
              lookup_source: "user_selection",
            },
            { onConflict: "user_id,normalized_query" },
          );
      } catch (err) {
        console.error("[cache] user_food_cache write failed:", err);
      }
      resolved.push({
        raw_phrase: sel.raw_phrase,
        normalized_query: normalized,
        food_id: sel.food_id,
        quantity: null,
        unit: null,
        match_confidence: "partial",
        portion_confidence: "assumed_default",
        item_confidence: computeItemConfidence("partial", "assumed_default"),
      });
    }

    for (const item of items) {
      const query = await applySynonym(service, item.normalized_name);

      // FR-004: ambiguous items skip external lookup — but if the user has a match
      // in their own food library, resolve it directly without asking for clarification.
      // Defensive: coerce string "true"/"false" from older Groq responses.
      const isAmbiguous = item.ambiguous === true || item.ambiguous === "true";
      if (isAmbiguous) {
        const { data: ownFoods } = await service
          .from("foods")
          .select("id")
          .eq("owner_user_id", userId)
          .eq("status", "active")
          .ilike("normalized_name", `%${query}%`)
          .limit(1);

        if (!ownFoods || ownFoods.length === 0) {
          clarificationRequired.push({ raw_phrase: item.raw_phrase, reason: "ambiguous" });
          continue;
        }
        // Found in user's library — fall through to resolveOne which returns it as exact.
      }

      const matchResult = await resolveOne(service, userId, query, item.raw_phrase);

      if (matchResult.kind === "ambiguous") {
        clarificationRequired.push({
          raw_phrase: item.raw_phrase,
          reason: "food_form_ambiguous",
          options: matchResult.options,
        });
        continue;
      }

      const portionConfidence: PortionConfidence =
        item.quantity != null && item.unit != null ? "exact"
        : item.quantity != null ? "estimated"
        : "assumed_default";

      resolved.push({
        raw_phrase: item.raw_phrase,
        normalized_query: query,
        food_id: matchResult.foodId,
        quantity: item.quantity,
        unit: item.unit,
        match_confidence: matchResult.matchConfidence,
        portion_confidence: portionConfidence,
        item_confidence: computeItemConfidence(matchResult.matchConfidence, portionConfidence),
      });
    }

    const withMatch = resolved.filter((r) => r.food_id !== null);
    const withoutMatch = resolved.filter((r) => r.food_id === null);

    const deduped = mergeDuplicates(withMatch);

    for (const unmatched of withoutMatch) {
      clarificationRequired.push({ raw_phrase: unmatched.raw_phrase, reason: "no_food_match" });
    }

    return ok({ resolved_items: deduped, clarification_required: clarificationRequired });
  } catch (err) {
    console.error(err);
    return fail("INTERNAL_ERROR", "Unexpected error resolving foods", 500);
  }
});

async function writeGlobalCache(
  service: any,
  query: string,
  foodId: string,
  confidence: string,
  lookupSource: string,
): Promise<void> {
  try {
    await service
      .from("global_food_cache")
      .upsert(
        { normalized_query: query, matched_food_id: foodId, confidence, lookup_source: lookupSource },
        { onConflict: "normalized_query" },
      );
  } catch (err) {
    console.error("[cache] global_food_cache write failed:", err);
  }
}

async function applySynonym(service: any, name: string): Promise<string> {
  const normalized = name.trim().toLowerCase();
  const { data } = await service
    .from("food_synonyms")
    .select("canonical_term")
    .eq("raw_term", normalized)
    .maybeSingle();
  return data?.canonical_term ?? normalized;
}

async function resolveOne(
  service: any,
  userId: string,
  query: string,
  rawPhrase: string,
): Promise<ResolveOneResult> {
  const { data: ownFood } = await service
    .from("foods")
    .select("id")
    .eq("owner_user_id", userId)
    .eq("normalized_name", query)
    .eq("status", "active")
    .maybeSingle();
  if (ownFood) return { kind: "match", foodId: ownFood.id, matchConfidence: "exact" };

  // Partial match: query is a substring of a user's custom food name.
  // Handles cases where the parser drops descriptors ("lephaphathane" → "homemade lephaphathane").
  const { data: partialOwn } = await service
    .from("foods")
    .select("id")
    .eq("owner_user_id", userId)
    .eq("status", "active")
    .ilike("normalized_name", `%${query}%`)
    .limit(1);
  if (partialOwn && partialOwn.length > 0) {
    return { kind: "match", foodId: partialOwn[0].id, matchConfidence: "partial" };
  }

  const { data: userCache } = await service
    .from("user_food_cache")
    .select("matched_food_id, confidence")
    .eq("user_id", userId)
    .eq("normalized_query", query)
    .maybeSingle();
  if (userCache) return { kind: "match", foodId: userCache.matched_food_id, matchConfidence: userCache.confidence };

  const { data: globalCache } = await service
    .from("global_food_cache")
    .select("matched_food_id, confidence")
    .eq("normalized_query", query)
    .maybeSingle();
  if (globalCache) return { kind: "match", foodId: globalCache.matched_food_id, matchConfidence: globalCache.confidence };

  const { data: fuzzyMatches } = await service.rpc("fn_fuzzy_food_search", {
    search_query: query,
    min_similarity: 0.75,
  });
  if (fuzzyMatches && fuzzyMatches.length > 0) {
    return { kind: "match", foodId: fuzzyMatches[0].food_id, matchConfidence: "partial" };
  }

  return await tryExternalLookup(service, query, rawPhrase);
}

async function tryExternalLookup(
  service: any,
  query: string,
  rawPhrase: string,
): Promise<ResolveOneResult> {
  const searchTerm = rawPhrase.length > 0 ? rawPhrase : query;

  // ── Tier 1: FatSecret ─────────────────────────────────────────────────────
  let fsCandidates: FatSecretFood[] = [];
  try {
    fsCandidates = await searchFatSecret(searchTerm, 5);
  } catch (fsErr) {
    console.error("[FatSecret tier] unexpected error for query:", searchTerm, String(fsErr));
    // Fall through to USDA tier — do not crash the whole resolution request.
  }
  if (fsCandidates.length > 0) {
    const dedupedFs = deduplicateCandidates(fsCandidates);
    if (detectFoodFormAmbiguity(dedupedFs)) {
      const top = dedupedFs.slice(0, 3).filter((c) => c.calories100g > 0);
      const options = (
        await Promise.all(
          top.map(async (c: FatSecretFood) => {
            const foodId = await upsertFatSecretFood(service, c);
            if (!foodId) return null;
            return {
              food_id: foodId,
              name: c.name,
              calories_100g: c.calories100g,
              serving_size_g: c.servingSizeG ?? null,
            } satisfies FoodFormOption;
          }),
        )
      ).filter((o): o is FoodFormOption => o !== null);
      if (options.length >= 2) return { kind: "ambiguous", options };
    }

    const best =
      fsCandidates.find((f) => f.name.toLowerCase() === searchTerm.toLowerCase()) ??
      fsCandidates[0];
    const foodId = await upsertFatSecretFood(service, best);
    if (!foodId) return { kind: "match", foodId: null, matchConfidence: "none" };
    await writeGlobalCache(service, query, foodId, "exact", "fatsecret");
    return { kind: "match", foodId, matchConfidence: "exact" };
  }

  // ── Tier 2: USDA FoodData Central (fallback when FatSecret returns nothing) ─
  try {
    const usdaCandidates = await searchUsda(searchTerm, 10);
    if (usdaCandidates.length === 0) {
      return { kind: "match", foodId: null, matchConfidence: "none" };
    }

    // AmbiguityCandidate requires calories100g; USDA stores nutrients as `calories`
    // (already per-100 g for Foundation/SR Legacy datasets).
    const usdaMapped = usdaCandidates.map((c: UsdaFood) => ({ ...c, calories100g: c.calories }));
    const dedupedUsda = deduplicateCandidates(usdaMapped);

    if (detectFoodFormAmbiguity(dedupedUsda)) {
      const top = dedupedUsda.slice(0, 3).filter((c) => c.calories100g > 0);
      const options = (
        await Promise.all(
          top.map(async (c) => {
            const foodId = await upsertUsdaFood(service, c);
            if (!foodId) return null;
            return {
              food_id: foodId,
              name: c.description,
              calories_100g: c.calories100g,
              serving_size_g: c.servingSize ?? null,
            } satisfies FoodFormOption;
          }),
        )
      ).filter((o): o is FoodFormOption => o !== null);
      if (options.length >= 2) return { kind: "ambiguous", options };
    }

    const best = pickBestMatch(usdaCandidates);
    if (!best) return { kind: "match", foodId: null, matchConfidence: "none" };
    const foodId = await upsertUsdaFood(service, best);
    if (!foodId) return { kind: "match", foodId: null, matchConfidence: "none" };
    await writeGlobalCache(service, query, foodId, "partial", "usda_fdc");
    return { kind: "match", foodId, matchConfidence: "partial" };
  } catch (err) {
    console.error("[USDA tier] unexpected error for query:", searchTerm, String(err));
    return { kind: "match", foodId: null, matchConfidence: "none" };
  }
}

function mergeDuplicates(items: ResolvedFoodItem[]): ResolvedFoodItem[] {
  const merged: ResolvedFoodItem[] = [];
  for (const item of items) {
    const existing = merged.find(
      (m) => m.food_id === item.food_id && unitsCompatible(m.unit, item.unit),
    );
    if (existing) {
      existing.quantity = (existing.quantity ?? 0) + (item.quantity ?? 0);
      existing.raw_phrase = `${existing.raw_phrase}; ${item.raw_phrase}`;
    } else {
      merged.push({ ...item });
    }
  }
  return merged;
}
