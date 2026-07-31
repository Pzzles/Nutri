// Phase 4 — API integration tests for the full meal flow.
// Requires: supabase start + supabase functions serve
// All calls use real JWTs — zero mocking.
// Covers: full flow, user isolation (RLS), idempotency, SAST timezone, validation.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestUser,
  signInAs,
  deleteTestUser,
  svcClient,
  testEmail,
  insertGlobalFood,
  deleteFood,
  deleteUserMeals,
  makeLogMealItem,
  ANON_KEY,
} from "./helpers.js";

const FUNCTIONS_URL = process.env.FUNCTIONS_URL ?? "http://127.0.0.1:54421/functions/v1";

const EMAIL_A = testEmail("mf-a");
const EMAIL_B = testEmail("mf-b");

let userIdA = "";
let userIdB = "";
let jwtA = "";
let jwtB = "";
let foodId = "";

async function callFn(name: string, body: unknown, token = jwtA) {
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

async function getFn(name: string, params: Record<string, string> = {}, token = jwtA) {
  const qs = new URLSearchParams(params).toString();
  const url = `${FUNCTIONS_URL}/${name}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

function makeItem(grams: number) {
  return makeLogMealItem(foodId, {
    raw_phrases: [`${grams}g e2e test chicken breast`],
    quantity: grams,
    unit: "g",
    portion_g: grams,
    calories: Math.round((165 * grams) / 100),
    protein_g: Math.round((31 * grams) / 100),
    carbs_g: 0,
    fat_g: Math.round((3.6 * grams) / 100 * 10) / 10,
    fibre_g: 0,
    match_confidence: "exact",
    portion_confidence: "exact",
    item_confidence: "high",
    nutrition_source: "user_manual",
  });
}

beforeAll(async () => {
  const svc = svcClient();

  userIdA = await createTestUser(EMAIL_A);
  userIdB = await createTestUser(EMAIL_B);

  const { client: clientA } = await signInAs(EMAIL_A);
  const { data: sessA } = await clientA.auth.getSession();
  jwtA = sessA.session!.access_token;

  const { client: clientB } = await signInAs(EMAIL_B);
  const { data: sessB } = await clientB.auth.getSession();
  jwtB = sessB.session!.access_token;

  // Profile rows (used by log-meal timezone logic).
  await svc.from("profiles").upsert(
    { id: userIdA, timezone: "Africa/Johannesburg" },
    { onConflict: "id" },
  );
  await svc.from("profiles").upsert(
    { id: userIdB, timezone: "Africa/Johannesburg" },
    { onConflict: "id" },
  );

  // User-owned test food — resolve-foods finds this in tier 1 without any
  // external API call (owner_user_id match beats global cache).
  foodId = await insertGlobalFood({
    name: "E2E Test Chicken Breast",
    normalized_name: "e2e test chicken breast",
    owner_user_id: userIdA,
    status: "active",
    calories_100g: 165,
    protein_100g: 31,
    carbs_100g: 0,
    fat_100g: 3.6,
    fibre_100g: 0,
    serving_size_g: 100,
  });
});

afterAll(async () => {
  const svc = svcClient();
  await svc.from("profiles").delete().in("id", [userIdA, userIdB]);
  await deleteUserMeals(userIdA);
  await deleteUserMeals(userIdB);
  await svc.from("daily_log_status").delete().in("user_id", [userIdA, userIdB]);
  await deleteFood(foodId);
  await deleteTestUser(userIdA);
  await deleteTestUser(userIdB);
});

// ── Full meal flow ─────────────────────────────────────────────────────────────

describe("full meal flow", () => {
  const TEST_DATE = "2026-06-15";
  let mealId = "";

  it("log-meal persists a meal and returns a meal_id", async () => {
    const resp = await callFn("log-meal", {
      idempotency_key: crypto.randomUUID(),
      meal_type: "lunch",
      eaten_at: `${TEST_DATE}T12:00:00.000Z`,
      source: "draft",
      raw_input: "100g e2e test chicken breast",
      meal_confidence: "high",
      items: [makeItem(100)],
    });
    expect(resp.success).toBe(true);
    expect(resp.data.meal_id).toMatch(/^[0-9a-f-]{36}$/i);
    mealId = resp.data.meal_id;
  });

  it("get-meals returns the logged meal with correct items and totals", async () => {
    const resp = await getFn("get-meals", { date: TEST_DATE });
    expect(resp.success).toBe(true);
    const meal = (resp.data.meals as any[]).find((m) => m.id === mealId);
    expect(meal).toBeDefined();
    expect(meal.meal_type).toBe("lunch");
    expect(meal.items).toHaveLength(1);
    expect(meal.items[0].food_name).toContain("E2E Test Chicken Breast");
    expect(meal.totals.calories).toBeCloseTo(165, 0);
    expect(meal.totals.protein_g).toBeCloseTo(31, 0);
  });

  it("get-meals returns empty list for a different date", async () => {
    const resp = await getFn("get-meals", { date: "2026-06-14" });
    expect(resp.success).toBe(true);
    const mealIds = (resp.data.meals as any[]).map((m: any) => m.id);
    expect(mealIds).not.toContain(mealId);
  });

  it("dashboard-summary reflects the logged meal calories for that date", async () => {
    const resp = await callFn("dashboard-summary", { date: TEST_DATE });
    expect(resp.success).toBe(true);
    expect(resp.data.totals.calories).toBeGreaterThanOrEqual(165);
  });
});

// ── User isolation (RLS) ───────────────────────────────────────────────────────

describe("user isolation (RLS)", () => {
  let mealIdA = "";
  let itemIdA = "";

  beforeAll(async () => {
    const resp = await callFn("log-meal", {
      idempotency_key: crypto.randomUUID(),
      meal_type: "dinner",
      eaten_at: "2026-06-16T18:00:00.000Z",
      source: "draft",
      raw_input: "80g e2e test chicken breast",
      meal_confidence: "high",
      items: [makeItem(80)],
    });
    expect(resp.success).toBe(true);
    mealIdA = resp.data.meal_id;

    const mealsResp = await getFn("get-meals", { date: "2026-06-16" });
    const meal = (mealsResp.data.meals as any[]).find((m: any) => m.id === mealIdA);
    itemIdA = meal?.items?.[0]?.id ?? "";
  });

  it("user B's get-meals does not return user A's meal", async () => {
    const resp = await getFn("get-meals", { date: "2026-06-16" }, jwtB);
    expect(resp.success).toBe(true);
    const found = (resp.data.meals as any[]).find((m: any) => m.id === mealIdA);
    expect(found).toBeUndefined();
  });

  it("user B cannot delete user A's meal", async () => {
    const resp = await callFn("delete-meal", { meal_id: mealIdA }, jwtB);
    expect(resp.success).toBe(false);
  });

  it("user B cannot edit user A's meal item", async () => {
    if (!itemIdA) return;
    const resp = await callFn(
      "edit-meal-item",
      { meal_id: mealIdA, item_id: itemIdA, weight_g: 999 },
      jwtB,
    );
    expect(resp.success).toBe(false);
  });

  it("user A's meal is still intact after user B's failed attempts", async () => {
    const resp = await getFn("get-meals", { date: "2026-06-16" });
    expect(resp.success).toBe(true);
    const meal = (resp.data.meals as any[]).find((m: any) => m.id === mealIdA);
    expect(meal).toBeDefined();
    expect(meal.items).toHaveLength(1);
    expect(meal.items[0].weight_g).toBeCloseTo(80, 0);
  });
});

// ── Idempotency / double-submit ────────────────────────────────────────────────

describe("idempotency / double-submit protection", () => {
  const IDEM_KEY = crypto.randomUUID();
  let firstMealId = "";

  const payload = () => ({
    idempotency_key: IDEM_KEY,
    meal_type: "snack",
    eaten_at: "2026-06-17T10:00:00.000Z",
    source: "draft",
    raw_input: "50g e2e test chicken breast",
    meal_confidence: "high",
    items: [makeItem(50)],
  });

  it("first log-meal call succeeds and returns a meal_id", async () => {
    const resp = await callFn("log-meal", payload());
    expect(resp.success).toBe(true);
    firstMealId = resp.data.meal_id;
    expect(firstMealId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("second call with same idempotency_key returns the identical meal_id", async () => {
    const resp = await callFn("log-meal", payload());
    expect(resp.success).toBe(true);
    expect(resp.data.meal_id).toBe(firstMealId);
  });

  it("only one meal row exists in the DB for this idempotency key", async () => {
    const { data: meals } = await svcClient()
      .from("meals")
      .select("id")
      .eq("user_id", userIdA)
      .eq("eaten_at", "2026-06-17T10:00:00.000+00:00");
    expect(meals?.length).toBe(1);
  });
});

// ── SAST midnight timezone (Africa/Johannesburg, UTC+2) ──────────────────────

describe("SAST midnight timezone (Africa/Johannesburg = UTC+2)", () => {
  it("meal at 22:30 UTC lands on the NEXT calendar day in SAST", async () => {
    // 22:30 UTC + 2h = 00:30 SAST → rolls into August 1
    const resp = await callFn("log-meal", {
      idempotency_key: crypto.randomUUID(),
      meal_type: "snack",
      eaten_at: "2026-07-31T22:30:00.000Z",
      source: "draft",
      meal_confidence: "high",
      items: [makeItem(50)],
    });
    expect(resp.success).toBe(true);

    const { data: meal } = await svcClient()
      .from("meals")
      .select("logged_date")
      .eq("id", resp.data.meal_id)
      .single();
    expect(meal!.logged_date).toBe("2026-08-01");
  });

  it("meal at 21:55 UTC stays on the SAME calendar day in SAST", async () => {
    // 21:55 UTC + 2h = 23:55 SAST → still July 31
    const resp = await callFn("log-meal", {
      idempotency_key: crypto.randomUUID(),
      meal_type: "snack",
      eaten_at: "2026-07-31T21:55:00.000Z",
      source: "draft",
      meal_confidence: "high",
      items: [makeItem(50)],
    });
    expect(resp.success).toBe(true);

    const { data: meal } = await svcClient()
      .from("meals")
      .select("logged_date")
      .eq("id", resp.data.meal_id)
      .single();
    expect(meal!.logged_date).toBe("2026-07-31");
  });
});

// ── API validation ─────────────────────────────────────────────────────────────

describe("API validation", () => {
  it("log-meal without idempotency_key returns VALIDATION_ERROR", async () => {
    const resp = await callFn("log-meal", {
      meal_type: "lunch",
      source: "draft",
      items: [makeItem(100)],
    });
    expect(resp.success).toBe(false);
    expect(resp.error.code).toBe("VALIDATION_ERROR");
  });

  it("log-meal with empty items array returns VALIDATION_ERROR", async () => {
    const resp = await callFn("log-meal", {
      idempotency_key: crypto.randomUUID(),
      meal_type: "lunch",
      source: "draft",
      items: [],
    });
    expect(resp.success).toBe(false);
    expect(resp.error.code).toBe("VALIDATION_ERROR");
  });

  it("log-meal without Authorization header returns UNAUTHENTICATED", async () => {
    const res = await fetch(`${FUNCTIONS_URL}/log-meal`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON_KEY },
      body: JSON.stringify({
        idempotency_key: crypto.randomUUID(),
        meal_type: "lunch",
        source: "draft",
        items: [],
      }),
    });
    const resp = await res.json();
    expect(resp.success).toBe(false);
    expect(resp.error.code).toBe("UNAUTHENTICATED");
  });

  it("log-meal with invalid source returns VALIDATION_ERROR", async () => {
    const resp = await callFn("log-meal", {
      idempotency_key: crypto.randomUUID(),
      meal_type: "lunch",
      source: "invalid_source",
      items: [makeItem(100)],
    });
    expect(resp.success).toBe(false);
    expect(resp.error.code).toBe("VALIDATION_ERROR");
  });
});
