import { defineConfig, devices } from "@playwright/test";

// In CI, SUPABASE_URL and SUPABASE_ANON_KEY are set after `supabase start`.
// Pass them through so the Vite dev server picks them up as VITE_* vars.
// Locally, .env.local already has the values — no override needed.
const supabaseEnv: Record<string, string> = {};
if (process.env.SUPABASE_URL) supabaseEnv.VITE_SUPABASE_URL = process.env.SUPABASE_URL;
if (process.env.SUPABASE_ANON_KEY) supabaseEnv.VITE_SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const vitePort = new URL(baseURL).port || "5173";
const viteMode = process.env.E2E_VITE_MODE;
if (viteMode && !/^[a-z0-9_-]+$/i.test(viteMode)) {
  throw new Error("E2E_VITE_MODE contains unsupported characters.");
}
const viteModeArgument = viteMode ? ` --mode ${viteMode}` : "";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    // ── Mocked tests: network-intercepted, no real Supabase needed ─────────────
    {
      name: "mocked",
      testMatch: ["edition-1/**/*.spec.ts", "weight-logging.spec.ts", "anthropometry-measurement.spec.ts", "anthropometry-trends.spec.ts"],
      use: { ...devices["Desktop Chrome"] },
    },
    // ── Integration tests: real Supabase + real edge functions ─────────────────
    // Requires: supabase start + GROQ_API_KEY set in the edge function env.
    {
      name: "integration",
      testMatch: "integration/**/*.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${vitePort}${viteModeArgument}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    ...(Object.keys(supabaseEnv).length > 0 && { env: supabaseEnv }),
  },
});
