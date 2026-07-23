import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Makes `import { ... } from "@shared/portionUnits"` resolve to the
      // actual Supabase Edge Function shared modules. No code duplication.
      "@shared": resolve(__dirname, "../supabase/functions/_shared"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
    exclude: ["**/node_modules/**", "e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: [
        "src/**/*.{ts,tsx}",
        "../supabase/functions/_shared/**/*.ts",
      ],
      exclude: [
        "src/__tests__/**",
        "src/vite-env.d.ts",
        "../supabase/functions/_shared/supabaseClient.ts",
        "../supabase/functions/_shared/fatsecret.ts",
        "../supabase/functions/_shared/usda.ts",
        "../supabase/functions/_shared/envelope.ts",
      ],
      thresholds: {
        // Pure portion/nutrition modules — high confidence required
        "100": {
          lines: 90,
          branches: 90,
          functions: 90,
        },
      },
    },
  },
});
