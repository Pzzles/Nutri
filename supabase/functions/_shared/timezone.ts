// Pure timezone utilities for the Nutrition Engine.
// No Supabase, Deno or network dependencies — safe to import in any test runner.
// Extracted from log-meal/index.ts so date derivation can be unit-tested.

/**
 * Derive a YYYY-MM-DD date string in the user's local timezone from a UTC Date.
 *
 * The en-CA locale produces YYYY-MM-DD format, which matches PostgreSQL's `date`
 * literal format exactly. The derived date is intentionally frozen at insert time
 * and never recomputed if the user's timezone changes later (FR-040 AC3).
 */
export function toLocalDateString(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}
