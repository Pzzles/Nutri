#!/usr/bin/env -S deno run --allow-env --allow-net
//
// Optional smoke test — calls real provider APIs to verify live connectivity.
// EXCLUDED from CI. Run manually when rotating API keys or upgrading providers.
//
// Usage:
//   FATSECRET_CONSUMER_KEY=xxx FATSECRET_CONSUMER_SECRET=yyy \
//   GROQ_API_KEY=zzz \
//   USDA_FDC_API_KEY=aaa \
//   deno run --allow-env --allow-net scripts/smoke-test-providers.ts

import { searchFatSecret } from "../supabase/functions/_shared/fatsecret.ts";
import { searchUsda, pickBestMatch } from "../supabase/functions/_shared/usda.ts";

const QUERY = "whole milk";
let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? `: ${detail}` : ""}`);
    failed++;
  }
}

// ── FatSecret ─────────────────────────────────────────────────────────────────

console.log("\nFatSecret — foods.search");
try {
  const foods = await searchFatSecret(QUERY, 3);
  check("returns results", foods.length > 0, `got ${foods.length} results`);
  if (foods.length > 0) {
    const first = foods[0];
    check("first result has fsId", typeof first.fsId === "string");
    check("first result has name", first.name.length > 0);
    check("calories100g is positive", first.calories100g > 0);
    check("protein100g >= 0", first.protein100g >= 0);
    check("carbs100g >= 0", first.carbs100g >= 0);
    check("fat100g >= 0", first.fat100g >= 0);
    console.log(`    Sample: ${first.name} — ${first.calories100g} kcal/100g`);
  }
} catch (err) {
  console.error("  ERROR:", err);
  failed++;
}

// ── USDA ──────────────────────────────────────────────────────────────────────

console.log("\nUSDA FoodData Central — foods/search");
try {
  const foods = await searchUsda(QUERY, 5);
  check("returns results", foods.length > 0, `got ${foods.length} results`);
  const best = pickBestMatch(foods);
  check("pickBestMatch returns a result", best !== null);
  if (best) {
    check("best match has fdcId", typeof best.fdcId === "number");
    check("best match has description", best.description.length > 0);
    check("calories is positive", best.calories > 0);
    console.log(`    Best: ${best.description} — ${best.calories} kcal/100g`);
  }
} catch (err) {
  console.error("  ERROR:", err);
  failed++;
}

// ── Groq ──────────────────────────────────────────────────────────────────────

console.log("\nGroq — chat completions");
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
if (!GROQ_API_KEY) {
  console.log("  SKIPPED (GROQ_API_KEY not set)");
} else {
  try {
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        max_tokens: 256,
        messages: [
          { role: "system", content: "Extract food items as JSON array with raw_phrase, normalized_name, quantity, unit." },
          { role: "user", content: "I had 150g oatmeal and a glass of milk" },
        ],
      }),
    });
    const json = await resp.json();
    check("HTTP 200", resp.ok, `status ${resp.status}`);
    check("has choices", Array.isArray(json?.choices) && json.choices.length > 0);
    const content = json?.choices?.[0]?.message?.content ?? "";
    check("content is non-empty", content.length > 0);
    try {
      const parsed = JSON.parse(content);
      check("content is a JSON array", Array.isArray(parsed));
      if (Array.isArray(parsed) && parsed.length > 0) {
        check("items have raw_phrase", "raw_phrase" in parsed[0]);
      }
    } catch {
      check("content is valid JSON", false, content.slice(0, 80));
    }
  } catch (err) {
    console.error("  ERROR:", err);
    failed++;
  }
}

// ── Open Food Facts ───────────────────────────────────────────────────────────

console.log("\nOpen Food Facts — product lookup");
const TEST_BARCODE = "5449000000996"; // Coca-Cola Classic 330ml can (well-known barcode)
try {
  const resp = await fetch(`https://world.openfoodfacts.org/api/v0/product/${TEST_BARCODE}.json`);
  const json = await resp.json();
  check("HTTP 200", resp.ok, `status ${resp.status}`);
  check("status=1 (product found)", json?.status === 1);
  if (json?.status === 1) {
    const n = json.product?.nutriments ?? {};
    check("energy-kcal_100g present", "energy-kcal_100g" in n);
    check("product_name present", (json.product?.product_name ?? "").length > 0);
    console.log(`    Product: ${json.product?.product_name ?? "unknown"}`);
  }
} catch (err) {
  console.error("  ERROR:", err);
  failed++;
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) Deno.exit(1);
