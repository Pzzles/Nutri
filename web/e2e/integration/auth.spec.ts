import { createClient, type Session } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { ANON_KEY, SUPABASE_URL, svcClient, testEmail } from "./helpers";

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false },
} as const;

function runtimePassword(): string {
  return `E2e-${crypto.randomUUID()}-aA1!`;
}

function authStorageKey(): string {
  const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0];
  return `sb-${projectRef}-auth-token`;
}

async function injectSession(page: Page, session: Session): Promise<void> {
  await page.addInitScript(
    ({ storageKey, storedSession }) => {
      localStorage.setItem(storageKey, JSON.stringify(storedSession));
    },
    { storageKey: authStorageKey(), storedSession: session },
  );
}

async function findUserId(email: string): Promise<string | null> {
  const { data, error } = await svcClient().auth.admin.listUsers({ page: 1, perPage: 1_000 });
  if (error) throw error;
  return data.users.find((user) => user.email === email)?.id ?? null;
}

async function deleteUserIfPresent(userId: string | null): Promise<void> {
  if (!userId) return;
  const { error } = await svcClient().auth.admin.deleteUser(userId);
  if (error) throw error;
}

test("new user can sign up, restore the session, sign out and sign back in", async ({ page }) => {
  const email = testEmail("auth-browser");
  let password = runtimePassword();
  let userId: string | null = null;

  try {
    await page.goto("/");
    await expect(page.getByText("Sign in to continue.")).toBeVisible();

    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.locator("form").getByRole("button", { name: "Create account" }).click();

    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    userId = await findUserId(email);
    expect(userId).not.toBeNull();

    await page.goto("/account");
    await expect(page.getByText(email)).toBeVisible();
    await page.reload();
    await expect(page.getByText(email)).toBeVisible();

    const updatedPassword = runtimePassword();
    await page.getByRole("button", { name: "Set or change password" }).click();
    await page.getByLabel("New password", { exact: true }).fill(updatedPassword);
    await page.getByLabel("Confirm new password").fill(updatedPassword);
    await page.getByRole("button", { name: "Save password" }).click();
    await expect(page.getByText("Password saved.")).toBeVisible();
    password = updatedPassword;

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByText("Sign in to continue.")).toBeVisible();

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.locator("form").getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText(email)).toBeVisible();
  } finally {
    userId ??= await findUserId(email);
    await deleteUserIfPresent(userId);
  }
});

test("anonymous user can add a password without changing user ID or losing data", async ({ page }) => {
  const authClient = createClient(SUPABASE_URL, ANON_KEY, clientOptions);
  const email = testEmail("auth-upgrade");
  const password = runtimePassword();
  const { data: anonymousData, error: anonymousError } = await authClient.auth.signInAnonymously();
  if (anonymousError) throw anonymousError;
  if (!anonymousData.session || !anonymousData.user) throw new Error("Anonymous session was not created");

  const userId = anonymousData.user.id;

  try {
    const { error: weightError } = await svcClient().from("weight_logs").insert({
      user_id: userId,
      weight_kg: 82.4,
      measured_at: "2026-08-02T08:00:00.000Z",
      logged_date: "2026-08-02",
      is_official: true,
      notes: "authenticated upgrade sentinel",
    });
    if (weightError) throw weightError;

    await injectSession(page, anonymousData.session);
    await page.goto("/account");
    await expect(page.getByText(/device-only account/i)).toBeVisible();

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.locator("form").getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText(email)).toBeVisible();

    const { data: weights, error: readError } = await svcClient()
      .from("weight_logs")
      .select("user_id, notes")
      .eq("user_id", userId)
      .eq("notes", "authenticated upgrade sentinel");
    if (readError) throw readError;
    expect(weights).toEqual([{ user_id: userId, notes: "authenticated upgrade sentinel" }]);

    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.locator("form").getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText(email)).toBeVisible();

    const signedIn = await createClient(SUPABASE_URL, ANON_KEY, clientOptions).auth.signInWithPassword({
      email,
      password,
    });
    if (signedIn.error) throw signedIn.error;
    expect(signedIn.data.user.id).toBe(userId);
  } finally {
    await deleteUserIfPresent(userId);
  }
});
