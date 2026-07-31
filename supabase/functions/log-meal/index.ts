// log-meal
// Persists a confirmed meal. Requires idempotency_key (ADR-012). Supports
// three sources (ADR-013): draft (normal flow), template (re-log a saved
// meal — ADR-006, always re-resolved against CURRENT food data), and
// copy_previous ("same as yesterday" — FR-033).
// See docs/02-prs.md FR-032, FR-033, FR-040, FR-011.

import { ok, fail, preflight } from "../_shared/envelope.ts";
import { getUserClient, getServiceClient } from "../_shared/supabaseClient.ts";
import { toLocalDateString } from "../_shared/timezone.ts";
import { resolveWeightGrams } from "../_shared/portionResolution.ts";
import { computeItemConfidence, computeMealConfidence } from "../_shared/confidence.ts";
import { MatchConfidence, PortionConfidence } from "../_shared/types.ts";

function round(n: number): number { return Math.round(n * 10) / 10; }

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
    let mealConfidence: string = body.meal_confidence ?? "low";

    if (source === "draft") {
      items = body.items;
      if (!Array.isArray(items) || items.length === 0) {
        return fail("VALIDATION_ERROR", "items required for source=draft");
      }
    } else if (source === "template") {
      const { saved_meal_id } = body;
      if (!saved_meal_id) return fail("VALIDATION_ERROR", "saved_meal_id required for source=template");

      const { data: template } = await service
        .from("saved_meals")
        .select("id, name, usage_count")
        .eq("id", saved_meal_id)
        .eq("user_id", userId)
        .eq("status", "active")
        .maybeSingle();
      if (!template) return fail("NOT_FOUND", "Saved meal not found", 404);

      const { data: templateItems, error: tiErr } = await service
        .from("saved_meal_items")
        .select("food_id, default_quantity, default_unit, foods:food_id(name, normalized_name, calories_100g, protein_100g, carbs_100g, fat_100g, fibre_100g, serving_size_g, source)")
        .eq("saved_meal_id", saved_meal_id);
      if (tiErr || !templateItems || templateItems.length === 0) {
        return fail("NOT_FOUND", "Template has no items", 404);
      }

      items = buildItemsFromTemplate(templateItems);
      if (items.length === 0) return fail("VALIDATION_ERROR", "Template has no resolvable items");
      mealConfidence = computeMealConfidence(items.map((i: any) => i.item_confidence));
      rawInput = `template:${saved_meal_id}`;
      parsedJson = { source: "template", saved_meal_id };

      // Update usage stats (best-effort — failure must not block the log).
      service.from("saved_meals")
        .update({ usage_count: (template.usage_count ?? 0) + 1, last_used_at: new Date().toISOString() })
        .eq("id", saved_meal_id)
        .then(({ error }) => { if (error) console.error("[template] usage update failed:", error); });

    } else {
      // copy_previous — FR-033: re-log a past meal with current food nutrition.
      const { reference_meal_id } = body;
      if (!reference_meal_id) return fail("VALIDATION_ERROR", "reference_meal_id required for source=copy_previous");

      const { data: refMeal } = await service
        .from("meals")
        .select("id")
        .eq("id", reference_meal_id)
        .eq("user_id", userId)
        .maybeSingle();
      if (!refMeal) return fail("NOT_FOUND", "Reference meal not found", 404);

      const { data: refItems, error: riErr } = await service
        .from("meal_items")
        .select("food_id, weight_g, quantity, unit, foods:food_id(name, normalized_name, calories_100g, protein_100g, carbs_100g, fat_100g, fibre_100g, serving_size_g, source)")
        .eq("meal_id", reference_meal_id);
      if (riErr || !refItems || refItems.length === 0) {
        return fail("NOT_FOUND", "Reference meal has no items", 404);
      }

      items = buildItemsFromMeal(refItems);
      if (items.length === 0) return fail("VALIDATION_ERROR", "Reference meal has no resolvable items");
      mealConfidence = computeMealConfidence(items.map((i: any) => i.item_confidence));
      rawInput = `copy_previous:${reference_meal_id}`;
      parsedJson = { source: "copy_previous", reference_meal_id };
    }

    // B10: Backend portion-safety guard.
    // Reject any item whose weight was never resolved — the frontend enforces
    // this too, but direct API calls must not bypass the check.
    // portion_source==="default" means the 100g fallback was applied without
    // an explicit user-confirmed gram weight.
    const defaultPortionItem = items.find((i: any) => i.portion_source === "default");
    if (defaultPortionItem) {
      return fail(
        "VALIDATION_ERROR",
        `Item '${defaultPortionItem.raw_phrase ?? "unknown"}' has an unresolved default portion. ` +
        "Provide an explicit gram weight before confirming.",
        422,
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

    // Fetch the updated daily_log_status for the logged date. The
    // trg_reopen_daily_log_on_meal trigger may have changed it to 'partial'
    // if the day was previously marked complete.
    const { data: dailyStatus } = await service
      .from("daily_log_status")
      .select("status, marked_complete_at, reopened_at, updated_at")
      .eq("user_id", userId)
      .eq("logged_date", loggedDate)
      .maybeSingle();

    const responsePayload = {
      meal_id: mealId,
      meal_confidence: mealConfidence,
      daily_log_status: dailyStatus
        ? {
            status: dailyStatus.status,
            marked_complete_at: dailyStatus.marked_complete_at,
            reopened_at: dailyStatus.reopened_at,
          }
        : { status: "unknown", marked_complete_at: null, reopened_at: null },
    };

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

// ── Template / copy_previous item builders ────────────────────────────────────

function buildItemsFromTemplate(templateItems: any[]): any[] {
  const result: any[] = [];
  for (const ti of templateItems) {
    const food = ti.foods;
    if (!food) continue;

    const resolution = resolveWeightGrams(
      { quantity: ti.default_quantity ?? null, unit: ti.default_unit ?? null, extreme_confirmed: true },
      food.serving_size_g ?? null,
      null,
    );

    let weightG: number;
    let portionConf: PortionConfidence;
    let portionSource: "explicit" | "default";

    if (resolution.kind === "clarification") {
      weightG = food.serving_size_g ?? 100;
      portionConf = "assumed_default";
      portionSource = "default";
    } else {
      weightG = resolution.grams;
      portionConf = ti.default_quantity != null ? "exact" : "assumed_default";
      portionSource = resolution.source === "default" ? "default" : "explicit";
    }

    const matchConf: MatchConfidence = "exact";
    const itemConf = computeItemConfidence(matchConf, portionConf);
    const factor = weightG / 100;

    result.push({
      food_id: ti.food_id,
      raw_phrase: ti.default_quantity != null
        ? `${ti.default_quantity} ${ti.default_unit ?? ""}`.trimEnd() + ` ${food.name}`
        : food.name,
      raw_phrases: [food.name],
      normalized_query: food.normalized_name,
      quantity: ti.default_quantity ?? null,
      unit: ti.default_unit ?? null,
      portion_g: weightG,
      calories: round(food.calories_100g * factor),
      protein_g: round(food.protein_100g * factor),
      carbs_g: round(food.carbs_100g * factor),
      fat_g: round(food.fat_100g * factor),
      fibre_g: food.fibre_100g != null ? round(food.fibre_100g * factor) : null,
      nutrition_source: food.source,
      match_confidence: matchConf,
      portion_confidence: portionConf,
      item_confidence: itemConf,
      portion_source: portionSource,
      history_use_count: null,
    });
  }
  return result;
}

function buildItemsFromMeal(mealItems: any[]): any[] {
  const result: any[] = [];
  for (const mi of mealItems) {
    const food = mi.foods;
    if (!food || mi.weight_g == null) continue;

    const weightG = Number(mi.weight_g);
    const factor = weightG / 100;
    const matchConf: MatchConfidence = "exact";
    const portionConf: PortionConfidence = "exact";
    const itemConf = computeItemConfidence(matchConf, portionConf);

    result.push({
      food_id: mi.food_id,
      raw_phrase: food.name,
      raw_phrases: [food.name],
      normalized_query: food.normalized_name,
      quantity: mi.quantity ?? null,
      unit: mi.unit ?? null,
      portion_g: weightG,
      calories: round(food.calories_100g * factor),
      protein_g: round(food.protein_100g * factor),
      carbs_g: round(food.carbs_100g * factor),
      fat_g: round(food.fat_100g * factor),
      fibre_g: food.fibre_100g != null ? round(food.fibre_100g * factor) : null,
      nutrition_source: food.source,
      match_confidence: matchConf,
      portion_confidence: portionConf,
      item_confidence: itemConf,
      portion_source: "explicit" as const,
      history_use_count: null,
    });
  }
  return result;
}

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

