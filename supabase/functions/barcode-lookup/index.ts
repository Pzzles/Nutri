// barcode-lookup
// Dedicated 3-tier chain (ADR-002) — deliberately NOT the same as the text
// lookup chain in resolve-foods, since USDA's barcode coverage is weak
// enough that including it just adds latency for near-zero hit rate.
// See docs/02-prs.md FR-014.

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

    const body = await req.json().catch(() => ({}));
    const barcode = String(body?.barcode ?? "").trim();
    if (!isValidBarcode(barcode)) {
      return fail("VALIDATION_ERROR", "Invalid barcode checksum", 400);
    }

    const service = getServiceClient();

    // Tier 1 — local api_cache.
    const { data: cached } = await service
      .from("api_cache")
      .select("payload_json, expires_at")
      .eq("cache_key", barcode)
      .eq("provider", "open_food_facts")
      .maybeSingle();
    if (cached && new Date(cached.expires_at) > new Date()) {
      return ok({ source: "cache", product: cached.payload_json });
    }

    // Tier 2 — foods previously scanned/created against this barcode.
    const { data: existingFood } = await service
      .from("foods")
      .select("id, name, brand, calories_100g, protein_100g, carbs_100g, fat_100g, fibre_100g")
      .eq("barcode", barcode)
      .maybeSingle();
    if (existingFood) return ok({ source: "user_foods", food: existingFood });

    // Tier 3 — Open Food Facts.
    // NOTE: best-effort against OFF's classic v0 product endpoint — verify
    // against their current docs before relying on this in production, as
    // provider endpoints/response shapes can drift over time.
    const resp = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
    const json = await resp.json();
    if (json?.status !== 1 || !json?.product) {
      return fail("FOOD_NOT_FOUND", "No product found for this barcode", 404);
    }

    const product = json.product;
    const nutriments = product.nutriments ?? {};
    const payload = {
      name: product.product_name ?? "Unknown product",
      brand: product.brands ?? null,
      calories_100g: nutriments["energy-kcal_100g"] ?? 0,
      protein_100g: nutriments["proteins_100g"] ?? 0,
      carbs_100g: nutriments["carbohydrates_100g"] ?? 0,
      fat_100g: nutriments["fat_100g"] ?? 0,
      fibre_100g: nutriments["fiber_100g"] ?? null,
    };

    await service.from("api_cache").upsert(
      {
        cache_key: barcode,
        provider: "open_food_facts",
        payload_json: payload,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
      { onConflict: "cache_key,provider" },
    );

    return ok({ source: "open_food_facts", product: payload, barcode });
  } catch (err) {
    console.error(err);
    return fail("INTERNAL_ERROR", "Unexpected error looking up barcode", 500);
  }
});

function isValidBarcode(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const digits = code.split("").map(Number);
  const checkDigit = digits.pop()!;
  let sum = 0;
  digits.reverse().forEach((d, i) => {
    sum += i % 2 === 0 ? d * 3 : d;
  });
  const calculated = (10 - (sum % 10)) % 10;
  return calculated === checkDigit;
}
