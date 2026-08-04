import { expect, test, type Page } from "@playwright/test";
import fixture from "../../src/fixtures/authenticatedProgressPersonas.json" with { type: "json" };

async function expectMaintenanceLoaded(page: Page) {
  const heading = page.getByRole("heading", { name: "Observed Maintenance" });
  const errorCard = page.getByTestId("maintenance-card-error");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await expect(heading.or(errorCard).first()).toBeVisible({ timeout: 15_000 });
    if (await heading.isVisible()) return;

    await expect(errorCard).toContainText(/Failed to fetch|Unexpected end of JSON input/);
    if (attempt < 2) await errorCard.getByRole("button", { name: "Try again" }).click();
  }

  await expect(heading).toBeVisible();
}

async function expectGoalFeedbackLoaded(page: Page) {
  const card = page.getByTestId("goal-feedback-card");
  const errorCard = page.getByTestId("goal-feedback-card-error");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await expect(card.or(errorCard).first()).toBeVisible({ timeout: 15_000 });
    if (await card.isVisible()) return;

    await expect(errorCard).toContainText(/Failed to fetch|Unexpected end of JSON input/);
    if (attempt < 2) await errorCard.getByRole("button", { name: "Try again" }).click();
  }

  await expect(card).toBeVisible();
}

test.describe("authenticated progress personas", () => {
  test.skip(
    process.env.E2E_VITE_MODE !== "personas",
    "Set E2E_VITE_MODE=personas after seeding the authenticated persona suite.",
  );

  test("development selector exposes all ten safe persona labels", async ({ page }) => {
    await page.goto("/");
    const selector = page.getByLabel("Test persona (development only)");
    await expect(selector).toBeVisible();
    await expect(selector.locator("option")).toHaveCount(fixture.personas.length + 1);
    for (const persona of fixture.personas) {
      await expect(selector.locator(`option[value="${persona.id}"]`)).toHaveText(persona.selector_label);
    }
  });

  for (const persona of fixture.personas) {
    test(`${persona.selector_label} signs in and opens Maintenance`, async ({ page }) => {
      await page.goto("/");
      await page.getByLabel("Test persona (development only)").selectOption(persona.id);

      await expect(page).toHaveURL(/\/progress\?tab=maintenance$/);
      await expect(page.getByRole("tab", { name: "Maintenance" })).toHaveAttribute("aria-selected", "true");
      await expectMaintenanceLoaded(page);

      if (persona.expected_goal_feedback_state === "faster_than_planned") {
        await page.getByRole("tab", { name: "Feedback" }).click();
        await expectGoalFeedbackLoaded(page);
        await expect(page.getByTestId("state-headline")).toHaveText("Faster than planned");
        await expect(page.getByTestId("feedback-action")).toContainText(
          persona.expected_feedback_action === "consider_less_aggressive_goal"
            ? "Consider a less aggressive goal"
            : "Review your goal setup",
        );
      }

      await page.getByRole("link", { name: "Account" }).click();
      await page.getByRole("button", { name: "Sign out" }).click();
      await expect(page.getByText("Sign in to continue.")).toBeVisible();
    });
  }
});
