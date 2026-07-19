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
import { searchFatSecret, upsertFatSecretFood } from "../_shared/fatsecret.ts";

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
    if (!Array.isArray(items) || items.length === 0) {
      return fail("VALIDATION_ERROR", "items must be a non-empty array");
    }

    const service = getServiceClient();
    const resolved: ResolvedFoodItem[] = [];
    const clarificationRequired: Array<{ raw_phrase: string; reason: string }> = [];

    for (const item of items) {
      // FR-004: ambiguous items never proceed to lookup — they need a
      // clarifying answer first.
      if (item.ambiguous) {
        clarificationRequired.push({ raw_phrase: item.raw_phrase, reason: "ambiguous" });
        continue;
      }

      const query = await applySynonym(service, item.normalized_name);
      const match = await resolveOne(service, userId, query, item.raw_phrase);

      const portionConfidence: PortionConfidence =
        item.quantity != null && item.unit != null ? "exact"
        : item.quantity != null ? "estimated"
        : "assumed_default";

      resolved.push({
        raw_phrase: item.raw_phrase,
        normalized_query: query,
        food_id: match.foodId,
        quantity: item.quantity,
        unit: item.unit,
        match_confidence: match.matchConfidence,
        portion_confidence: portionConfidence,
        item_confidence: computeItemConfidence(match.matchConfidence, portionConfidence),
      });
    }

    const withMatch = resolved.filter((r) => r.food_id !== null);
    const withoutMatch = resolved.filter((r) => r.food_id === null);

    // Duplicate Detector — runs AFTER resolution, on resolved food_id, not raw
    // text (ADR-003 / FR-005). Catches cases like "coke" + "coca-cola" that
    // only reveal themselves as duplicates once both resolve to the same food.
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
): Promise<{ foodId: string | null; matchConfidence: MatchConfidence }> {
  // Tier 1 — user's own custom foods (FR-010).
  const { data: ownFood } = await service
    .from("foods")
    .select("id")
    .eq("owner_user_id", userId)
    .eq("normalized_name", query)
    .eq("status", "active")
    .maybeSingle();
  if (ownFood) return { foodId: ownFood.id, matchConfidence: "exact" };

  // Tier 2 — this user's cache.
  const { data: userCache } = await service
    .from("user_food_cache")
    .select("matched_food_id, confidence")
    .eq("user_id", userId)
    .eq("normalized_query", query)
    .maybeSingle();
  if (userCache) return { foodId: userCache.matched_food_id, matchConfidence: userCache.confidence };

  // Tier 3 — global cache, shared across users.
  const { data: globalCache } = await service
    .from("global_food_cache")
    .select("matched_food_id, confidence")
    .eq("normalized_query", query)
    .maybeSingle();
  if (globalCache) return { foodId: globalCache.matched_food_id, matchConfidence: globalCache.confidence };

  // Fuzzy match against canonical foods before paying for an external call —
  // ADR-005: trigram similarity >= 0.75, OR levenshtein <= 2 for short strings.
  const { data: fuzzyMatches } = await service.rpc("fn_fuzzy_food_search", {
    search_query: query,
    min_similarity: 0.75,
  });
  if (fuzzyMatches && fuzzyMatches.length > 0) {
    // A fuzzy hit is never treated as exact (FR-075 AC2).
    return { foodId: fuzzyMatches[0].food_id, matchConfidence: "partial" };
  }

  // Tier 4/5 — USDA FoodData Central / Open Food Facts.
  const externalMatch = await tryExternalLookup(service, query, rawPhrase);
  if (externalMatch) return externalMatch;

  return { foodId: null, matchConfidence: "none" };
}

async function tryExternalLookup(
  service: any,
  query: string,
  rawPhrase: string,
): Promise<{ foodId: string; matchConfidence: MatchConfidence } | null> {
  // Use raw_phrase — it carries context ("low-fat milk", "hard-boiled egg") that
  // normalized_name loses, giving FatSecret a better chance at the right food.
  const searchTerm = rawPhrase.length > 0 ? rawPhrase : query;
  const candidates = await searchFatSecret(searchTerm, 5);
  if (candidates.length === 0) return null;

  // Prefer exact name matches; otherwise take the first result.
  const best =
    candidates.find((f) => f.name.toLowerCase() === searchTerm.toLowerCase()) ??
    candidates[0];

  const foodId = await upsertFatSecretFood(service, best);
  if (!foodId) return null;

  return { foodId, matchConfidence: "exact" };
}

function mergeDuplicates(items: ResolvedFoodItem[]): ResolvedFoodItem[] {
  const merged: ResolvedFoodItem[] = [];
  for (const item of items) {
    const existing = merged.find(
      (m) => m.food_id === item.food_id && unitsCompatible(m.unit, item.unit),
    );
    if (existing) {
      // FR-005 AC1: same food_id + compatible unit family → summed quantity.
      existing.quantity = (existing.quantity ?? 0) + (item.quantity ?? 0);
      existing.raw_phrase = `${existing.raw_phrase}; ${item.raw_phrase}`;
    } else {
      merged.push({ ...item });
    }
  }
  return merged;
}
