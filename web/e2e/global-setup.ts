// Playwright global setup — runs once before all test projects.
// Prints non-secret effective environment values so that test failures
// can be correlated with the exact configuration that produced them.
import { FullConfig } from "@playwright/test";

export default async function globalSetup(_config: FullConfig) {
  const url =
    process.env.SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL ??
    "http://localhost:54421 (default)";

  const host = (() => {
    try { return new URL(url).host; } catch { return url; }
  })();

  // The anon key is safe to log (it is embeddable in client-side JS by design).
  const anonKeyHint = process.env.SUPABASE_ANON_KEY
    ? `${process.env.SUPABASE_ANON_KEY.slice(0, 12)}… (${process.env.SUPABASE_ANON_KEY.length} chars)`
    : "eyJhbGci… (default local dev key)";

  console.log("\n── E2E environment ─────────────────────────────────────────");
  console.log(`  Platform      : ${process.platform}`);
  console.log(`  Node          : ${process.version}`);
  console.log(`  Supabase host : ${host}`);
  console.log(`  Anon key      : ${anonKeyHint}`);
  console.log(`  Base URL      : ${_config.projects[0]?.use?.baseURL ?? "http://localhost:5173"}`);
  console.log(`  Groq API key  : ${process.env.GROQ_API_KEY ? "set" : "NOT SET — parse-meal will fail"}`);
  console.log("─────────────────────────────────────────────────────────────\n");

  if (!process.env.GROQ_API_KEY) {
    console.warn(
      "WARNING: GROQ_API_KEY is not set. The full meal flow test will fail at the parse-meal step.\n" +
      "Set it with: $env:GROQ_API_KEY = '<key>'  (PowerShell) or export GROQ_API_KEY=<key>  (bash)\n",
    );
  }
}
