// log-weight
// Logs a body-weight entry. Multiple entries per day are retained; the
// latest is flagged is_official for trend calculations (FR-042 AC2), via
// the atomic fn_log_weight RPC (defined in the migration).

import { ok, fail, preflight } from "../_shared/envelope.ts";
import { getUserClient, getServiceClient } from "../_shared/supabaseClient.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail("UNAUTHENTICATED", "Missing Authorization header", 401);
    const userClient = getUserClient(authHeader);
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return fail("UNAUTHENTICATED", "Invalid session", 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const weightKg = Number(body?.weight_kg);
    if (!(weightKg >= 20 && weightKg <= 300)) {
      return fail("VALIDATION_ERROR", "weight_kg must be between 20 and 300");
    }
    const measuredAt = new Date(body?.measured_at ?? Date.now());

    const service = getServiceClient();
    const { data: profile } = await service.from("profiles").select("timezone").eq("id", userId).single();
    const loggedDate = toLocalDateString(measuredAt, profile?.timezone ?? "UTC");

    const { data: id, error } = await service.rpc("fn_log_weight", {
      p_user_id: userId,
      p_weight_kg: weightKg,
      p_measured_at: measuredAt.toISOString(),
      p_logged_date: loggedDate,
      p_notes: body?.notes ?? null,
    });
    if (error) {
      console.error(error);
      return fail("INTERNAL_ERROR", "Failed to log weight", 500);
    }

    return ok({ id, logged_date: loggedDate });
  } catch (err) {
    console.error(err);
    return fail("INTERNAL_ERROR", "Unexpected error logging weight", 500);
  }
});

function toLocalDateString(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}
