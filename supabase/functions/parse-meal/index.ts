// parse-meal
// Converts natural-language meal text into ParsedFoodItem[] via Claude.
// See docs/02-prs.md FR-001-004 and docs/07-edge-functions.md → parse-meal.
//
// This function never sees, produces, or trusts nutrition values — the
// system prompt below forbids Claude from emitting them, and the response
// is filtered defensively in case it tries anyway (FR-002 AC4).

import { ok, fail, preflight } from "../_shared/envelope.ts";
import { getUserClient, getServiceClient } from "../_shared/supabaseClient.ts";
import { ParsedFoodItem } from "../_shared/types.ts";
import { filterForbiddenKeys, sanitizeGroqItem } from "../_shared/groqParser.ts";

const SYSTEM_PROMPT = `You are a food-extraction assistant for a nutrition tracking app.
Extract every distinct food item from the user's message.

Rules:
- Never estimate or output calories, protein, carbs, fat, or any nutrition value. You do not have access to nutrition data and must not guess it.
- For each item return: raw_phrase, normalized_name (canonical singular food name, lowercase), quantity (number or null), unit (string or null, e.g. "g", "piece", "cup"), confidence_hint ("high"|"medium"|"low"), ambiguous (boolean — true if the size/type/portion is genuinely unclear and a follow-up question is needed).
- If two items clearly refer to the same food, still list them separately; deduplication happens downstream.
- Respond with ONLY a JSON array matching this shape. No prose, no markdown code fences, no explanation.`;

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
    const text = String(body?.text ?? "").trim();
    if (text.length < 1 || text.length > 500) {
      return fail("VALIDATION_ERROR", "text must be 1-500 characters");
    }

    const started = Date.now();
    const { items, rawResponse, tokenUsage, callError } = await callClaude(text);
    const durationMs = Date.now() - started;

    const service = getServiceClient();
    const { data: logRow, error: logErr } = await service
      .from("ai_parse_requests")
      .insert({
        user_id: userId,
        raw_text: text,
        raw_response: rawResponse,
        parsed_result: callError ? null : items,
        duration_ms: durationMs,
        token_usage: tokenUsage,
        error: callError ?? null,
      })
      .select("id")
      .single();

    if (logErr) console.error("Failed to write ai_parse_requests row:", logErr);

    if (callError || !items) {
      // FR-003: after failure, client falls back to manual entry — this
      // function reports the failure, it doesn't perform the fallback itself.
      return fail("AI_PARSE_FAILED", callError ?? "Unknown parse failure", 502);
    }

    // Groq sometimes returns the string "null" instead of JSON null for
    // optional fields. Normalize these to actual null before sending downstream.
    const sanitized = (items as any[]).map(sanitizeGroqItem);

    return ok({ ai_parse_request_id: logRow?.id ?? null, items: sanitized });
  } catch (err) {
    console.error(err);
    return fail("INTERNAL_ERROR", "Unexpected error parsing meal", 500);
  }
});

async function callClaude(text: string): Promise<{
  items: ParsedFoodItem[] | null;
  rawResponse: string | null;
  tokenUsage: Record<string, unknown> | null;
  callError: string | null;
}> {
  const apiKey = Deno.env.get("GROQ_API_KEY");
  if (!apiKey) {
    return { items: null, rawResponse: null, tokenUsage: null, callError: "Missing GROQ_API_KEY" };
  }
  const apiUrl = Deno.env.get("GROQ_API_URL") ?? "https://api.groq.com/openai/v1/chat/completions";

  // FR-003 AC1: total elapsed to fallback must stay under ~8.5s. Budget 4s
  // per attempt, one retry on malformed JSON or transient failure.
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    try {
      const resp = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: Deno.env.get("GROQ_MODEL") ?? "llama-3.3-70b-versatile",
          max_tokens: 1024,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: text },
          ],
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const json = await resp.json();
      if (!resp.ok) {
        if (attempt === 1) {
          return { items: null, rawResponse: JSON.stringify(json), tokenUsage: null, callError: `Groq API error: ${resp.status}` };
        }
        continue;
      }

      const rawText: string = json?.choices?.[0]?.message?.content ?? "";

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        if (attempt === 1) {
          return { items: null, rawResponse: rawText, tokenUsage: json?.usage ?? null, callError: "AI response was not valid JSON" };
        }
        continue; // retry once on malformed JSON
      }

      if (!Array.isArray(parsed)) {
        if (attempt === 1) {
          return { items: null, rawResponse: rawText, tokenUsage: json?.usage ?? null, callError: "AI response was not a JSON array" };
        }
        continue;
      }

      // FR-002 AC4: reject any item smuggling nutrition fields.
      const clean = filterForbiddenKeys(parsed as any[]);
      if (clean.length !== parsed.length) {
        console.warn("Discarded item(s) with forbidden nutrition fields from AI response");
      }

      return { items: clean as ParsedFoodItem[], rawResponse: rawText, tokenUsage: json?.usage ?? null, callError: null };
    } catch (err) {
      clearTimeout(timeout);
      if (attempt === 1) {
        return { items: null, rawResponse: null, tokenUsage: null, callError: String(err) };
      }
      // fall through to retry
    }
  }

  return { items: null, rawResponse: null, tokenUsage: null, callError: "AI parser failed after retry" };
}
