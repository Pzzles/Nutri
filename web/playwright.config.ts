import { defineConfig, devices } from "@playwright/test";

// In CI, SUPABASE_URL and SUPABASE_ANON_KEY are set after `supabase start`.
// Pass them through so the Vite dev server picks them up as VITE_* vars.
// Locally, .env.local already has the values — no override needed.
const supabaseEnv: Record<string, string> = {};
if (process.env.SUPABASE_URL) supabaseEnv.VITE_SUPABASE_URL = process.env.SUPABASE_URL;
if (process.env.SUPABASE_ANON_KEY) supabaseEnv.VITE_SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    ...(Object.keys(supabaseEnv).length > 0 && { env: supabaseEnv }),
  },
});
