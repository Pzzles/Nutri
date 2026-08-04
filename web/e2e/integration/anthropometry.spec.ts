import { expect, test, type Page } from "@playwright/test";
import type { Session } from "@supabase/supabase-js";
import pg from "pg";
import {
  ANON_KEY,
  DB_URL,
  SUPABASE_URL,
  createTestUser,
  deleteTestUser,
  signInAs,
  svcClient,
  testEmail,
} from "./helpers";

function authStorageKey(): string {
  const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0];
  return `sb-${projectRef}-auth-token`;
}

async function injectSession(page: Page, session: Session): Promise<void> {
  await page.addInitScript(
    ({ storageKey, storedSession }) => {
      localStorage.setItem(storageKey, JSON.stringify(storedSession));
      // Supabase CLI may expose the same local stack as localhost or 127.0.0.1.
      localStorage.setItem("sb-127-auth-token", JSON.stringify(storedSession));
    },
    { storageKey: authStorageKey(), storedSession: session },
  );
}

async function seedFinalizedWaistSession(token: string, measuredAt: string): Promise<void> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/save-anthropometric-session`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      status: "finalized",
      measured_at: measuredAt,
      protocol_version: "anthropometry_protocol_v1",
      idempotency_key: `e2e-baseline-${crypto.randomUUID()}`,
      measurement_context: {
        meal_timing: "after_food",
        after_bathroom: false,
        exercise_within_previous_12_hours: true,
        measurement_assistance: "assisted",
        clothing_level: "normal",
      },
      sites: [{ site_code: "waist", readings_cm: [91.8, 92.2] }],
    }),
  });
  const body = await response.json() as { error?: { message?: string } | null };
  if (!response.ok) {
    throw new Error(`Baseline finalization failed (${response.status}): ${body.error?.message ?? "unknown error"}`);
  }
}

test("authenticated mobile user finalizes raw waist readings and sees real history", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const email = testEmail("anthropometry-browser");
  const userId = await createTestUser(email);

  try {
    const { session } = await signInAs(email);
    const baselineAt = new Date(Date.now() - 28 * 86_400_000).toISOString();
    await seedFinalizedWaistSession(session.access_token, baselineAt);
    await injectSession(page, session);

    await page.goto("/measurements");
    await expect(page.getByRole("heading", { name: /guided measurement session/i })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    await page.getByRole("button", { name: "Clear" }).click();
    await page.getByRole("checkbox", { name: /^Waist \(WHO midpoint\)/i }).check();
    await page.getByRole("combobox", { name: /food timing/i }).selectOption("before_food");
    await page.getByRole("combobox", { name: /measurement help/i }).selectOption("self");
    await page.getByRole("combobox", { name: /clothing level/i }).selectOption("minimal");
    await page.getByRole("combobox", { name: /after using the bathroom/i }).selectOption("true");
    await page.getByRole("combobox", { name: /exercise in the previous 12 hours/i }).selectOption("false");
    await page.getByRole("checkbox", { name: /reviewed the preparation/i }).check();
    await page.getByRole("button", { name: /Begin with 1 site/i }).click();

    const first = page.getByRole("spinbutton", { name: /Reading 1 in centimetres/i });
    await expect(first).toBeFocused();
    await first.fill("88.0");
    await first.press("Enter");
    const second = page.getByRole("spinbutton", { name: /Reading 2 in centimetres/i });
    await second.fill("88.8");
    await second.press("Enter");

    await expect(page.getByRole("heading", { name: /check your raw readings/i })).toBeVisible();
    await page.getByRole("button", { name: /Finalize session/i }).click();
    await expect(page.getByRole("heading", { name: /session finalized/i })).toBeVisible();
    await expect(page.getByText("88.4 cm")).toBeVisible();
    await expect(page.getByText(/cannot be edited or reopened/i)).toBeVisible();

    const service = svcClient();
    const { data: sessions, error: sessionsError } = await service
      .from("anthropometric_sessions")
      .select("id, status, representative_algorithm_version, measurement_context_version, meal_timing, after_bathroom, exercise_within_previous_12_hours, measurement_assistance, clothing_level, local_time")
      .eq("user_id", userId)
      .order("measured_at");
    if (sessionsError) throw sessionsError;
    expect(sessions).toHaveLength(2);
    expect(sessions?.every((entry) => entry.status === "finalized")).toBe(true);
    expect(sessions?.every((entry) => entry.representative_algorithm_version === "anthropometry_representative_v3")).toBe(true);
    expect(sessions?.at(-1)).toMatchObject({
      measurement_context_version: "anthropometry_measurement_context_v1",
      meal_timing: "before_food", after_bathroom: true,
      exercise_within_previous_12_hours: false,
      measurement_assistance: "self", clothing_level: "minimal",
    });
    expect(sessions?.at(-1)?.local_time).toMatch(/^\d{2}:\d{2}:\d{2}$/);

    const sessionIds = sessions!.map((entry) => entry.id);
    const { data: readings, error: readingsError } = await service
      .from("anthropometric_readings")
      .select("session_id, reading_number, value_cm")
      .in("session_id", sessionIds);
    if (readingsError) throw readingsError;
    expect(readings).toHaveLength(4);
    expect(readings?.map((entry) => Number(entry.value_cm)).sort((left, right) => left - right))
      .toEqual([88, 88.8, 91.8, 92.2]);

    const { data: representatives, error: representativesError } = await service
      .from("anthropometric_representatives")
      .select("session_id, representative_cm, method")
      .in("session_id", sessionIds);
    if (representativesError) throw representativesError;
    expect(representatives?.map((entry) => Number(entry.representative_cm)).sort((left, right) => left - right))
      .toEqual([88.4, 92]);
    expect(representatives?.every((entry) => entry.method === "mean_of_two")).toBe(true);

    await page.getByRole("button", { name: /View history & trends/i }).click();
    await expect(page.getByRole("heading", { name: /circumference trend/i })).toBeVisible();
    await expect(page.getByRole("img", { name: /2 recorded points.*no smoothing or interpolated values/i })).toBeVisible();
    await expect(page.getByText("−3.6 cm").first()).toBeVisible();
    await expect(page.getByText(/sessions were measured under different conditions/i)).toBeVisible();
    await page.getByText(/context, raw readings and calculation provenance/i).first().click();
    await expect(page.getByText("before food")).toBeVisible();
    await expect(page.getByText("minimal")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  } finally {
    await deleteTestUser(userId);
  }
});

async function beginWaistSession(page: Page): Promise<void> {
  await page.goto("/measurements");
  await page.getByRole("button", { name: "Clear" }).click();
  await page.getByRole("checkbox", { name: /^Waist \(WHO midpoint\)/i }).check();
  await page.getByRole("checkbox", { name: /reviewed the preparation/i }).check();
  await page.getByRole("button", { name: /Begin with 1 site/i }).click();
}

async function enterReading(page: Page, number: number, value: string): Promise<void> {
  const input = page.getByRole("spinbutton", { name: new RegExp(`Reading ${number} in centimetres`, "i") });
  await input.fill(value);
  await input.press("Enter");
}

async function authenticatedPage(page: Page, label: string) {
  const email = testEmail(label);
  const userId = await createTestUser(email);
  const { session } = await signInAs(email);
  await injectSession(page, session);
  return userId;
}

test("real isolated reading remains optional and persists selected readings 1 and 2", async ({ page }) => {
  test.setTimeout(60_000);
  const userId = await authenticatedPage(page, "anthropometry-isolated");
  try {
    await beginWaistSession(page);
    await enterReading(page, 1, "80.0");
    await enterReading(page, 2, "80.2");
    await page.getByRole("button", { name: /add optional third reading/i }).click();
    await enterReading(page, 3, "50.0");
    await expect(page.getByText(/one reading was isolated/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /retake this site/i })).toBeVisible();
    await page.getByRole("button", { name: /continue with agreeing pair/i }).click();
    await page.getByRole("button", { name: /finalize session/i }).click();
    await expect(page.getByText("80.1 cm")).toBeVisible();

    const { data, error } = await svcClient().from("anthropometric_representatives")
      .select("representative_cm, selected_reading_indices, quality, eligible_for_interpretation, source_reading_ids, unselected_reading_id, session_id")
      .eq("site_code", "waist")
      .in("session_id", (await svcClient().from("anthropometric_sessions").select("id").eq("user_id", userId)).data!.map((row) => row.id))
      .single();
    if (error) throw error;
    expect(Number(data.representative_cm)).toBe(80.1);
    expect(data.selected_reading_indices).toEqual([1, 2]);
    expect(data.quality).toBe("pair_agree_with_isolated_reading");
    expect(data.eligible_for_interpretation).toBe(true);
    expect(data.source_reading_ids).toHaveLength(2);
    expect(data.unselected_reading_id).toBeTruthy();
  } finally {
    await deleteTestUser(userId);
  }
});

test("real high variability requires confirmation, saves, and stays interpretation-ineligible", async ({ page }) => {
  test.setTimeout(60_000);
  const userId = await authenticatedPage(page, "anthropometry-high-variability");
  try {
    await beginWaistSession(page);
    await enterReading(page, 1, "80.0");
    await enterReading(page, 2, "82.0");
    await enterReading(page, 3, "84.5");
    await expect(page.getByText(/measurement confidence: low/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /retake this site/i })).toBeVisible();
    const saveLow = page.getByRole("button", { name: /save with low confidence/i });
    await expect(saveLow).toBeDisabled();
    await page.getByRole("checkbox", { name: /understand this value has low measurement confidence/i }).check();
    await expect(saveLow).toBeEnabled();
    await saveLow.click();
    await page.getByRole("button", { name: /finalize session/i }).click();
    await expect(page.getByText("81.0 cm")).toBeVisible();
    await expect(page.getByText(/ineligible for progress interpretation/i)).toBeVisible();
    await page.getByRole("button", { name: /view history/i }).click();
    await expect(page.getByText(/low confidence; excluded from progress interpretation/i).first()).toBeVisible();

    const sessionIds = (await svcClient().from("anthropometric_sessions").select("id").eq("user_id", userId)).data!.map((row) => row.id);
    const { data, error } = await svcClient().from("anthropometric_representatives")
      .select("representative_cm, selected_reading_indices, quality, eligible_for_interpretation, quality_acknowledged_at")
      .in("session_id", sessionIds).single();
    if (error) throw error;
    expect(Number(data.representative_cm)).toBe(81);
    expect(data.selected_reading_indices).toEqual([1, 2]);
    expect(data.quality).toBe("high_variability");
    expect(data.eligible_for_interpretation).toBe(false);
    expect(data.quality_acknowledged_at).toBeTruthy();
  } finally {
    await deleteTestUser(userId);
  }
});

test("real closest-pair tie deterministically persists readings 1 and 2", async ({ page }) => {
  test.setTimeout(60_000);
  const userId = await authenticatedPage(page, "anthropometry-tie");
  try {
    await beginWaistSession(page);
    await enterReading(page, 1, "80.0");
    await enterReading(page, 2, "81.0");
    await page.getByRole("button", { name: /add optional third reading/i }).click();
    await enterReading(page, 3, "82.0");
    await page.getByRole("button", { name: /finalize session/i }).click();
    await expect(page.getByText("80.5 cm")).toBeVisible();

    const sessionIds = (await svcClient().from("anthropometric_sessions").select("id").eq("user_id", userId)).data!.map((row) => row.id);
    const { data, error } = await svcClient().from("anthropometric_representatives")
      .select("representative_cm, selected_reading_indices, quality")
      .in("session_id", sessionIds).single();
    if (error) throw error;
    expect(Number(data.representative_cm)).toBe(80.5);
    expect(data.selected_reading_indices).toEqual([1, 2]);
    expect(data.quality).toBe("pair_agree");
  } finally {
    await deleteTestUser(userId);
  }
});

async function saveFinalizedSite(
  token: string,
  measuredAt: string,
  siteCode: "waist" | "chest",
  readingsCm: [number, number],
): Promise<void> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/save-anthropometric-session`, {
    method: "POST",
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      status: "finalized",
      measured_at: measuredAt,
      protocol_version: "anthropometry_protocol_v1",
      idempotency_key: `gate3-e2e-${crypto.randomUUID()}`,
      sites: [{ site_code: siteCode, readings_cm: readingsCm }],
    }),
  });
  if (!response.ok) throw new Error(`Finalized fixture failed (${response.status}): ${await response.text()}`);
}

async function seedFutureProtocolChest(userId: string, measuredAt: string): Promise<void> {
  const db = new pg.Client({ connectionString: DB_URL });
  const sessionId = crypto.randomUUID();
  await db.connect();
  try {
    await db.query("BEGIN");
    await db.query(
      `INSERT INTO public.anthropometric_sessions
        (id, user_id, status, measured_at, data_contract_version, protocol_version)
       VALUES ($1, $2, 'draft', $3, 'anthropometry_data_contract_v2', 'anthropometry_protocol_future_v2')`,
      [sessionId, userId, measuredAt],
    );
    await db.query(
      `INSERT INTO public.anthropometric_readings
        (id, session_id, user_id, site_code, reading_number, value_cm)
       VALUES (gen_random_uuid(), $1, $2, 'chest', 1, 100),
              (gen_random_uuid(), $1, $2, 'chest', 2, 100.4)`,
      [sessionId, userId],
    );
    await db.query(
      `UPDATE public.anthropometric_sessions
       SET status = 'finalized', logged_date = ($2::timestamptz AT TIME ZONE 'UTC')::date,
           timezone = 'UTC', representative_algorithm_version = 'anthropometry_representative_v2',
           thresholds_version = 'anthropometry_repeatability_thresholds_v2',
           idempotency_key = $3, payload_hash = 'gate3-protocol-e2e', finalized_at = now()
       WHERE id = $1`,
      [sessionId, measuredAt, `gate3-protocol-${crypto.randomUUID()}`],
    );
    await db.query("SELECT set_config('app.anthropometry_finalizing_session', $1, true)", [sessionId]);
    await db.query(
      `INSERT INTO public.anthropometric_representatives
        (session_id, user_id, site_code, representative_cm, method, reading_count,
         initial_pair_difference_cm, all_readings_range_cm, quality, quality_flags, algorithm_version)
       VALUES ($1, $2, 'chest', 100.2, 'mean_of_two', 2, 0.4, 0.4,
         'within_repeatability_threshold', '[]'::jsonb, 'anthropometry_representative_v2')`,
      [sessionId, userId],
    );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    await db.end();
  }
}

test("real Phase 6 interval containing zero stays uncertain beside decreasing waist", async ({ page }) => {
  test.setTimeout(60_000);
  const email = testEmail("anthropometry-uncertain-interval");
  const userId = await createTestUser(email);
  try {
    const { session } = await signInAs(email);
    const end = new Date(Date.now() - 60 * 60_000);
    const start = new Date(end.getTime() - 28 * 86_400_000);
    await saveFinalizedSite(session.access_token, start.toISOString(), "waist", [92, 92.4]);
    await saveFinalizedSite(session.access_token, end.toISOString(), "waist", [89, 89.4]);

    const weights = Array.from({ length: 12 }, (_, index) => {
      const measuredAt = new Date(end.getTime() - (55 - index * 5) * 86_400_000);
      return {
        user_id: userId,
        weight_kg: index % 2 === 0 ? 80 : 80.1,
        measured_at: measuredAt.toISOString(),
        logged_date: measuredAt.toISOString().slice(0, 10),
        is_official: true,
        source: "manual",
      };
    });
    const { error: weightError } = await svcClient().from("weight_logs").insert(weights);
    if (weightError) throw weightError;

    await injectSession(page, session);
    await page.goto("/measurements");
    await page.getByRole("tab", { name: /history & trends/i }).click();
    await expect(page.getByText(/weight trend was broadly stable or uncertain while waist circumference decreased/i)).toBeVisible();
    await expect(page.getByText(/does not infer fat loss, muscle gain or body recomposition/i)).toBeVisible();
    await expect(page.getByText(/−3\.0 cm/).first()).toBeVisible();
  } finally {
    await deleteTestUser(userId);
  }
});

test("real incompatible protocols remain visible without an automatic change", async ({ page }) => {
  test.setTimeout(60_000);
  const email = testEmail("anthropometry-protocol-mismatch");
  const userId = await createTestUser(email);
  try {
    const { session } = await signInAs(email);
    const end = new Date(Date.now() - 60 * 60_000);
    await seedFutureProtocolChest(userId, new Date(end.getTime() - 30 * 86_400_000).toISOString());
    await saveFinalizedSite(session.access_token, end.toISOString(), "chest", [98, 98.4]);
    await injectSession(page, session);
    await page.goto("/measurements");
    await page.getByRole("tab", { name: /history & trends/i }).click();

    await expect(page.getByText(/different protocols and are shown separately/i)).toBeVisible();
    await expect(page.getByText("100.2 cm").first()).toBeVisible();
    await expect(page.getByText("98.2 cm").first()).toBeVisible();
    await expect(page.getByText("Not enough data")).toHaveCount(2);
  } finally {
    await deleteTestUser(userId);
  }
});

test("real browser measurement leaves active target and Phase 8 state unchanged", async ({ page }) => {
  test.setTimeout(60_000);
  const email = testEmail("anthropometry-non-interference");
  const userId = await createTestUser(email);
  try {
    const { session } = await signInAs(email);
    const service = svcClient();
    const phaseStart = new Date(Date.now() - 20 * 86_400_000).toISOString();
    const phaseResult = await service.from("goal_phases").insert({
      user_id: userId,
      mode: "maintenance",
      status: "active",
      started_at: phaseStart,
      starting_weight_kg: 80,
      starting_weight_source: "manual",
      target_change_kg_per_week: 0,
      target_calories: 2100,
    }).select("id").single();
    if (phaseResult.error) throw phaseResult.error;
    const feedbackResult = await service.from("goal_feedback_assessments").insert({
      user_id: userId,
      goal_phase_id: phaseResult.data.id,
      goal_mode: "maintenance",
      goal_phase_started_at: phaseStart,
      assessed_at: new Date(Date.now() - 60 * 60_000).toISOString(),
      progress_state: "insufficient_data",
      feedback_action: "collect_more_data",
      current_p6_status: "insufficient_data",
      current_p6_confidence: "low",
    });
    if (feedbackResult.error) throw feedbackResult.error;

    async function productState() {
      const [phase, feedback] = await Promise.all([
        service.from("goal_phases").select("id, mode, status, target_calories, target_change_kg_per_week").eq("user_id", userId).single(),
        service.from("goal_feedback_assessments").select("goal_phase_id, progress_state, feedback_action").eq("user_id", userId).single(),
      ]);
      if (phase.error) throw phase.error;
      if (feedback.error) throw feedback.error;
      return { phase: phase.data, feedback: feedback.data };
    }
    const before = await productState();

    await injectSession(page, session);
    await beginWaistSession(page);
    await enterReading(page, 1, "80.0");
    await enterReading(page, 2, "80.2");
    await page.getByRole("button", { name: /finalize session/i }).click();
    await expect(page.getByRole("heading", { name: /session finalized/i })).toBeVisible();
    expect(await productState()).toEqual(before);
  } finally {
    await deleteTestUser(userId);
  }
});
