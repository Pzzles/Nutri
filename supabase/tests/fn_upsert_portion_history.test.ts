// Integration tests for fn_upsert_portion_history.
// Requires: supabase start
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestUser, deleteTestUser,
  insertGlobalFood, deleteFood,
  deleteUserPortionHistory, testEmail, svcClient,
} from "./helpers.js";

// fn_upsert_portion_history is security definer with no auth.uid() guard.
// Call it via the service role (as edge functions would).

const EMAIL_A = testEmail("portionA");
const EMAIL_B = testEmail("portionB");
let userAId = "";
let userBId = "";
let foodId = "";

beforeAll(async () => {
  userAId = await createTestUser(EMAIL_A);
  userBId = await createTestUser(EMAIL_B);
  foodId = await insertGlobalFood();
});

afterAll(async () => {
  await deleteUserPortionHistory(userAId);
  await deleteUserPortionHistory(userBId);
  await deleteFood(foodId);
  await deleteTestUser(userAId);
  await deleteTestUser(userBId);
});

async function getPortionRecord(userId: string, fId: string) {
  const { data } = await svcClient()
    .from("user_food_portions")
    .select("usual_g, use_count, last_used_at")
    .eq("user_id", userId)
    .eq("food_id", fId)
    .maybeSingle();
  return data;
}

// ── First call ────────────────────────────────────────────────────────────────

describe("fn_upsert_portion_history — first call", () => {
  it("inserts a row with use_count = 1", async () => {
    const { error } = await svcClient().rpc("fn_upsert_portion_history", {
      p_user_id: userAId,
      p_food_id: foodId,
      p_usual_g: 150,
    });

    expect(error).toBeNull();

    const record = await getPortionRecord(userAId, foodId);
    expect(record).not.toBeNull();
    expect(Number(record!.usual_g)).toBe(150);
    expect(record!.use_count).toBe(1);
  });
});

// ── Subsequent calls ──────────────────────────────────────────────────────────

describe("fn_upsert_portion_history — subsequent calls", () => {
  it("second call increments use_count to 2 and updates usual_g", async () => {
    await svcClient().rpc("fn_upsert_portion_history", {
      p_user_id: userAId,
      p_food_id: foodId,
      p_usual_g: 200, // new portion size
    });

    const record = await getPortionRecord(userAId, foodId);
    expect(record!.use_count).toBe(2);
    expect(Number(record!.usual_g)).toBe(200);
  });

  it("third call increments use_count to 3", async () => {
    await svcClient().rpc("fn_upsert_portion_history", {
      p_user_id: userAId,
      p_food_id: foodId,
      p_usual_g: 175,
    });

    const record = await getPortionRecord(userAId, foodId);
    expect(record!.use_count).toBe(3);
    expect(Number(record!.usual_g)).toBe(175);
  });

  it("updates last_used_at on each call", async () => {
    const before = await getPortionRecord(userAId, foodId);
    const beforeTime = new Date(before!.last_used_at).getTime();

    // Wait 1ms to guarantee a different timestamp
    await new Promise((r) => setTimeout(r, 50));

    await svcClient().rpc("fn_upsert_portion_history", {
      p_user_id: userAId,
      p_food_id: foodId,
      p_usual_g: 160,
    });

    const after = await getPortionRecord(userAId, foodId);
    const afterTime = new Date(after!.last_used_at).getTime();

    expect(afterTime).toBeGreaterThanOrEqual(beforeTime);
    expect(after!.use_count).toBe(4);
  });
});

// ── User isolation ────────────────────────────────────────────────────────────

describe("fn_upsert_portion_history — user isolation", () => {
  it("userB has an independent record from userA for the same food", async () => {
    const { error } = await svcClient().rpc("fn_upsert_portion_history", {
      p_user_id: userBId,
      p_food_id: foodId,
      p_usual_g: 80,
    });

    expect(error).toBeNull();

    const recordA = await getPortionRecord(userAId, foodId);
    const recordB = await getPortionRecord(userBId, foodId);

    expect(recordB!.use_count).toBe(1); // B's first call
    expect(recordB!.usual_g).toBe(80);

    // A's record is unaffected
    expect(recordA!.usual_g).not.toBe(80);
    expect(recordA!.use_count).toBeGreaterThan(1);
  });

  it("userB's use_count increments independently of userA", async () => {
    await svcClient().rpc("fn_upsert_portion_history", {
      p_user_id: userBId,
      p_food_id: foodId,
      p_usual_g: 90,
    });

    const recordB = await getPortionRecord(userBId, foodId);
    expect(recordB!.use_count).toBe(2);
  });
});
