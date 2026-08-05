// Playwright global setup — runs once before all test projects.
// Prints non-secret effective environment values so that test failures
// can be correlated with the exact configuration that produced them.
import { FullConfig } from "@playwright/test";

export default async function globalSetup(_config: FullConfig) {
  const url =
    process.env.SUPABASE_URL ??
    process.env.API_URL ??
    process.env.VITE_SUPABASE_URL ??
    "http://127.0.0.1:54421 (default)";

  const host = (() => {
    try { return new URL(url).host; } catch { return url; }
  })();

  // The anon key is safe to log (it is embeddable in client-side JS by design).
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.ANON_KEY;
  const anonKeyHint = anonKey
    ? `${anonKey.slice(0, 12)}… (${anonKey.length} chars)`
    : "eyJhbGci… (default local dev key)";

  console.log("\n── E2E environment ─────────────────────────────────────────");
  console.log(`  Platform      : ${process.platform}`);
  console.log(`  Node          : ${process.version}`);
  console.log(`  Supabase host : ${host}`);
  console.log(`  Anon key      : ${anonKeyHint}`);
  console.log(`  Base URL      : ${_config.projects[0]?.use?.baseURL ?? "http://localhost:5173"}`);
  console.log(`  Groq API key  : ${process.env.GROQ_API_KEY ? "set" : "NOT SET — external parse test skipped"}`);
  console.log("─────────────────────────────────────────────────────────────\n");

  if (!process.env.GROQ_API_KEY) {
    console.warn(
      "WARNING: GROQ_API_KEY is not set. The external full meal flow test will be skipped.\n" +
      "Set it with: $env:GROQ_API_KEY = '<key>'  (PowerShell) or export GROQ_API_KEY=<key>  (bash)\n",
    );
  }
}
