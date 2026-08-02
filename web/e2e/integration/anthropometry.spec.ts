import { expect, test, type Page } from "@playwright/test";
import type { Session } from "@supabase/supabase-js";
import {
  ANON_KEY,
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
      .select("id, status, representative_algorithm_version")
      .eq("user_id", userId)
      .order("measured_at");
    if (sessionsError) throw sessionsError;
    expect(sessions).toHaveLength(2);
    expect(sessions?.every((entry) => entry.status === "finalized")).toBe(true);
    expect(sessions?.every((entry) => entry.representative_algorithm_version === "anthropometry_representative_v2")).toBe(true);

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
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  } finally {
    await deleteTestUser(userId);
  }
});
