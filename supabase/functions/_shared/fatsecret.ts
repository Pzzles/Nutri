// FatSecret Platform API — primary food data source.
// Uses OAuth 1.0 (HMAC-SHA1) via the method-based server.api endpoint.
// OAuth 1.0 has no IP restrictions — unlike OAuth 2.0 which requires IP whitelisting
// that doesn't work with Supabase edge functions' dynamic outbound IP pool.

const SERVER_API = "https://platform.fatsecret.com/rest/server.api";

function pct(s: string): string {
  return encodeURIComponent(s);
}

async function buildOAuthHeader(
  params: Record<string, string>,
  consumerKey: string,
  consumerSecret: string,
): Promise<string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: "1.0",
  };

  // Signature covers both oauth params and body params.
  const allParams = { ...params, ...oauthParams };
  const paramString = Object.entries(allParams)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => `${pct(k)}=${pct(v)}`)
    .join("&");

  const baseString = `POST&${pct(SERVER_API)}&${pct(paramString)}`;
  const signingKey = `${pct(consumerSecret)}&`; // empty OAuth token secret (2-legged)

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingKey),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(baseString));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));

  const headerParts = { ...oauthParams, oauth_signature: signature };
  const headerValue = Object.entries(headerParts)
    .map(([k, v]) => `${pct(k)}="${pct(v)}"`)
    .join(", ");

  return `OAuth ${headerValue}`;
}

async function callApi(params: Record<string, string>): Promise<any> {
  const consumerKey = Deno.env.get("FATSECRET_CONSUMER_KEY");
  const consumerSecret = Deno.env.get("FATSECRET_CONSUMER_SECRET");
  if (!consumerKey || !consumerSecret) {
    throw new Error("FATSECRET_CONSUMER_KEY / FATSECRET_CONSUMER_SECRET not set");
  }

  const bodyParams = { ...params, format: "json" };
  const authHeader = await buildOAuthHeader(bodyParams, consumerKey, consumerSecret);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const resp = await fetch(SERVER_API, {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(bodyParams),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const json = await resp.json();
    if (json?.error) {
      console.error(`[FatSecret] API error code=${json.error.code}: ${json.error.message}`, params);
      return null;
    }
    return json;
  } catch (err) {
    clearTimeout(timeout);
    console.error(`[FatSecret] request failed:`, String(err), params);
    return null;
  }
}

// FatSecret returns a single object when there's one item, array when many.
function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

export interface FatSecretFood {
  fsId: string;
  name: string;
  brand: string | null;
  foodType: string;
  servingSizeG: number | null;
  calories100g: number;
  protein100g: number;
  carbs100g: number;
  fat100g: number;
  fibre100g: number | null;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// Parse "Per 100g - Calories: 160kcal | Fat: 14.66g | Carbs: 8.53g | Prot: 2.00g"
// Also handles "Per 1 serving (28g) - Calories: ..."
function parseDescription(desc: string): Omit<FatSecretFood, "fsId" | "name" | "brand" | "foodType"> | null {
  if (!desc) return null;
  const gMatch = desc.match(/Per (?:[^(]*\()?([\d.]+)\s*g/i);
  const servingG = gMatch ? parseFloat(gMatch[1]) : 100;
  const scale = (v: number) => servingG === 100 ? v : round2((v / servingG) * 100);

  const cal = desc.match(/Calories:\s*([\d.]+)\s*kcal/i);
  const fat = desc.match(/Fat:\s*([\d.]+)\s*g/i);
  const carbs = desc.match(/Carbs:\s*([\d.]+)\s*g/i);
  const prot = desc.match(/Prot(?:ein)?:\s*([\d.]+)\s*g/i);
  const fibre = desc.match(/Fiber:\s*([\d.]+)\s*g/i);

  if (!cal) return null;

  return {
    servingSizeG: servingG === 100 ? null : servingG,
    calories100g: scale(parseFloat(cal[1])),
    fat100g: fat ? scale(parseFloat(fat[1])) : 0,
    carbs100g: carbs ? scale(parseFloat(carbs[1])) : 0,
    protein100g: prot ? scale(parseFloat(prot[1])) : 0,
    fibre100g: fibre ? scale(parseFloat(fibre[1])) : null,
  };
}

function pickServing(servings: any[]): { serving: any; per100: boolean } | null {
  if (servings.length === 0) return null;
  const standardized = servings.find((s) => s.serving_id === "0" && s.metric_serving_unit === "g");
  if (standardized) return { serving: standardized, per100: true };
  const candidates = [servings.find((s) => s.is_default === "1"), ...servings].filter(Boolean);
  for (const s of candidates) {
    if (s.metric_serving_unit === "g" && Number(s.metric_serving_amount) > 0) {
      return { serving: s, per100: false };
    }
  }
  return null;
}

function parseFoodRaw(raw: any): FatSecretFood | null {
  if (!raw?.food_id) return null;
  const base = {
    fsId: String(raw.food_id),
    name: String(raw.food_name ?? ""),
    brand: raw.brand_name ?? null,
    foodType: String(raw.food_type ?? "Generic"),
  };

  // Full serving data (food.get response or foods.search.v5)
  if (raw.servings) {
    const servings = toArray(raw.servings?.serving);
    const picked = pickServing(servings);
    if (picked) {
      const { serving, per100 } = picked;
      const g = per100 ? 100 : Number(serving.metric_serving_amount);
      const scale = (v: any) => per100 ? Number(v ?? 0) : round2((Number(v ?? 0) / g) * 100);
      return {
        ...base,
        servingSizeG: per100 ? null : g,
        calories100g: scale(serving.calories),
        protein100g: scale(serving.protein),
        carbs100g: scale(serving.carbohydrate),
        fat100g: scale(serving.fat),
        fibre100g: serving.fiber != null ? scale(serving.fiber) : null,
      };
    }
  }

  // Basic tier: parse the food_description string
  if (raw.food_description) {
    const parsed = parseDescription(raw.food_description);
    if (parsed) return { ...base, ...parsed };
  }

  return null;
}

// Search FatSecret for foods matching `query`.
export async function searchFatSecret(query: string, pageSize = 10): Promise<FatSecretFood[]> {
  const json = await callApi({
    method: "foods.search",
    search_expression: query,
    max_results: String(pageSize),
  });
  if (!json) return [];

  const foods = toArray(json?.foods?.food);
  return foods.map(parseFoodRaw).filter((f): f is FatSecretFood => f !== null);
}

// Fetch detailed nutrition for a single food by FatSecret food_id.
export async function getFatSecretFood(fsId: string): Promise<FatSecretFood | null> {
  const json = await callApi({ method: "food.get.v4", food_id: fsId });
  if (!json) return null;
  return parseFoodRaw(json?.food ?? null);
}

// Upsert a FatSecret food into the local foods table. Returns the local UUID.
// Idempotent — deduplicates on source_identifier (FatSecret food_id).
export async function upsertFatSecretFood(service: any, food: FatSecretFood): Promise<string | null> {
  const { data: existing } = await service
    .from("foods")
    .select("id")
    .eq("source", "fatsecret")
    .eq("source_identifier", food.fsId)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: inserted, error } = await service
    .from("foods")
    .insert({
      name: food.name,
      normalized_name: food.name.trim().toLowerCase(),
      brand: food.brand,
      source: "fatsecret",
      source_identifier: food.fsId,
      serving_size_g: food.servingSizeG,
      calories_100g: food.calories100g,
      protein_100g: food.protein100g,
      carbs_100g: food.carbs100g,
      fat_100g: food.fat100g,
      fibre_100g: food.fibre100g,
      verified: true,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[FatSecret] insert failed:", JSON.stringify(error));
    return null;
  }
  return inserted.id;
}
