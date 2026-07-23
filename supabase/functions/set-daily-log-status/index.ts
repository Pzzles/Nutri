// set-daily-log-status
// Explicitly sets the completion status of a day's food log.
// Status transitions are handled by fn_set_daily_log_status (RPC) which
// preserves marked_complete_at as an audit trail even when a day is reopened.
//
// Body: { date: "YYYY-MM-DD", status: "unknown" | "partial" | "complete" }
//
// The caller is responsible for supplying the date in the user's local
// timezone (Africa/Johannesburg by default). The edge function never infers
// the date — this is deliberate.

import { ok, fail, preflight } from "../_shared/envelope.ts";
import { getUserClient, getServiceClient } from "../_shared/supabaseClient.ts";

interface SetStatusBody {
  date: string;
  status: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail("UNAUTHENTICATED", "Missing Authorization header", 401);

    const userClient = getUserClient(authHeader);
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return fail("UNAUTHENTICATED", "Invalid session", 401);
    const userId = userData.user.id;

    const body: SetStatusBody = await req.json().catch(() => ({}));

    if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return fail("VALIDATION_ERROR", "date must be a valid YYYY-MM-DD string");
    }

    if (!body.status || !["unknown", "partial", "complete"].includes(body.status)) {
      return fail("VALIDATION_ERROR", "status must be 'unknown', 'partial', or 'complete'");
    }

    const service = getServiceClient();

    const { data: result, error: rpcErr } = await service.rpc("fn_set_daily_log_status", {
      p_user_id: userId,
      p_date: body.date,
      p_status: body.status,
    });

    if (rpcErr) {
      console.error(rpcErr);
      return fail("INTERNAL_ERROR", "Failed to set daily log status", 500);
    }

    return ok(result);
  } catch (err) {
    console.error(err);
    return fail("INTERNAL_ERROR", "Unexpected error setting daily log status", 500);
  }
});
