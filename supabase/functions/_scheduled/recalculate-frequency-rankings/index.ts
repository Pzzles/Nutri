// recalculate-frequency-rankings (SCHEDULED — not client-callable)
// Triggered daily via pg_cron or a Supabase scheduled trigger, guarded by
// a shared secret rather than a user JWT. Recomputes a 30-day trailing
// usage count per (user, food) and writes it to user_saved_foods.usage_count.
// See docs/02-prs.md FR-031 AC2 (resolves OI-4: daily batch, not real-time).

import { ok, fail } from "../../_shared/envelope.ts";
import { getServiceClient } from "../../_shared/supabaseClient.ts";

Deno.serve(async (req) => {
  try {
    const cronSecret = req.headers.get("x-cron-secret");
    if (!cronSecret || cronSecret !== Deno.env.get("CRON_SECRET")) {
      return fail("UNAUTHENTICATED", "Invalid or missing cron secret", 401);
    }

    const service = getServiceClient();
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { error } = await service.rpc("fn_recalculate_frequency_rankings", { since_ts: since });
    if (error) {
      console.error(error);
      return fail("INTERNAL_ERROR", "Failed to recalculate rankings", 500);
    }

    return ok({ status: "completed", since });
  } catch (err) {
    console.error(err);
    return fail("INTERNAL_ERROR", "Unexpected error in scheduled job", 500);
  }
});
