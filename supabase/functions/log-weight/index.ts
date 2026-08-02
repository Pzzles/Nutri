// log-weight
// Logs a body-weight entry. Multiple entries per day are retained; the
// latest is flagged is_official=true via the atomic fn_log_weight RPC,
// which demotes earlier same-day entries to is_official=false (FR-042 AC2).
//
// Body: { weight_kg: number, measured_at?: string (ISO), notes?: string }
// logged_date is derived from measured_at in the user's profile timezone.

import { ok, fail, preflight } from "../_shared/envelope.ts";
import { getUserClient, getServiceClient } from "../_shared/supabaseClient.ts";
import { toLocalDateString } from "../_shared/timezone.ts";

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

    // ── Validate weight_kg ───────────────────────────────────────────────────
    if (body.weight_kg == null) return fail("VALIDATION_ERROR", "weight_kg is required");
    const weightKg = Number(body.weight_kg);
    if (isNaN(weightKg) || weightKg < 1 || weightKg > 500) {
      return fail("VALIDATION_ERROR", "weight_kg must be between 1 and 500");
    }

    // ── Resolve measured_at ──────────────────────────────────────────────────
    const measuredAt = body.measured_at ? new Date(body.measured_at) : new Date();
    if (isNaN(measuredAt.getTime())) {
      return fail("VALIDATION_ERROR", "measured_at must be a valid ISO timestamp");
    }

    // ── Notes ────────────────────────────────────────────────────────────────
    const notes: string | null = body.notes?.trim() ?? null;
    if (notes && notes.length > 500) {
      return fail("VALIDATION_ERROR", "notes must be 500 characters or fewer");
    }

    const service = getServiceClient();

    // Derive logged_date in the user's own timezone (mirrors log-meal).
    const { data: profile } = await service
      .from("profiles")
      .select("timezone")
      .eq("id", userId)
      .maybeSingle();
    const timezone = profile?.timezone ?? "Africa/Johannesburg";
    const loggedDate = toLocalDateString(measuredAt, timezone);

    // ── Persist via atomic RPC ───────────────────────────────────────────────
    const { data: newId, error: rpcErr } = await service.rpc("fn_log_weight", {
      p_user_id: userId,
      p_weight_kg: weightKg,
      p_measured_at: measuredAt.toISOString(),
      p_logged_date: loggedDate,
      p_notes: notes,
      p_source: "manual",
    });

    if (rpcErr) {
      console.error(rpcErr);
      return fail("INTERNAL_ERROR", "Failed to log weight", 500);
    }

    // Return the full row so the client can update UI without a second fetch.
    const { data: row } = await service
      .from("weight_logs")
      .select("*")
      .eq("id", newId)
      .single();

    return ok(row);
  } catch (err) {
    console.error(err);
    return fail("INTERNAL_ERROR", "Unexpected error logging weight", 500);
  }
});
