import { useState, useEffect } from "react";
import { callFunction } from "../lib/supabase";
import {
  ParsedFoodItem,
  ResolvedFoodItem,
  CalculatedItem,
  MealTotals,
  ClarificationItem,
  PortionClarificationResult,
} from "../lib/types";
import ConfidenceBadge from "../components/ConfidenceBadge";
import { scaleMacros } from "../lib/meal";

type Step = "input" | "reviewing" | "confirming" | "logged";

export default function LogMeal() {
  const [step, setStep] = useState<Step>("input");
  const [text, setText] = useState("");
  const [mealType, setMealType] = useState<"breakfast" | "lunch" | "dinner" | "snack">("breakfast");
  const [aiParseRequestId, setAiParseRequestId] = useState<string | null>(null);
  const [items, setItems] = useState<CalculatedItem[]>([]);
  const [needsAttention, setNeedsAttention] = useState<ClarificationItem[]>([]);
  const [totals, setTotals] = useState<MealTotals | null>(null);
  const [mealConfidence, setMealConfidence] = useState<"high" | "medium" | "low" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loggedMealId, setLoggedMealId] = useState<string | null>(null);
  const [portionInputs, setPortionInputs] = useState<Record<number, string>>({});

  useEffect(() => {
    if (items.length === 0) return;
    const next: MealTotals = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 };
    for (const item of items) {
      next.calories += item.calories;
      next.protein_g += item.protein_g;
      next.carbs_g += item.carbs_g;
      next.fat_g += item.fat_g;
      next.fibre_g += item.fibre_g ?? 0;
    }
    setTotals({
      calories: Math.round(next.calories * 10) / 10,
      protein_g: Math.round(next.protein_g * 10) / 10,
      carbs_g: Math.round(next.carbs_g * 10) / 10,
      fat_g: Math.round(next.fat_g * 10) / 10,
      fibre_g: Math.round(next.fibre_g * 10) / 10,
    });
  }, [items]);

  function applyPortionOverride(index: number) {
    const gramsStr = portionInputs[index];
    const grams = parseFloat(gramsStr);
    if (!grams || grams <= 0) return;
    setItems((prev) => {
      const updated = [...prev];
      updated[index] = scaleMacros(updated[index], grams);
      return updated;
    });
  }

  async function handleParseAndResolve(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // Step 1 — parse-meal (FR-001-004)
      const parsed = await callFunction<{ ai_parse_request_id: string; items: ParsedFoodItem[] }>(
        "parse-meal",
        { text },
      );
      setAiParseRequestId(parsed.ai_parse_request_id);

      // Step 2 — resolve-foods (Food Resolution Engine, ADR-003)
      const resolved = await callFunction<{
        resolved_items: ResolvedFoodItem[];
        clarification_required: ClarificationItem[];
      }>("resolve-foods", { items: parsed.items });

      const allClarifications: ClarificationItem[] = [...resolved.clarification_required];

      if (resolved.resolved_items.length === 0) {
        setItems([]);
        setTotals(null);
        setMealConfidence(null);
        setNeedsAttention(allClarifications);
        setStep("reviewing");
        return;
      }

      // Step 3 — calculate-meal (pure Nutrition Engine)
      const calculated = await callFunction<{
        items: CalculatedItem[];
        clarification_required: PortionClarificationResult[];
        meal_totals: MealTotals;
        meal_confidence: "high" | "medium" | "low";
      }>("calculate-meal", { resolved_items: resolved.resolved_items });

      for (const c of calculated.clarification_required ?? []) {
        allClarifications.push({
          raw_phrase: c.raw_phrase,
          reason: "portion_clarification",
          code: c.code,
          message: c.message,
          suggested_unit: c.suggested_unit,
          suggested_qty: c.suggested_qty,
        });
      }

      setItems(calculated.items);
      setTotals(calculated.meal_totals);
      setMealConfidence(calculated.meal_confidence);
      setNeedsAttention(allClarifications);
      setStep("reviewing");
    } catch (err: any) {
      setError(err.message ?? "Something went wrong parsing that meal.");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    setLoading(true);
    setError(null);
    try {
      const result = await callFunction<{ meal_id: string; meal_confidence: string }>("log-meal", {
        idempotency_key: crypto.randomUUID(),
        meal_type: mealType,
        eaten_at: new Date().toISOString(),
        source: "draft",
        raw_input: text,
        meal_confidence: mealConfidence,
        ai_parse_request_id: aiParseRequestId,
        items,
      });
      setLoggedMealId(result.meal_id);
      setStep("logged");
    } catch (err: any) {
      setError(err.message ?? "Failed to save meal.");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setStep("input");
    setText("");
    setItems([]);
    setNeedsAttention([]);
    setTotals(null);
    setMealConfidence(null);
    setLoggedMealId(null);
    setAiParseRequestId(null);
    setPortionInputs({});
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="font-display text-2xl font-semibold text-ink">Log a meal</h1>
      <p className="mt-1 text-sm text-muted">
        Describe what you ate — the app handles the lookup and the math.
      </p>

      {step === "input" && (
        <form onSubmit={handleParseAndResolve} className="mt-6 space-y-4">
          <div className="flex gap-2">
            {(["breakfast", "lunch", "dinner", "snack"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setMealType(t)}
                className={`rounded-full px-3 py-1.5 text-sm capitalize ${
                  mealType === t ? "bg-primary text-white" : "bg-surface text-muted border border-border"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <textarea
            required
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. 4 boiled eggs, small avo, bread with butter, tea"
            rows={3}
            maxLength={500}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            type="submit"
            disabled={loading || text.trim().length === 0}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {loading ? "Parsing…" : "Parse meal"}
          </button>
          {error && <p className="text-sm text-confidence-low">{error}</p>}
        </form>
      )}

      {step === "reviewing" && (
        <div className="mt-6 space-y-4">
          {needsAttention.length > 0 && (
            <div className="rounded-lg border border-confidence-low/30 bg-red-50 px-4 py-3 text-sm text-confidence-low dark:bg-red-950/30 dark:text-red-300">
              <p className="font-medium">These need a closer look:</p>
              <ul className="mt-1 list-inside list-disc space-y-1">
                {needsAttention.map((n, i) => {
                  if (n.reason === "food_form_ambiguous") {
                    return (
                      <li key={i}>
                        <span className="font-medium">"{n.raw_phrase}"</span> — multiple food forms with very different calorie densities. Search for the specific form you ate:
                        <ul className="mt-1 ml-4 list-none space-y-0.5">
                          {n.options.map((opt, j) => (
                            <li key={j} className="text-xs">
                              {opt.name} — {opt.calories_100g} kcal/100g
                              {opt.serving_size_g ? ` · ${opt.serving_size_g}g serving` : ""}
                            </li>
                          ))}
                        </ul>
                      </li>
                    );
                  }
                  if (n.reason === "portion_clarification") {
                    return (
                      <li key={i}>
                        <span className="font-medium">"{n.raw_phrase}"</span> — {n.message}
                        {n.suggested_unit && (
                          <span className="ml-1 underline">Re-enter with the correct unit.</span>
                        )}
                      </li>
                    );
                  }
                  return (
                    <li key={i}>
                      <span className="font-medium">"{n.raw_phrase}"</span> — {n.reason === "ambiguous" ? "unclear portion or type" : "no food match found"}
                    </li>
                  );
                })}
              </ul>
              <p className="mt-1 text-xs text-confidence-low/80 dark:text-red-300/80">
                Manual search/edit for these isn't wired into this screen yet — see search-food and
                create-custom-food.
              </p>
            </div>
          )}

          {items.length > 0 && (
            <div className="divide-y divide-border rounded-lg border border-border bg-surface">
              {items.map((item, i) => (
                <div key={i} className="px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-ink">{item.raw_phrase}</p>
                      {item.portion_source === "default" && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                          portion?
                        </span>
                      )}
                      {item.portion_source === "history" && (item.history_use_count ?? 0) >= 3 && (
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600 dark:bg-blue-950/60 dark:text-blue-300">
                          usual · {item.portion_g}g
                        </span>
                      )}
                      {item.portion_source === "history" && (item.history_use_count ?? 0) < 3 && (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600 dark:bg-amber-950/60 dark:text-amber-300">
                          from history · {item.portion_g}g ({item.history_use_count}×)
                        </span>
                      )}
                    </div>
                    <ConfidenceBadge level={item.item_confidence} />
                  </div>
                  <p className="mt-0.5 text-xs text-muted">
                    {item.calories} kcal · {item.protein_g}g protein · {item.carbs_g}g carbs · {item.fat_g}g fat
                    {item.portion_source === "explicit" && (
                      <span> · {item.portion_g}g</span>
                    )}
                  </p>
                  {(item.portion_source === "default" || item.portion_source === "history") && (
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max="5000"
                        placeholder={String(item.portion_g)}
                        value={portionInputs[i] ?? ""}
                        onChange={(e) => setPortionInputs((prev) => ({ ...prev, [i]: e.target.value }))}
                        onKeyDown={(e) => e.key === "Enter" && applyPortionOverride(i)}
                        className="w-24 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-amber-400 dark:border-amber-700 dark:bg-amber-950/50"
                      />
                      <span className="text-xs text-muted">g</span>
                      <button
                        type="button"
                        onClick={() => applyPortionOverride(i)}
                        className="rounded bg-amber-500 px-2 py-1 text-xs font-medium text-white hover:bg-amber-600"
                      >
                        Set
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {totals && mealConfidence && (
            <div className="rounded-lg bg-primary-light px-4 py-3">
              <div className="flex items-center justify-between">
                <p className="font-display text-lg font-semibold text-primary-dark">
                  {totals.calories} kcal total
                </p>
                <ConfidenceBadge level={mealConfidence} />
              </div>
              <p className="mt-1 text-sm text-primary-dark/80">
                {totals.protein_g}g protein · {totals.carbs_g}g carbs · {totals.fat_g}g fat · {totals.fibre_g}g fibre
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleConfirm}
              disabled={loading || items.length === 0}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
            >
              {loading ? "Saving…" : "Confirm & log"}
            </button>
            <button onClick={reset} className="rounded-lg border border-border px-4 py-2 text-sm text-muted">
              Start over
            </button>
          </div>
          {error && <p className="text-sm text-confidence-low">{error}</p>}
        </div>
      )}

      {step === "logged" && (
        <div className="mt-6 space-y-4">
          <div className="rounded-lg bg-primary-light px-4 py-3 text-sm text-primary-dark">
            Meal logged. <span className="text-primary-dark/70">({loggedMealId})</span>
          </div>
          <button onClick={reset} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark">
            Log another meal
          </button>
        </div>
      )}
    </div>
  );
}
