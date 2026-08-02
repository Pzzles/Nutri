// Integration tests for HTTP edge functions.
// Requires: supabase start + supabase functions serve
// All calls use real JWTs — zero mocking.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestUser, signInAs, deleteTestUser, svcClient, testEmail, ANON_KEY } from "./helpers.js";

const FUNCTIONS_URL = process.env.FUNCTIONS_URL ?? "http://127.0.0.1:54421/functions/v1";
const EMAIL = testEmail("edge-fn");

let userId = "";
let jwt = "";

async function callFn(name: string, body: unknown, token = jwt) {
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function getFn(name: string, params: Record<string, string> = {}, token = jwt) {
  const qs = new URLSearchParams(params).toString();
  const url = `${FUNCTIONS_URL}/${name}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

async function cleanupUser(uid: string) {
  await svcClient().from("weight_logs").delete().eq("user_id", uid);
  await svcClient().from("goal_phases").delete().eq("user_id", uid);
  await svcClient().from("daily_log_status").delete().eq("user_id", uid);
  await svcClient().from("meals").delete().eq("user_id", uid);
}

beforeAll(async () => {
  userId = await createTestUser(EMAIL);
  const { client } = await signInAs(EMAIL);
  const { data } = await client.auth.getSession();
  jwt = data.session!.access_token;
  await cleanupUser(userId);

  // Phase 5+: start-goal-phase requires a complete profile and an official
  // weight log. Set these up here so later describe blocks can depend on them.
  await svcClient().from("profiles").upsert({
    id:             userId,
    birth_date:     "1990-01-01",
    sex:            "male",
    height_cm:      180,
    activity_level: "moderate",
    timezone:       "Africa/Johannesburg",
  }, { onConflict: "id" });

  await svcClient().from("weight_logs").insert({
    user_id:     userId,
    weight_kg:   85.5,
    measured_at: "2026-07-19T07:00:00.000Z",
    logged_date: "2026-07-19",
    is_official: true,
    source:      "manual",
  });
});

afterAll(async () => {
  await cleanupUser(userId);
  await deleteTestUser(userId);
});

// ── log-weight ─────────────────────────────────────────────────────────────────

describe("log-weight", () => {
  it("logs a weight entry and returns the full row", async () => {
    const resp = await callFn("log-weight", {
      weight_kg: 85.5,
      measured_at: "2026-07-20T07:00:00.000Z",
    });
    expect(resp.success).toBe(true);
    expect(resp.data.weight_kg).toBe(85.5);
    expect(resp.data.is_official).toBe(true);
    expect(resp.data.user_id).toBe(userId);
    expect(resp.data.logged_date).toBe("2026-07-20");
  });

  it("rejects weight_kg below 1", async () => {
    const resp = await callFn("log-weight", { weight_kg: 0 });
    expect(resp.success).toBe(false);
    expect(resp.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects weight_kg above 500", async () => {
    const resp = await callFn("log-weight", { weight_kg: 501 });
    expect(resp.success).toBe(false);
    expect(resp.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects missing Authorization header", async () => {
    const res = await fetch(`${FUNCTIONS_URL}/log-weight`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON_KEY },
      body: JSON.stringify({ weight_kg: 85 }),
    });
    const resp = await res.json();
    expect(resp.success).toBe(false);
  });

  it("same-day second entry demotes the first to is_official=false", async () => {
    await callFn("log-weight", {
      weight_kg: 84.0,
      measured_at: "2026-07-21T06:00:00.000Z",
    });
    const second = await callFn("log-weight", {
      weight_kg: 83.8,
      measured_at: "2026-07-21T18:00:00.000Z",
    });
    expect(second.data.is_official).toBe(true);
    expect(second.data.weight_kg).toBe(83.8);

    // Verify first entry was demoted via DB
    const { data: logs } = await svcClient()
      .from("weight_logs")
      .select("weight_kg, is_official")
      .eq("user_id", userId)
      .eq("logged_date", "2026-07-21")
      .order("weight_kg", { ascending: false });

    expect(logs).toHaveLength(2);
    const first = logs!.find((l: any) => Number(l.weight_kg) === 84.0);
    const sec = logs!.find((l: any) => Number(l.weight_kg) === 83.8);
    expect(first!.is_official).toBe(false);
    expect(sec!.is_official).toBe(true);
  });
});

// ── get-weight-logs ────────────────────────────────────────────────────────────

describe("get-weight-logs", () => {
  it("returns logs array and latest_official", async () => {
    const resp = await getFn("get-weight-logs");
    expect(resp.success).toBe(true);
    expect(Array.isArray(resp.data.logs)).toBe(true);
    expect(resp.data.logs.length).toBeGreaterThan(0);
    expect(resp.data.latest_official).not.toBeNull();
    expect(resp.data.latest_official.is_official).toBe(true);
  });

  it("official_only=true filters to only official entries", async () => {
    const resp = await getFn("get-weight-logs", { official_only: "true" });
    expect(resp.success).toBe(true);
    const nonOfficial = resp.data.logs.filter((l: any) => !l.is_official);
    expect(nonOfficial).toHaveLength(0);
  });

  it("limit param caps the result set", async () => {
    const resp = await getFn("get-weight-logs", { limit: "1" });
    expect(resp.success).toBe(true);
    expect(resp.data.logs.length).toBeLessThanOrEqual(1);
  });

  it("rejects unauthenticated request", async () => {
    const res = await fetch(`${FUNCTIONS_URL}/get-weight-logs`, {
      method: "GET",
      headers: { apikey: ANON_KEY },
    });
    const resp = await res.json();
    expect(resp.success).toBe(false);
  });
});

// ── dashboard-summary ──────────────────────────────────────────────────────────

describe("dashboard-summary", () => {
  it("returns today's summary including latest_weight", async () => {
    const resp = await callFn("dashboard-summary", { date: "2026-07-26" });
    expect(resp.success).toBe(true);
    expect(resp.data).toHaveProperty("date");
    expect(resp.data).toHaveProperty("totals");
    expect(resp.data).toHaveProperty("latest_weight");
  });

  it("latest_weight reflects the most recent official entry", async () => {
    const resp = await callFn("dashboard-summary", { date: "2026-07-26" });
    expect(resp.success).toBe(true);
    // We logged weight on 2026-07-20 and 2026-07-21 in prior tests
    expect(resp.data.latest_weight).not.toBeNull();
    expect(resp.data.latest_weight.weight_kg).toBeDefined();
  });
});

// ── start-goal-phase ───────────────────────────────────────────────────────────

describe("start-goal-phase", () => {
  let phaseId = "";

  it("creates a cut phase and returns the full phase row", async () => {
    const resp = await callFn("start-goal-phase", {
      mode: "cut",
      started_at: "2026-07-20T00:00:00.000Z",
      starting_weight_kg: 85.5,
      starting_weight_source: "manual",
      target_change_kg_per_week: -0.5,
    });
    expect(resp.success).toBe(true);
    expect(typeof resp.data).toBe("object");
    // Phase 5+: response is { phase, snapshot }, not the phase row directly.
    expect(resp.data.phase.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(resp.data.phase.mode).toBe("cut");
    expect(resp.data.phase.status).toBe("active");
    phaseId = resp.data.phase.id;
  });

  it("rejects starting a second phase without a transition", async () => {
    const resp = await callFn("start-goal-phase", {
      mode: "maintenance",
      started_at: "2026-07-21T00:00:00.000Z",
      starting_weight_kg: 85.0,
      starting_weight_source: "manual",
      target_change_kg_per_week: 0,
    });
    expect(resp.success).toBe(false);
  });

  it("supersedes existing phase with transition=supersede", async () => {
    const resp = await callFn("start-goal-phase", {
      mode: "maintenance",
      started_at: "2026-07-22T00:00:00.000Z",
      starting_weight_kg: 85.0,
      starting_weight_source: "manual",
      target_change_kg_per_week: 0,
      transition: "supersede",
    });
    expect(resp.success).toBe(true);

    // Old phase should now be superseded
    const { data: old } = await svcClient()
      .from("goal_phases")
      .select("status, superseded_by")
      .eq("id", phaseId)
      .single();
    expect(old!.status).toBe("superseded");
    // Phase 5+: response is { phase, snapshot }
    expect(old!.superseded_by).toBe(resp.data.phase.id);
  });
});

// ── get-meals / edit-meal-item / delete-meal ──────────────────────────────────

describe("get-meals / edit-meal-item / delete-meal", () => {
  const TEST_DATE = "2026-07-24";
  let foodId = "";
  let mealId = "";
  let itemId = "";

  beforeAll(async () => {
    const { data: food } = await svcClient()
      .from("foods")
      .insert({
        name: "Test Chicken Breast",
        normalized_name: "test chicken breast",
        source: "user_manual",
        calories_100g: 165,
        protein_100g: 31,
        carbs_100g: 0,
        fat_100g: 3.6,
      })
      .select("id")
      .single();
    foodId = food!.id;

    const { data: meal } = await svcClient()
      .from("meals")
      .insert({
        user_id: userId,
        raw_input: "100g chicken breast",
        meal_type: "lunch",
        meal_confidence: "high",
        eaten_at: `${TEST_DATE}T12:00:00.000Z`,
        logged_date: TEST_DATE,
      })
      .select("id")
      .single();
    mealId = meal!.id;

    const { data: item } = await svcClient()
      .from("meal_items")
      .insert({
        meal_id: mealId,
        food_id: foodId,
        raw_phrases: ["100g chicken breast"],
        quantity: 100,
        unit: "g",
        weight_g: 100,
        calories: 165,
        protein_g: 31,
        carbs_g: 0,
        fat_g: 3.6,
        match_confidence: "exact",
        portion_confidence: "exact",
        confidence: "high",
        nutrition_source: "test",
      })
      .select("id")
      .single();
    itemId = item!.id;
  });

  afterAll(async () => {
    // Ensure the meal (and its items) are gone before deleting the food (FK).
    if (mealId) await svcClient().from("meals").delete().eq("id", mealId);
    if (foodId) await svcClient().from("foods").delete().eq("id", foodId);
  });

  it("get-meals returns the meal with items and totals", async () => {
    const resp = await getFn("get-meals", { date: TEST_DATE });
    expect(resp.success).toBe(true);
    expect(resp.data.date).toBe(TEST_DATE);
    const meal = resp.data.meals.find((m: any) => m.id === mealId);
    expect(meal).toBeDefined();
    expect(meal.meal_type).toBe("lunch");
    expect(meal.items).toHaveLength(1);
    expect(meal.items[0].food_name).toBe("Test Chicken Breast");
    expect(meal.items[0].weight_g).toBe(100);
    expect(meal.totals.calories).toBeCloseTo(165, 0);
  });

  it("get-meals rejects a missing date param", async () => {
    const resp = await getFn("get-meals");
    expect(resp.success).toBe(false);
    expect(resp.error.code).toBe("VALIDATION_ERROR");
  });

  it("edit-meal-item rescales nutrition proportionally", async () => {
    const resp = await callFn("edit-meal-item", {
      meal_id: mealId,
      item_id: itemId,
      weight_g: 200,
    });
    expect(resp.success).toBe(true);
    expect(resp.data.weight_g).toBe(200);
    expect(resp.data.calories).toBeCloseTo(330, 0);
    expect(resp.data.protein_g).toBeCloseTo(62, 0);
    expect(resp.data.portion_confidence).toBe("estimated");
    itemId = resp.data.id; // row was replaced — capture new ID
  });

  it("edit-meal-item rejects weight_g of 0", async () => {
    const resp = await callFn("edit-meal-item", {
      meal_id: mealId,
      item_id: itemId,
      weight_g: 0,
    });
    expect(resp.success).toBe(false);
    expect(resp.error.code).toBe("VALIDATION_ERROR");
  });

  it("delete-meal removes a single item and leaves the meal", async () => {
    const resp = await callFn("delete-meal", { meal_id: mealId, item_id: itemId });
    expect(resp.success).toBe(true);
    expect(resp.data.deleted).toBe("item");

    const check = await getFn("get-meals", { date: TEST_DATE });
    const meal = check.data.meals.find((m: any) => m.id === mealId);
    expect(meal).toBeDefined();
    expect(meal.items).toHaveLength(0);
  });

  it("delete-meal removes the entire meal", async () => {
    const resp = await callFn("delete-meal", { meal_id: mealId });
    expect(resp.success).toBe(true);
    expect(resp.data.deleted).toBe("meal");
    mealId = ""; // mark as already gone so afterAll skip is a no-op

    const check = await getFn("get-meals", { date: TEST_DATE });
    const gone = check.data.meals.find((m: any) => m.id === resp.data.meal_id);
    expect(gone).toBeUndefined();
  });
});

// ── set-daily-log-status ───────────────────────────────────────────────────────

describe("set-daily-log-status + get-daily-log-status", () => {
  const DATE = "2026-07-25";

  it("marks a day as complete", async () => {
    const resp = await callFn("set-daily-log-status", {
      date: DATE,
      status: "complete",
    });
    expect(resp.success).toBe(true);
    expect(resp.data.status).toBe("complete");
    expect(resp.data.marked_complete_at).not.toBeNull();
  });

  it("get-daily-log-status returns complete for that day", async () => {
    const resp = await getFn("get-daily-log-status", { date: DATE });
    expect(resp.success).toBe(true);
    expect(resp.data.status).toBe("complete");
  });

  it("re-opening preserves marked_complete_at", async () => {
    const firstResp = await callFn("set-daily-log-status", {
      date: DATE,
      status: "complete",
    });
    const markedAt = firstResp.data.marked_complete_at;

    const reopenResp = await callFn("set-daily-log-status", {
      date: DATE,
      status: "partial",
    });
    expect(reopenResp.data.status).toBe("partial");
    expect(reopenResp.data.marked_complete_at).toBe(markedAt);
    expect(reopenResp.data.reopened_at).not.toBeNull();
  });
});
