// recent-foods
// Returns the user's favourited and most-frequently-used foods, used to
// speed up logging (FR-030, FR-031). Ranking reflects the last completed
// daily batch run of recalculate-frequency-rankings, not a live
// recalculation on every call — see the scheduled function.

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

    const service = getServiceClient();
    const { data, error } = await service
      .from("user_saved_foods")
      .select("food_id, nickname, is_favorite, usage_count, last_used_at, foods(name, brand)")
      .eq("user_id", userId)
      .order("is_favorite", { ascending: false })
      .order("usage_count", { ascending: false })
      .limit(15);

    if (error) {
      console.error(error);
      return fail("INTERNAL_ERROR", "Failed to load recent foods", 500);
    }
    return ok({ results: data });
  } catch (err) {
    console.error(err);
    return fail("INTERNAL_ERROR", "Unexpected error loading recent foods", 500);
  }
});
