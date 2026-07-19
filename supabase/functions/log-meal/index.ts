// log-meal
// Persists a confirmed meal. Requires idempotency_key (ADR-012). Supports
// three sources (ADR-013): draft (normal flow), template (re-log a saved
// meal — ADR-006, always re-resolved against CURRENT food data), and
// copy_previous ("same as yesterday" — FR-033).
// See docs/02-prs.md FR-032, FR-033, FR-040, FR-011.

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
    const { idempotency_key, meal_type, eaten_at, source } = body;

    if (!idempotency_key) return fail("VALIDATION_ERROR", "idempotency_key is required");
    if (!meal_type) return fail("VALIDATION_ERROR", "meal_type is required");
    if (!["draft", "template", "copy_previous"].includes(source)) {
      return fail("VALIDATION_ERROR", "source must be draft|template|copy_previous");
    }

    const service = getServiceClient();

    // Idempotency check — a repeated key returns the stored response instead
    // of re-executing (ADR-012).
    const { data: existing } = await service
      .from("idempotency_keys")
      .select("response_json")
      .eq("user_id", userId)
      .eq("idempotency_key", idempotency_key)
      .eq("function_name", "log-meal")
      .maybeSingle();
    if (existing) return ok(existing.response_json);

    let items: any[];
    let rawInput: string | null = body.raw_input ?? null;
    let parsedJson: unknown = body.parsed_json ?? null;

    if (source === "draft") {
      items = body.items;
      if (!Array.isArray(items) || items.length === 0) {
        return fail("VALIDATION_ERROR", "items required for source=draft");
      }
    } else if (source === "template") {
      // FR-032 / ADR-006: templates never store totals — re-resolve against
      // current foods data now, exactly as calculate-meal would.
      return fail(
        "NOT_IMPLEMENTED",
        "source=template is not yet implemented in this scaffold — wire this to fetch saved_meal_items and re-run the calculate-meal logic inline. See docs/07-edge-functions.md → log-meal.",
        501,
      );
    } else {
      // copy_previous — FR-033 "same as yesterday".
      return fail(
        "NOT_IMPLEMENTED",
        "source=copy_previous is not yet implemented in this scaffold — wire this to fetch meal_items from the matching prior meals row. See docs/07-edge-functions.md → log-meal.",
        501,
      );
    }

    const eatenAtDate = new Date(eaten_at ?? Date.now());

    // FR-040 AC3: logged_date is derived in the user's timezone AT INSERT
    // TIME and stored — it is never recomputed if the profile's timezone
    // changes later.
    const { data: profile } = await service
      .from("profiles")
      .select("timezone")
      .eq("id", userId)
      .single();
    const timezone = profile?.timezone ?? "UTC";
    const loggedDate = toLocalDateString(eatenAtDate, timezone);

    const mealConfidence = body.meal_confidence ?? "low";

    const { data: mealId, error: rpcErr } = await service.rpc("fn_log_meal", {
      p_user_id: userId,
      p_meal_type: meal_type,
      p_eaten_at: eatenAtDate.toISOString(),
      p_logged_date: loggedDate,
      p_meal_confidence: mealConfidence,
      p_raw_input: rawInput,
      p_parsed_json: parsedJson,
      p_items: items,
    });
    if (rpcErr) {
      console.error(rpcErr);
      return fail("INTERNAL_ERROR", "Failed to persist meal", 500);
    }

    if (body.ai_parse_request_id) {
      await service
        .from("ai_parse_requests")
        .update({ meal_id: mealId })
        .eq("id", body.ai_parse_request_id);
    }

    // FR-011: promote externally-sourced matches into the caches. Items
    // resolved via live API carry match_confidence 'exact'/'partial' with a
    // nutrition_source other than 'user_manual' — we treat any such item as
    // cache-eligible here. (Items already served from a cache tier are
    // skipped via ON CONFLICT no-ops below.)
    await promoteToCache(service, userId, items);
    await updatePortionHistory(service, userId, items);

    const responsePayload = { meal_id: mealId, meal_confidence: mealConfidence };

    await service.from("idempotency_keys").insert({
      user_id: userId,
      idempotency_key,
      function_name: "log-meal",
      response_json: responsePayload,
    });

    return ok(responsePayload);
  } catch (err) {
    console.error(err);
    return fail("INTERNAL_ERROR", "Unexpected error logging meal", 500);
  }
});

async function promoteToCache(service: any, userId: string, items: any[]) {
  const { data: threshold } = await service
    .from("system_settings")
    .select("value")
    .eq("key", "global_cache_promotion_threshold")
    .single();
  const promotionThreshold = Number(threshold?.value ?? 3);

  for (const item of items) {
    if (!item.food_id || !item.normalized_query) continue; // client should pass normalized_query through from resolve-foods

    // FR-011 AC1: write to this user's own cache unconditionally.
    await service
      .from("user_food_cache")
      .upsert(
        {
          user_id: userId,
          normalized_query: item.normalized_query,
          matched_food_id: item.food_id,
          lookup_source: item.nutrition_source ?? "unknown",
          confidence: item.match_confidence ?? "partial",
          use_count: 1,
          last_used_at: new Date().toISOString(),
        },
        { onConflict: "user_id,normalized_query", ignoreDuplicates: false },
      );

    // FR-011 AC2/AC3: record this user's vote, promote to global cache once
    // the distinct-confirming-user threshold is met.
    await service
      .from("global_cache_promotion_votes")
      .upsert(
        { normalized_query: item.normalized_query, matched_food_id: item.food_id, confirming_user_id: userId },
        { onConflict: "normalized_query,matched_food_id,confirming_user_id", ignoreDuplicates: true },
      );

    const { count } = await service
      .from("global_cache_promotion_votes")
      .select("*", { count: "exact", head: true })
      .eq("normalized_query", item.normalized_query)
      .eq("matched_food_id", item.food_id);

    if ((count ?? 0) >= promotionThreshold) {
      await service
        .from("global_food_cache")
        .upsert(
          {
            normalized_query: item.normalized_query,
            matched_food_id: item.food_id,
            lookup_source: item.nutrition_source ?? "unknown",
            confidence: item.match_confidence ?? "partial",
            last_used_at: new Date().toISOString(),
          },
          { onConflict: "normalized_query", ignoreDuplicates: false },
        );
    }
  }
}

async function updatePortionHistory(service: any, userId: string, items: any[]) {
  for (const item of items) {
    if (!item.food_id || item.portion_source !== "explicit" || !item.portion_g) continue;

    // Atomic increment via fn_upsert_portion_history — replaces the prior
    // read-then-write which lost increments under concurrent saves (BUG-002).
    await service.rpc("fn_upsert_portion_history", {
      p_user_id: userId,
      p_food_id: item.food_id,
      p_usual_g: item.portion_g,
    });
  }
}

function toLocalDateString(date: Date, timezone: string): string {
  // en-CA locale formats as YYYY-MM-DD, which is exactly the Postgres `date`
  // literal format we need.
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}
