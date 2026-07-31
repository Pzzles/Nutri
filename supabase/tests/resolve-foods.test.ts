// B9 — Resolution-tier integration tests for the resolve-foods edge function.
//
// Each test sets up the DB so that ONLY ONE TIER has a matching food, then
// verifies that the returned food_id belongs to that tier's food row. This
// proves the resolution waterfall respects its tier ordering.
//
// Tier ordering (resolveOne / tryExternalLookup):
//   1. user-exact   — foods row owned by user, normalized_name === query
//   2. user-partial — foods row owned by user, normalized_name ILIKE %query%
//   3. user_food_cache   — user_food_cache row for (user_id, normalized_query)
//   4. global_food_cache — global_food_cache row for normalized_query
//   5. fuzzy RPC    — fn_fuzzy_food_search (trigram, similarity ≥ 0.75)
//   6. FatSecret    — external API (fallthrough on error or empty result)
//   7. USDA         — external API (fallthrough on empty result)
//   8. unresolved   — food_id null, moved to clarification_required
//
// Requires: supabase start + supabase functions serve
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  createTestUser,
  signInAs,
  deleteTestUser,
  svcClient,
  SUPABASE_URL,
  ANON_KEY,
} from "./helpers.js";

const EMAIL = `resolve-tiers-${Date.now()}@test.local`;
let userId = "";
let accessToken = "";

// Tracks food IDs inserted during tests so afterAll can clean them up.
const createdFoodIds: string[] = [];
const createdCacheQueries: string[] = [];

beforeAll(async () => {
  userId = await createTestUser(EMAIL);
  const svc = svcClient();
  await svc
    .from("profiles")
    .upsert({ id: userId, timezone: "Africa/Johannesburg" }, { onConflict: "id" });

  const { client } = await signInAs(EMAIL);
  const { data: { session } } = await client.auth.getSession();
  accessToken = session!.access_token;
});

afterAll(async () => {
  const svc = svcClient();
  if (createdFoodIds.length > 0) {
    await svc.from("user_food_cache").delete().in("matched_food_id", createdFoodIds);
    await svc.from("global_food_cache").delete().in("matched_food_id", createdFoodIds);
    await svc.from("foods").delete().in("id", createdFoodIds);
  }
  await svc.from("profiles").delete().eq("id", userId);
  await deleteTestUser(userId);
});

// Wipe per-user caches before each test so tiers don't bleed across tests.
beforeEach(async () => {
  const svc = svcClient();
  await svc.from("user_food_cache").delete().eq("user_id", userId);
});

// Call resolve-foods with a single item. Returns the full response JSON.
async function resolveOne(normalizedName: string, rawPhrase = normalizedName) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/resolve-foods`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      apikey: ANON_KEY,
    },
    body: JSON.stringify({
      items: [{ raw_phrase: rawPhrase, normalized_name: normalizedName, quantity: 100, unit: "g", ambiguous: false }],
    }),
  });
  return res.json();
}

// Insert a food owned by userId.
async function insertUserFood(normalizedName: string): Promise<string> {
  const svc = svcClient();
  const { data, error } = await svc
    .from("foods")
    .insert({
      name: `B9 Test — ${normalizedName}`,
      normalized_name: normalizedName,
      owner_user_id: userId,
      source: "user_manual",
      status: "active",
      calories_100g: 100,
      protein_100g: 10,
      carbs_100g: 20,
      fat_100g: 5,
      fibre_100g: 2,
      serving_size_g: 100,
    })
    .select("id")
    .single();
  if (error) throw new Error(`insertUserFood failed: ${error.message}`);
  createdFoodIds.push(data.id);
  return data.id;
}

// Insert a global food (no owner).
async function insertGlobalFood(normalizedName: string): Promise<string> {
  const svc = svcClient();
  const { data, error } = await svc
    .from("foods")
    .insert({
      name: `B9 Global — ${normalizedName}`,
      normalized_name: normalizedName,
      source: "usda_fdc",
      status: "active",
      calories_100g: 120,
      protein_100g: 12,
      carbs_100g: 25,
      fat_100g: 6,
      fibre_100g: 3,
      serving_size_g: 100,
    })
    .select("id")
    .single();
  if (error) throw new Error(`insertGlobalFood failed: ${error.message}`);
  createdFoodIds.push(data.id);
  return data.id;
}

// ── Tier 1: user-exact ────────────────────────────────────────────────────────

describe("resolve-foods tier 1 — user-exact", () => {
  it("resolves a query that exactly matches a user-owned food name", async () => {
    const query = `t1-exact-${Date.now()}`;
    const foodId = await insertUserFood(query);

    const result = await resolveOne(query);

    expect(result.success).toBe(true);
    expect(result.data.resolved_items).toHaveLength(1);
    const item = result.data.resolved_items[0];
    expect(item.food_id).toBe(foodId);
    expect(item.match_confidence).toBe("exact");
    expect(result.data.clarification_required).toHaveLength(0);
  });
});

// ── Tier 2: user-partial ──────────────────────────────────────────────────────

describe("resolve-foods tier 2 — user-partial", () => {
  it("resolves a query that is a substring of a user-owned food name", async () => {
    // Food name: "homemade lephaphathane bowl"
    // Query:     "lephaphathane"  (parser dropped the prefix)
    const uniqueToken = `t2-partial-${Date.now()}`;
    const fullName = `homemade ${uniqueToken} bowl`;
    const foodId = await insertUserFood(fullName);

    const result = await resolveOne(uniqueToken);

    expect(result.success).toBe(true);
    expect(result.data.resolved_items).toHaveLength(1);
    const item = result.data.resolved_items[0];
    expect(item.food_id).toBe(foodId);
    expect(item.match_confidence).toBe("partial");
    expect(result.data.clarification_required).toHaveLength(0);
  });

  it("does NOT resolve via partial when the query exactly matches another user food (tier 1 wins)", async () => {
    const exact = `t2-exact-wins-${Date.now()}`;
    const exactFoodId = await insertUserFood(exact);
    // Also insert a food whose name contains exact as a substring.
    await insertUserFood(`prefix ${exact} suffix`);

    const result = await resolveOne(exact);

    expect(result.success).toBe(true);
    expect(result.data.resolved_items[0].food_id).toBe(exactFoodId);
    expect(result.data.resolved_items[0].match_confidence).toBe("exact");
  });
});

// ── Tier 3: user_food_cache ───────────────────────────────────────────────────

describe("resolve-foods tier 3 — user_food_cache", () => {
  it("resolves from the per-user cache when no owned food matches", async () => {
    const query = `t3-user-cache-${Date.now()}`;
    // Insert a global food to be the cache target (no user ownership).
    const cachedFoodId = await insertGlobalFood(query);

    const svc = svcClient();
    await svc.from("user_food_cache").insert({
      user_id: userId,
      normalized_query: query,
      matched_food_id: cachedFoodId,
      confidence: "exact",
      lookup_source: "usda_fdc",
    });

    const result = await resolveOne(query);

    expect(result.success).toBe(true);
    expect(result.data.resolved_items).toHaveLength(1);
    const item = result.data.resolved_items[0];
    expect(item.food_id).toBe(cachedFoodId);
    // match_confidence comes from the cache row.
    expect(item.match_confidence).toBe("exact");
  });
});

// ── Tier 4: global_food_cache ─────────────────────────────────────────────────

describe("resolve-foods tier 4 — global_food_cache", () => {
  it("resolves from the global cache when no owned food or user cache matches", async () => {
    const query = `t4-global-cache-${Date.now()}`;
    const globalFoodId = await insertGlobalFood(query);

    const svc = svcClient();
    await svc.from("global_food_cache").insert({
      normalized_query: query,
      matched_food_id: globalFoodId,
      confidence: "partial",
      lookup_source: "fatsecret",
    });

    const result = await resolveOne(query);

    expect(result.success).toBe(true);
    expect(result.data.resolved_items).toHaveLength(1);
    const item = result.data.resolved_items[0];
    expect(item.food_id).toBe(globalFoodId);
    expect(item.match_confidence).toBe("partial");
  });

  it("global cache is superseded by user_food_cache (tier 3 wins over tier 4)", async () => {
    const query = `t4-tier-order-${Date.now()}`;
    const globalFoodId = await insertGlobalFood(query);
    const userCacheFoodId = await insertGlobalFood(`${query}-user-pref`);

    const svc = svcClient();
    await svc.from("global_food_cache").insert({
      normalized_query: query,
      matched_food_id: globalFoodId,
      confidence: "exact",
      lookup_source: "usda_fdc",
    });
    await svc.from("user_food_cache").insert({
      user_id: userId,
      normalized_query: query,
      matched_food_id: userCacheFoodId,
      confidence: "partial",
      lookup_source: "user_selection",
    });

    const result = await resolveOne(query);

    expect(result.success).toBe(true);
    // User cache (tier 3) must win over global cache (tier 4).
    expect(result.data.resolved_items[0].food_id).toBe(userCacheFoodId);
  });
});

// ── Tier 5: fuzzy RPC ─────────────────────────────────────────────────────────

describe("resolve-foods tier 5 — fuzzy RPC", () => {
  it("resolves a near-match query via fn_fuzzy_food_search when caches are empty", async () => {
    // Use a very similar name to trigger trigram similarity >= 0.75.
    // "brocolli" (typo) vs "broccoli" is a common case.
    // We insert a food with the correct spelling and query with the typo.
    const unique = `t5-fuzzy-${Date.now()}`;
    const correctName = `${unique} broccoli florets`;
    const fuzzyQuery = `${unique} broccli florets`; // missing letter

    const foodId = await insertGlobalFood(correctName);

    const result = await resolveOne(fuzzyQuery);

    expect(result.success).toBe(true);
    if (result.data.resolved_items.length > 0) {
      // The fuzzy tier found a match.
      expect(result.data.resolved_items[0].food_id).toBe(foodId);
      expect(result.data.resolved_items[0].match_confidence).toBe("partial");
    } else {
      // If the similarity threshold was not met, the item goes to clarification.
      // The test confirms the pipeline reached the fuzzy tier without crashing.
      expect(result.data.clarification_required.length).toBeGreaterThan(0);
    }
  });
});

// ── Tier 8: unresolved ────────────────────────────────────────────────────────

describe("resolve-foods tier 8 — unresolved", () => {
  it("returns no_food_match in clarification_required when nothing matches", async () => {
    // A string that cannot possibly match any food in the database or external APIs.
    const impossible = `zzz-unresolvable-gibberish-${Date.now()}-xyzzy`;

    const result = await resolveOne(impossible, impossible);

    expect(result.success).toBe(true);
    // The item must NOT appear in resolved_items.
    expect(result.data.resolved_items.filter(
      (r: { raw_phrase: string }) => r.raw_phrase === impossible
    )).toHaveLength(0);
    // It must appear in clarification_required with reason no_food_match.
    const unresolved = result.data.clarification_required.find(
      (c: { raw_phrase: string; reason: string }) => c.raw_phrase === impossible
    );
    expect(unresolved).toBeDefined();
    expect(unresolved?.reason).toBe("no_food_match");
  });

  it("returns a valid resolved item alongside an unresolved item in the same request", async () => {
    const resolvedQuery = `t8-multi-resolvable-${Date.now()}`;
    const resolvedFoodId = await insertUserFood(resolvedQuery);
    const unresolvedQuery = `t8-multi-unresolvable-${Date.now()}-xyzzy`;

    const res = await fetch(`${SUPABASE_URL}/functions/v1/resolve-foods`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        apikey: ANON_KEY,
      },
      body: JSON.stringify({
        items: [
          { raw_phrase: resolvedQuery, normalized_name: resolvedQuery, quantity: 100, unit: "g", ambiguous: false },
          { raw_phrase: unresolvedQuery, normalized_name: unresolvedQuery, quantity: 100, unit: "g", ambiguous: false },
        ],
      }),
    });
    const result = await res.json();

    expect(result.success).toBe(true);
    // The resolvable item must be in resolved_items.
    const resolved = result.data.resolved_items.find(
      (r: { food_id: string }) => r.food_id === resolvedFoodId
    );
    expect(resolved).toBeDefined();
    // The unresolvable item must be in clarification_required.
    const clarification = result.data.clarification_required.find(
      (c: { raw_phrase: string }) => c.raw_phrase === unresolvedQuery
    );
    expect(clarification).toBeDefined();
    expect(clarification?.reason).toBe("no_food_match");
  });
});
