// Phase 5 — energy calculation integration tests via the preview-energy-calc endpoint.
//
// These tests call the real edge function against the local Supabase stack.
// They prove that:
//   • Mifflin–St Jeor BMR is calculated correctly for male and female inputs
//   • Each activity multiplier returns the expected TDEE
//   • Cut/maintenance/bulk modes produce the correct daily adjustment
//   • Manual maintenance override takes precedence over the equation estimate
//   • A target below 1000 kcal is rejected (TARGET_BELOW_FLOOR, HTTP 422)
//   • An aggressive rate surfaces the aggressive_rate warning
//   • Missing profile fields return eligible:false with the missing_fields list
//
// Requires: supabase start + supabase functions serve
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestUser,
  signInAs,
  deleteTestUser,
  svcClient,
  SUPABASE_URL,
  ANON_KEY,
} from "./helpers.js";

const EMAIL = `energy-calc-${Date.now()}@test.local`;
let userId = "";
let accessToken = "";

// ── Test profile (shared across all math tests) ───────────────────────────────
// Male, 175 cm, born 1990-07-31 (age 36 on 2026-07-31), moderate activity
// Weight log: 80 kg official
const PROFILE_MALE = {
  birth_date: "1990-07-31",
  sex: "male",
  height_cm: 175,
  activity_level: "moderate",
};

// Female variant
const PROFILE_FEMALE = { ...PROFILE_MALE, sex: "female" };

beforeAll(async () => {
  userId = await createTestUser(EMAIL);
  const svc = svcClient();

  // Insert profile with math-known values.
  await svc.from("profiles").upsert(
    { id: userId, timezone: "Africa/Johannesburg", ...PROFILE_MALE },
    { onConflict: "id" },
  );

  // Insert an official weight log (80 kg).
  await svc.from("weight_logs").insert({
    user_id: userId,
    weight_kg: 80,
    measured_at: new Date().toISOString(),
    is_official: true,
    source: "manual",
  });

  const { client } = await signInAs(EMAIL);
  const { data: { session } } = await client.auth.getSession();
  accessToken = session!.access_token;
});

afterAll(async () => {
  const svc = svcClient();
  await svc.from("weight_logs").delete().eq("user_id", userId);
  await svc.from("profiles").delete().eq("id", userId);
  await deleteTestUser(userId);
});

async function callPreview(body: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/preview-energy-calc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      apikey: ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

// ── BMR correctness ───────────────────────────────────────────────────────────
// Male, 80 kg, 175 cm, age 36 (birthday passed July 31):
//   BMR = 10*80 + 6.25*175 − 5*36 + 5 = 800 + 1093.75 − 180 + 5 = 1718.75
// × moderate (1.55) = 2664.0625 → TDEE
describe("preview-energy-calc — male BMR", () => {
  it("returns eligible:true with correct BMR for a male profile", async () => {
    const { status, json } = await callPreview({ goal_mode: "maintenance", target_change_kg_per_week: 0 });
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    const d = json.data;
    expect(d.eligible).toBe(true);
    expect(d.estimated_bmr_kcal).toBe(Math.round(1718.75));  // 1719
    expect(d.maintenance_source).toBe("equation_estimate");
  });
});

describe("preview-energy-calc — female BMR", () => {
  it("female BMR is 166 kcal/day less than male BMR for identical inputs", async () => {
    // Override to female for this test.
    const svc = svcClient();
    await svc.from("profiles").update({ sex: "female" }).eq("id", userId);

    const { json: jsonF } = await callPreview({ goal_mode: "maintenance", target_change_kg_per_week: 0 });
    const femaleBmr = jsonF.data.estimated_bmr_kcal;

    // Restore male.
    await svc.from("profiles").update({ sex: "male" }).eq("id", userId);

    const { json: jsonM } = await callPreview({ goal_mode: "maintenance", target_change_kg_per_week: 0 });
    const maleBmr = jsonM.data.estimated_bmr_kcal;

    // Difference should be exactly 166 (before rounding).
    // After rounding Math.round(1718.75)=1719 and Math.round(1552.75)=1553 → diff=166.
    expect(maleBmr - femaleBmr).toBe(166);
  });
});

// ── Activity multipliers ──────────────────────────────────────────────────────
describe("preview-energy-calc — activity multipliers", () => {
  it.each([
    ["sedentary",   1.200],
    ["light",       1.375],
    ["moderate",    1.550],
    ["active",      1.725],
    ["very_active", 1.900],
  ])("%s multiplier returns correct TDEE", async (level, multiplier) => {
    const { json } = await callPreview({
      goal_mode: "maintenance",
      target_change_kg_per_week: 0,
      activity_level: level,
    });
    const d = json.data;
    expect(d.eligible).toBe(true);
    const expectedTdee = Math.round(d.estimated_bmr_kcal * multiplier);
    expect(d.estimated_tdee_kcal).toBe(expectedTdee);
    expect(d.input_snapshot.activity_multiplier).toBe(multiplier);
  });
});

// ── Cut / bulk adjustment ─────────────────────────────────────────────────────
describe("preview-energy-calc — cut and bulk adjustments", () => {
  it("cut phase: daily_adjustment = −0.5 × 7700 / 7 = −550", async () => {
    const { json } = await callPreview({ goal_mode: "cut", target_change_kg_per_week: -0.5 });
    expect(json.data.daily_adjustment_kcal).toBe(-550);
    expect(json.data.recommended_target_kcal).toBe(
      json.data.effective_maintenance_kcal - 550,
    );
  });

  it("bulk phase: daily_adjustment = +0.3 × 7700 / 7 = +330", async () => {
    const { json } = await callPreview({ goal_mode: "bulk", target_change_kg_per_week: 0.3 });
    expect(json.data.daily_adjustment_kcal).toBe(330);
    expect(json.data.recommended_target_kcal).toBe(
      json.data.effective_maintenance_kcal + 330,
    );
  });
});

// ── Manual maintenance override ───────────────────────────────────────────────
describe("preview-energy-calc — manual maintenance override", () => {
  it("manual_maintenance_kcal overrides the equation estimate", async () => {
    const { json } = await callPreview({
      goal_mode: "cut",
      target_change_kg_per_week: -0.5,
      manual_maintenance_kcal: 3000,
    });
    const d = json.data;
    expect(d.maintenance_source).toBe("manual_override");
    expect(d.effective_maintenance_kcal).toBe(3000);
    expect(d.recommended_target_kcal).toBe(3000 - 550);
  });
});

// ── Aggressive rate warning ───────────────────────────────────────────────────
describe("preview-energy-calc — aggressive rate", () => {
  it("returns aggressive_rate warning when abs(rate) > 1% of body weight", async () => {
    // 80 kg × 0.01 = 0.8 kg/week threshold; 0.9 > 0.8 → aggressive
    const { json } = await callPreview({ goal_mode: "cut", target_change_kg_per_week: -0.9 });
    expect(json.data.eligible).toBe(true);
    expect(json.data.warnings).toContain("aggressive_rate");
    expect(json.data.is_aggressive_rate).toBe(true);
  });

  it("does not flag a conservative rate as aggressive", async () => {
    const { json } = await callPreview({ goal_mode: "cut", target_change_kg_per_week: -0.5 });
    expect(json.data.warnings).not.toContain("aggressive_rate");
  });
});

// ── Floor rejection ───────────────────────────────────────────────────────────
describe("preview-energy-calc — floor rejection", () => {
  it("returns TARGET_BELOW_FLOOR (422) when target would fall below 1000 kcal", async () => {
    // Force a very small maintenance via manual override and a large cut.
    const { status, json } = await callPreview({
      goal_mode: "cut",
      target_change_kg_per_week: -1.5,
      manual_maintenance_kcal: 1800, // 1800 − 1650 = 150 < 1000
    });
    expect(status).toBe(422);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("TARGET_BELOW_FLOOR");
  });
});

// ── Missing profile fields ────────────────────────────────────────────────────
describe("preview-energy-calc — missing profile fields", () => {
  it("returns eligible:false with missing_fields when height_cm is null", async () => {
    const svc = svcClient();
    await svc.from("profiles").update({ height_cm: null }).eq("id", userId);

    const { status, json } = await callPreview({ goal_mode: "maintenance", target_change_kg_per_week: 0 });

    // Restore.
    await svc.from("profiles").update({ height_cm: 175 }).eq("id", userId);

    expect(status).toBe(200);
    expect(json.data.eligible).toBe(false);
    expect(json.data.missing_fields).toContain("height_cm");
  });
});
