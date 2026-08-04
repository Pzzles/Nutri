import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import {
  ANON_KEY,
  SUPABASE_URL,
  createTestUser,
  deleteTestUser,
  injectSession,
  signInAs,
  svcClient,
  testEmail,
} from "./helpers";

const EVIDENCE_DIR = path.resolve("../docs/testing/evidence/phase-10");
const DAY_MS = 86_400_000;
test.describe.configure({ timeout: 120_000 });

async function authenticatedPage(page: Page, label: string) {
  const email = testEmail(label);
  const userId = await createTestUser(email);
  const { session } = await signInAs(email);
  await injectSession(page, session);
  return { email, userId, session };
}

async function saveSession(
  token: string,
  measuredAt: string,
  sites: Array<{ site_code: string; readings_cm: number[] }>,
  measurementContext?: Record<string, unknown>,
) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/save-anthropometric-session`, {
    method: "POST",
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      status: "finalized",
      measured_at: measuredAt,
      protocol_version: "anthropometry_protocol_v1",
      idempotency_key: `gate4-${crypto.randomUUID()}`,
      measurement_context: measurementContext,
      sites,
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Session fixture failed (${response.status}): ${JSON.stringify(body)}`);
  return body.data as { session: { id: string } };
}

async function beginWithSites(page: Page, siteNames: RegExp[]) {
  await page.goto("/measurements");
  await page.getByRole("button", { name: "Clear" }).click();
  for (const name of siteNames) await page.getByRole("checkbox", { name }).check();
  await page.getByRole("checkbox", { name: /reviewed the preparation/i }).check();
  await page.getByRole("button", { name: new RegExp(`Begin with ${siteNames.length} site`) }).click();
}

async function enter(page: Page, reading: number, value: string) {
  const input = page.getByRole("spinbutton", { name: new RegExp(`Reading ${reading} in`, "i") });
  await input.fill(value);
  const saved = page.waitForResponse((response) =>
    response.url().includes("/functions/v1/save-anthropometric-session") &&
    response.request().method() === "POST"
  );
  await input.press("Enter");
  expect((await saved).ok()).toBe(true);
  await expect(page.getByRole("button", { name: /saving|checking consistency/i })).toHaveCount(0);
}

async function assertNoSeriousAxe(page: Page, scenario: string) {
  const result = await new AxeBuilder({ page }).analyze();
  const blockers = result.violations.filter((violation) =>
    violation.impact === "critical" || violation.impact === "serious"
  );
  await test.info().attach(`axe-${scenario}`, {
    body: JSON.stringify({
      scenario,
      blockers,
      moderate_or_minor: result.violations.filter((violation) =>
        violation.impact === "moderate" || violation.impact === "minor"
      ),
    }, null, 2),
    contentType: "application/json",
  });
  expect(blockers, `${scenario} axe blockers`).toEqual([]);
}

test("Flow 2: real third reading selects readings 1 and 3 and persists 82.15 cm", async ({ page }) => {
  const { userId } = await authenticatedPage(page, "gate4-closest-pair");
  try {
    await beginWithSites(page, [/^Waist \(WHO midpoint\)/i]);
    await enter(page, 1, "82.0");
    await enter(page, 2, "84.0");
    await expect(page.getByRole("status")).toContainText(/first two readings differed/i);
    await assertNoSeriousAxe(page, "third-reading-warning");
    await enter(page, 3, "82.3");
    await expect(page.getByText(/one reading was isolated/i)).toBeVisible();
    await assertNoSeriousAxe(page, "isolated-reading-warning");
    await page.getByRole("button", { name: /continue with agreeing pair/i }).click();
    await page.getByRole("button", { name: /finalize session/i }).click();
    await expect(page.getByRole("heading", { name: /session finalized/i })).toBeVisible();

    const ids = (await svcClient().from("anthropometric_sessions").select("id").eq("user_id", userId)).data!.map((row) => row.id);
    const { data, error } = await svcClient().from("anthropometric_representatives")
      .select("representative_cm, selected_reading_indices, source_reading_ids, unselected_reading_id")
      .in("session_id", ids).single();
    if (error) throw error;
    expect(Number(data.representative_cm)).toBe(82.15);
    expect(data.selected_reading_indices).toEqual([1, 3]);
    expect(data.source_reading_ids).toHaveLength(2);
    expect(data.unselected_reading_id).toBeTruthy();
  } finally {
    await deleteTestUser(userId);
  }
});

test("Flows 6-8: waist, navel and bilateral limbs remain separate and inches persist as cm", async ({ page }) => {
  const { userId } = await authenticatedPage(page, "gate4-multi-site");
  try {
    await beginWithSites(page, [
      /^Waist \(WHO midpoint\)/i,
      /^Abdomen at navel/i,
      /^Left relaxed upper arm/i,
      /^Right relaxed upper arm/i,
    ]);
    await page.getByRole("button", { name: "inches" }).click();
    for (const value of ["31.50", "35.43", "12.60", "12.99"]) await enter(page, 1, value);
    for (const value of ["31.65", "35.59", "12.68", "13.07"]) await enter(page, 2, value);
    await page.getByRole("button", { name: /finalize session/i }).click();
    await expect(page.getByRole("heading", { name: /session finalized/i })).toBeVisible();

    const sessionId = (await svcClient().from("anthropometric_sessions").select("id").eq("user_id", userId).single()).data!.id;
    const { data, error } = await svcClient().from("anthropometric_representatives")
      .select("site_code, representative_cm").eq("session_id", sessionId).order("site_code");
    if (error) throw error;
    expect(data.map((row) => row.site_code).sort()).toEqual([
      "abdomen_navel", "left_upper_arm_relaxed", "right_upper_arm_relaxed", "waist",
    ]);
    expect(data.every((row) => Number.isFinite(Number(row.representative_cm)))).toBe(true);

    await page.getByRole("button", { name: /view history/i }).click();
    const site = page.getByRole("combobox", { name: /measurement site/i });
    for (const code of ["waist", "abdomen_navel", "left_upper_arm_relaxed", "right_upper_arm_relaxed"]) {
      await site.selectOption(code);
      await expect(site).toHaveValue(code);
    }
    await site.selectOption("abdomen_navel");
    await expect(page.getByText(/not the WHO waist measurement/i)).toBeVisible();
  } finally {
    await deleteTestUser(userId);
  }
});

test("Flow 11: real sporadic history displays only three recorded points", async ({ page }) => {
  const { userId, session } = await authenticatedPage(page, "gate4-sparse");
  try {
    const end = new Date(Date.now() - 60 * 60_000);
    for (const [days, value] of [[113, 94], [47, 91], [0, 89]] as const) {
      await saveSession(session.access_token, new Date(end.getTime() - days * DAY_MS).toISOString(), [
        { site_code: "waist", readings_cm: [value, value + 0.4] },
      ]);
    }
    await page.goto("/measurements");
    await page.getByRole("tab", { name: /history & trends/i }).click();
    await expect(page.getByRole("img", { name: /3 recorded points.*no smoothing or interpolated values/i })).toBeVisible();
    await expect(page.getByText(/recorded points only.*no smoothing, interpolation or filled-in dates/i)).toBeVisible();
    await expect(page.getByText(/finalized representative/i)).toHaveCount(3);
  } finally {
    await deleteTestUser(userId);
  }
});

test("Flows 14-15: authenticated export contains only owner data and cross-user deletion is rejected", async ({ page }) => {
  const owner = await authenticatedPage(page, "gate4-export-owner");
  const otherEmail = testEmail("gate4-export-other");
  const otherUserId = await createTestUser(otherEmail);
  try {
    const { session: otherSession } = await signInAs(otherEmail);
    const ownerSaved = await saveSession(owner.session.access_token, new Date(Date.now() - 60 * 60_000).toISOString(), [
      { site_code: "waist", readings_cm: [88, 88.4] },
    ], { meal_timing: "before_food", after_bathroom: true, exercise_within_previous_12_hours: false, measurement_assistance: "self", clothing_level: "minimal" });
    const otherSaved = await saveSession(otherSession.access_token, new Date(Date.now() - 60 * 60_000).toISOString(), [
      { site_code: "waist", readings_cm: [99, 99.4] },
    ]);

    await page.goto("/account");
    await expect(page.getByRole("heading", { name: /^Account$/i })).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /download my data/i }).click();
    const download = await downloadPromise;
    const exportPath = await download.path();
    if (!exportPath) throw new Error("Export download did not produce a file");
    const exported = JSON.parse(await fs.readFile(exportPath, "utf8"));
    expect(exported.export_version).toBe("nutri_data_export_v3");
    expect(exported.data.anthropometric_sessions.map((row: { id: string }) => row.id)).toContain(ownerSaved.session.id);
    expect(exported.data.anthropometric_sessions.map((row: { id: string }) => row.id)).not.toContain(otherSaved.session.id);
    expect(exported.data.anthropometric_sessions[0].measurement_context).toMatchObject({ meal_timing: "before_food" });
    expect(exported.data.anthropometric_representatives[0].source_reading_ids).toHaveLength(2);

    const crossUser = await page.evaluate(async ({ url, sessionId, token, apikey }) => {
      const response = await fetch(`${url}/functions/v1/delete-anthropometric-session`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey },
        body: JSON.stringify({ session_id: sessionId }),
      });
      return { status: response.status, body: await response.json() };
    }, { url: SUPABASE_URL, sessionId: otherSaved.session.id, token: owner.session.access_token, apikey: ANON_KEY });
    expect(crossUser.status).toBe(404);
    expect(crossUser.body.error.code).toBe("SESSION_NOT_FOUND");
  } finally {
    await deleteTestUser(owner.userId);
    await deleteTestUser(otherUserId);
  }
});

test("Flow 16: populated account deletion removes auth and anthropometry through the real UI", async ({ page }) => {
  const account = await authenticatedPage(page, "gate4-account-delete");
  let deleted = false;
  try {
    await saveSession(account.session.access_token, new Date(Date.now() - 60 * 60_000).toISOString(), [
      { site_code: "waist", readings_cm: [88, 88.4] },
    ]);
    await page.goto("/account");
    await page.getByRole("button", { name: /delete my account/i }).click();
    await assertNoSeriousAxe(page, "account-deletion-confirmation");
    await page.getByPlaceholder("DELETE MY ACCOUNT").fill("DELETE MY ACCOUNT");
    await page.getByRole("button", { name: /permanently delete/i }).click();
    await expect(page.getByRole("heading", { name: /account deleted/i })).toBeVisible();
    deleted = true;

    const [auth, sessions, readings, representatives] = await Promise.all([
      svcClient().auth.admin.getUserById(account.userId),
      svcClient().from("anthropometric_sessions").select("id").eq("user_id", account.userId),
      svcClient().from("anthropometric_readings").select("id").eq("user_id", account.userId),
      svcClient().from("anthropometric_representatives").select("session_id").eq("user_id", account.userId),
    ]);
    expect(auth.error).toBeTruthy();
    expect(sessions.data).toHaveLength(0);
    expect(readings.data).toHaveLength(0);
    expect(representatives.data).toHaveLength(0);
  } finally {
    if (!deleted) await deleteTestUser(account.userId);
  }
});

test("Gate 4 draft recovery resumes one owner-scoped draft and resets acknowledgement", async ({ page }) => {
  const account = await authenticatedPage(page, "gate4-draft-recovery");
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/save-anthropometric-session`, {
      method: "POST",
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${account.session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "draft",
        measured_at: new Date(Date.now() - 60 * 60_000).toISOString(),
        notes: "Synthetic draft",
        protocol_version: "anthropometry_protocol_v1",
        measurement_context: { meal_timing: "after_food", after_bathroom: false, exercise_within_previous_12_hours: true, measurement_assistance: "assisted", clothing_level: "light" },
        sites: [{ site_code: "waist", readings_cm: [80, 82, 84.5] }],
      }),
    });
    const saved = await response.json();
    expect(response.ok).toBe(true);

    await page.goto("/measurements");
    await expect(page.getByRole("heading", { name: /saved measurement draft/i })).toBeVisible();
    await page.getByRole("button", { name: "Resume" }).click();
    await expect(page.getByText(/measurement confidence: low/i)).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /understand this value has low measurement confidence/i })).not.toBeChecked();
    await expect(page.getByRole("button", { name: /save with low confidence/i })).toBeDisabled();
    const { data: sessions, error } = await svcClient().from("anthropometric_sessions")
      .select("id, status, meal_timing, measurement_assistance, clothing_level").eq("user_id", account.userId);
    if (error) throw error;
    expect(sessions).toEqual([expect.objectContaining({
      id: saved.data.session.id,
      status: "draft",
      meal_timing: "after_food",
      measurement_assistance: "assisted",
      clothing_level: "light",
    })]);
  } finally {
    await deleteTestUser(account.userId);
  }
});

test("Gate 4 axe matrix covers the core measurement, history, export and deletion states", async ({ page }) => {
  test.setTimeout(120_000);
  const account = await authenticatedPage(page, "gate4-axe");
  try {
    await page.goto("/measurements");
    await expect(page.getByRole("button", { name: "Clear" })).toBeVisible();
    await assertNoSeriousAxe(page, "measurement-selection");
    await page.getByRole("button", { name: "Clear" }).click();
    await page.getByRole("checkbox", { name: /^Waist \(WHO midpoint\)/i }).check();
    await page.getByRole("checkbox", { name: /reviewed the preparation/i }).check();
    await page.getByRole("button", { name: /begin with 1 site/i }).click();
    await assertNoSeriousAxe(page, "guided-reading-entry");
    await enter(page, 1, "80.0");
    await enter(page, 2, "82.0");
    await enter(page, 3, "84.5");
    await expect(page.getByText(/measurement confidence: low/i)).toBeVisible();
    await assertNoSeriousAxe(page, "high-variability-confirmation");
    await page.getByRole("checkbox", { name: /understand this value has low measurement confidence/i }).check();
    await page.getByRole("button", { name: /save with low confidence/i }).click();
    await page.getByRole("button", { name: /finalize session/i }).click();
    await expect(page.getByRole("heading", { name: /session finalized/i })).toBeVisible();
    await assertNoSeriousAxe(page, "finalized-session");
    await page.getByRole("button", { name: /view history/i }).click();
    await expect(page.getByRole("heading", { name: /circumference trend/i })).toBeVisible();
    await assertNoSeriousAxe(page, "history-chart-and-text-alternative");
    await page.getByText(/context, raw readings and calculation provenance/i).click();
    await assertNoSeriousAxe(page, "context-detail");
    const deleteTrigger = page.getByRole("button", { name: /delete this session/i });
    await deleteTrigger.click();
    await assertNoSeriousAxe(page, "delete-session-confirmation");
    await page.keyboard.press("Escape");

    await page.goto("/account");
    await expect(page.getByRole("button", { name: /download my data/i })).toBeVisible();
    await assertNoSeriousAxe(page, "export-controls");
    await page.getByRole("button", { name: /delete my account/i }).click();
    await assertNoSeriousAxe(page, "account-deletion");
  } finally {
    await deleteTestUser(account.userId);
  }
});

test("Gate 4 keyboard-only workflow and modal focus behavior", async ({ page }) => {
  const account = await authenticatedPage(page, "gate4-keyboard");
  try {
    await page.goto("/measurements");
    const clear = page.getByRole("button", { name: "Clear" });
    await clear.focus();
    await page.keyboard.press("Enter");
    const waist = page.getByRole("checkbox", { name: /^Waist \(WHO midpoint\)/i });
    await waist.focus();
    await page.keyboard.press("Space");
    const prepared = page.getByRole("checkbox", { name: /reviewed the preparation/i });
    await prepared.focus();
    await page.keyboard.press("Space");
    const begin = page.getByRole("button", { name: /begin with 1 site/i });
    await begin.focus();
    await page.keyboard.press("Enter");

    await expect(page.getByRole("spinbutton", { name: /reading 1/i })).toBeFocused();
    await page.keyboard.type("80.0");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("spinbutton", { name: /reading 2/i })).toBeFocused();
    await page.keyboard.type("82.0");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("spinbutton", { name: /reading 3/i })).toBeFocused();
    await page.keyboard.type("84.5");
    await page.keyboard.press("Enter");
    const acknowledgement = page.getByRole("checkbox", { name: /understand this value has low measurement confidence/i });
    await acknowledgement.focus();
    await page.keyboard.press("Space");
    const saveLow = page.getByRole("button", { name: /save with low confidence/i });
    await saveLow.focus();
    await page.keyboard.press("Enter");
    const finalize = page.getByRole("button", { name: /finalize session/i });
    await finalize.focus();
    await page.keyboard.press("Enter");
    const history = page.getByRole("button", { name: /view history/i });
    await history.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: /circumference trend/i })).toBeVisible();

    const deleteTrigger = page.getByRole("button", { name: /delete this session/i });
    await deleteTrigger.focus();
    await page.keyboard.press("Enter");
    const keep = page.getByRole("button", { name: /keep session/i });
    const remove = page.getByRole("button", { name: /^delete session$/i });
    await expect(keep).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(remove).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(keep).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(deleteTrigger).toBeFocused();
  } finally {
    await deleteTestUser(account.userId);
  }
});

test("Gate 4 responsive guided/history matrix captures every required viewport", async ({ page }) => {
  test.setTimeout(120_000);
  const account = await authenticatedPage(page, "gate4-responsive");
  const viewports = [
    { width: 360, height: 640, name: "360x640" },
    { width: 390, height: 844, name: "390x844" },
    { width: 412, height: 915, name: "412x915" },
    { width: 768, height: 1024, name: "768x1024" },
    { width: 1440, height: 900, name: "1440x900" },
  ];
  try {
    await fs.mkdir(EVIDENCE_DIR, { recursive: true });
    const end = new Date(Date.now() - 60 * 60_000);
    await saveSession(account.session.access_token, new Date(end.getTime() - 28 * DAY_MS).toISOString(), [
      { site_code: "waist", readings_cm: [92, 92.4] },
    ]);
    await saveSession(account.session.access_token, end.toISOString(), [
      { site_code: "waist", readings_cm: [89, 89.4] },
    ]);

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: "reduce", colorScheme: viewport.width === 412 ? "dark" : "light" });
      await page.goto("/measurements");
      await expect(page.getByRole("button", { name: "Clear" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await page.screenshot({ path: path.join(EVIDENCE_DIR, `guided-${viewport.name}.png`), fullPage: true });

      await page.getByRole("tab", { name: /history & trends/i }).click();
      await expect(page.getByRole("img", { name: /2 recorded points/i })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      const chart = await page.getByTestId("anthropometry-chart").boundingBox();
      expect(chart).not.toBeNull();
      expect(chart!.width).toBeLessThanOrEqual(viewport.width);
      await page.screenshot({ path: path.join(EVIDENCE_DIR, `history-${viewport.name}.png`), fullPage: true });

      const trigger = page.getByRole("button", { name: /delete this session/i }).first();
      await trigger.click();
      const dialog = await page.getByRole("alertdialog").boundingBox();
      expect(dialog).not.toBeNull();
      expect(dialog!.width).toBeLessThanOrEqual(viewport.width - 16);
      expect(dialog!.height).toBeLessThanOrEqual(viewport.height - 16);
      await page.keyboard.press("Escape");
    }
  } finally {
    await deleteTestUser(account.userId);
  }
});
