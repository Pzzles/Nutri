// get-daily-log-status
// Returns daily_log_status rows for the authenticated user.
// Query params:
//   date        — single date "YYYY-MM-DD"; returns one row (or null)
//   from + to   — inclusive date range "YYYY-MM-DD"; returns array
//   (omit all)  — returns today's row based on the user's timezone
//
// Dates that have no row return status='unknown' (not an error).
// The client should never infer 'complete' from the absence of a row.

import { ok, fail, preflight } from "../_shared/envelope.ts";
import { getUserClient, getServiceClient } from "../_shared/supabaseClient.ts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayInZone(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const UNKNOWN_ROW = (date: string) => ({
  logged_date: date,
  status: "unknown",
  marked_complete_at: null,
  reopened_at: null,
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail("UNAUTHENTICATED", "Missing Authorization header", 401);

    const userClient = getUserClient(authHeader);
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return fail("UNAUTHENTICATED", "Invalid session", 401);
    const userId = userData.user.id;

    const url = new URL(req.url);
    const singleDate = url.searchParams.get("date");
    const fromDate = url.searchParams.get("from");
    const toDate = url.searchParams.get("to");

    const service = getServiceClient();

    // ── Single date ──────────────────────────────────────────────────────────
    if (singleDate) {
      if (!DATE_RE.test(singleDate)) {
        return fail("VALIDATION_ERROR", "date must be YYYY-MM-DD");
      }
      const { data: row } = await service
        .from("daily_log_status")
        .select("*")
        .eq("user_id", userId)
        .eq("logged_date", singleDate)
        .maybeSingle();

      return ok(row ?? UNKNOWN_ROW(singleDate));
    }

    // ── Date range ───────────────────────────────────────────────────────────
    if (fromDate || toDate) {
      if (!fromDate || !toDate) {
        return fail("VALIDATION_ERROR", "Supply both 'from' and 'to' for a range query");
      }
      if (!DATE_RE.test(fromDate) || !DATE_RE.test(toDate)) {
        return fail("VALIDATION_ERROR", "from and to must be YYYY-MM-DD");
      }
      if (fromDate > toDate) {
        return fail("VALIDATION_ERROR", "'from' must not be after 'to'");
      }

      const { data: rows, error: fetchErr } = await service
        .from("daily_log_status")
        .select("*")
        .eq("user_id", userId)
        .gte("logged_date", fromDate)
        .lte("logged_date", toDate)
        .order("logged_date", { ascending: true });

      if (fetchErr) {
        console.error(fetchErr);
        return fail("INTERNAL_ERROR", "Failed to fetch daily log statuses", 500);
      }

      return ok(rows ?? []);
    }

    // ── Default: today in user's timezone ────────────────────────────────────
    const { data: profile } = await service
      .from("profiles")
      .select("timezone")
      .eq("id", userId)
      .maybeSingle();

    const tz = profile?.timezone ?? "Africa/Johannesburg";
    const today = todayInZone(tz);

    const { data: row } = await service
      .from("daily_log_status")
      .select("*")
      .eq("user_id", userId)
      .eq("logged_date", today)
      .maybeSingle();

    return ok(row ?? UNKNOWN_ROW(today));
  } catch (err) {
    console.error(err);
    return fail("INTERNAL_ERROR", "Unexpected error fetching daily log status", 500);
  }
});
