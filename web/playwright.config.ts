import { defineConfig, devices } from "@playwright/test";

// Supabase CLI JSON uses API_URL/ANON_KEY, while some local shells expose the
// SUPABASE_* aliases. Always override .env.local: mocked tests get inert
// placeholders and integration tests get the explicitly exported local values.
const supabaseEnv: Record<string, string> = {
  VITE_SUPABASE_URL:
    process.env.SUPABASE_URL ?? process.env.API_URL ?? "http://127.0.0.1:54421",
  VITE_SUPABASE_ANON_KEY:
    process.env.SUPABASE_ANON_KEY ?? process.env.ANON_KEY ??
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
};
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
      // The local Kong/Edge Runtime can occasionally return an empty response
      // during a function cold start. Keep assertions intact and retry the
      // complete real request once before treating it as a product failure.
      retries: 1,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run dev:test -- --port ${vitePort}${viteModeArgument}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: supabaseEnv,
  },
});
