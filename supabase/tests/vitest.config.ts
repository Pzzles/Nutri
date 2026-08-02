import { defineConfig } from "vitest/config";

// DB integration tests run against a real local Supabase instance.
// Requires: supabase start (port 54321)
// Set SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY via env
// or run: eval $(supabase status --output env) before executing tests.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**"],
    // Run files serially — each creates and destroys test users. Parallel
    // execution is safe but serial is easier to debug when something fails.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
