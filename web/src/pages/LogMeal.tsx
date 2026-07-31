import { useState, useEffect, useRef } from "react";
import { callFunction } from "../lib/supabase";
import { DailyLogStatus } from "../lib/goalTypes";
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
import { MealTypeDropdown } from "../components/MealTypeDropdown";

type Step = "input" | "reviewing" | "confirming" | "logged";

// ── Saved-meal template types ─────────────────────────────────────────────────
interface TemplateFood {
  name: string;
  normalized_name: string;
  calories_100g: number;
  protein_100g: number;
  carbs_100g: number;
  fat_100g: number;
  fibre_100g: number | null;
  serving_size_g: number | null;
}
interface TemplateItem {
  id: string;
  food_id: string;
  default_quantity: number | null;
  default_unit: string | null;
  foods: TemplateFood;
}
interface Template {
  id: string;
  name: string;
  description: string | null;
  is_favorite: boolean;
  usage_count: number;
  last_used_at: string | null;
  saved_meal_items: TemplateItem[];
}

function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

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
  const [loggedDailyStatus, setLoggedDailyStatus] = useState<DailyLogStatus | null>(null);
  const [portionInputs, setPortionInputs] = useState<Record<number, string>>({});
  const todayStr = new Date().toISOString().slice(0, 10);
  const minDateStr = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const [logDate, setLogDate] = useState(todayStr);
  // food_ids whose EXTREME_PORTION the user has explicitly confirmed
  const [extremeConfirmedIds, setExtremeConfirmedIds] = useState<string[]>([]);
  // gram overrides typed into the clarification panel inputs
  const [clarificationGrams, setClarificationGrams] = useState<Record<number, string>>({});
  // One key per meal draft — generated on mount, reused across retries, reset on start-over.
  const idempotencyKey = useRef(generateUUID());

  // ── Saved-meal templates ────────────────────────────────────────────────────
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateTotal, setTemplateTotal] = useState(0);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

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

  function dismissClarification(index: number) {
    setNeedsAttention((prev) => prev.filter((_, i) => i !== index));
  }

  async function confirmExtremePortion(foodId: string) {
    const confirmed = [...extremeConfirmedIds, foodId];
    setExtremeConfirmedIds(confirmed);
    setNeedsAttention((prev) =>
      prev.filter(
        (n) => !(n.reason === "portion_clarification" && (n as any).food_id === foodId),
      ),
    );
    await rerunCalculation(confirmed);
  }

  async function handleFoodFormSelection(index: number, rawPhrase: string, foodId: string) {
    dismissClarification(index);
    setLoading(true);
    setError(null);
    try {
      const resolved = await callFunction<{
        resolved_items: ResolvedFoodItem[];
        clarification_required: ClarificationItem[];
      }>("resolve-foods", {
        items: [],
        user_selections: [{ raw_phrase: rawPhrase, food_id: foodId }],
      });
      if (resolved.resolved_items.length > 0) {
        await rerunCalculation(extremeConfirmedIds, resolved.resolved_items);
      }
    } catch (err: any) {
      setError(err.message ?? "Failed to resolve selection.");
      setLoading(false);
    }
  }

  async function resolveWithGrams(index: number, grams: number) {
    const n = needsAttention[index];
    if (n.reason !== "portion_clarification") return;
    setClarificationGrams((prev) => { const next = { ...prev }; delete next[index]; return next; });
    await rerunCalculation(extremeConfirmedIds, [{
      raw_phrase: n.raw_phrase,
      normalized_query: n.raw_phrase,
      food_id: n.food_id,
      quantity: grams,
      unit: "g",
      match_confidence: "partial",
      portion_confidence: "exact",
      item_confidence: "medium",
    }]);
  }

  async function rerunCalculation(confirmedIds: string[], extraResolved: ResolvedFoodItem[] = []) {
    const hasExisting = items.length > 0 || needsAttention.some((n) => n.reason === "portion_clarification");
    if (!hasExisting && extraResolved.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const baseResolved = items.map((i) => ({
        raw_phrase: i.raw_phrase,
        normalized_query: i.normalized_query,
        food_id: i.food_id,
        quantity: i.quantity,
        unit: i.unit,
        match_confidence: i.match_confidence,
        portion_confidence: i.portion_confidence,
        item_confidence: i.item_confidence,
      }));
      const calculated = await callFunction<{
        items: CalculatedItem[];
        clarification_required: PortionClarificationResult[];
        meal_totals: MealTotals;
        meal_confidence: "high" | "medium" | "low";
      }>("calculate-meal", {
        resolved_items: [...baseResolved, ...extraResolved],
        extreme_confirmed_ids: confirmedIds,
      });

      const portionClarifications: ClarificationItem[] = (calculated.clarification_required ?? []).map((c) => ({
        raw_phrase: c.raw_phrase,
        reason: "portion_clarification" as const,
        food_id: c.food_id,
        code: c.code,
        message: c.message,
        suggested_unit: c.suggested_unit,
        suggested_qty: c.suggested_qty,
      }));

      setItems(calculated.items);
      setTotals(calculated.meal_totals);
      setMealConfidence(calculated.meal_confidence);
      setNeedsAttention((prev) => [
        ...prev.filter((n) => n.reason !== "portion_clarification"),
        ...portionClarifications,
      ]);
    } catch (err: any) {
      setError(err.message ?? "Failed to recalculate.");
    } finally {
      setLoading(false);
    }
  }

  async function handleParseAndResolve(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setExtremeConfirmedIds([]);
    try {
      const parsed = await callFunction<{ ai_parse_request_id: string; items: ParsedFoodItem[] }>(
        "parse-meal",
        { text },
      );
      setAiParseRequestId(parsed.ai_parse_request_id);

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
          food_id: c.food_id,
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
      const eatenAt = logDate === todayStr ? new Date().toISOString() : logDate + "T12:00:00.000Z";
      const base = { idempotency_key: idempotencyKey.current, meal_type: mealType, eaten_at: eatenAt, meal_confidence: mealConfidence };
      const result = await callFunction<{ meal_id: string; meal_confidence: string; daily_log_status: DailyLogStatus }>(
        "log-meal",
        selectedTemplateId
          ? { ...base, source: "template", saved_meal_id: selectedTemplateId }
          : { ...base, source: "draft", raw_input: text, ai_parse_request_id: aiParseRequestId, items },
      );
      setLoggedMealId(result.meal_id);
      setLoggedDailyStatus(result.daily_log_status ?? null);
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
    setLoggedDailyStatus(null);
    setAiParseRequestId(null);
    setPortionInputs({});
    setExtremeConfirmedIds([]);
    setClarificationGrams({});
    setError(null);
    setSelectedTemplateId(null);
    setShowTemplatePicker(false);
    setTemplates([]);
    setTemplateTotal(0);
    idempotencyKey.current = generateUUID();
  }

  // ── Template helpers ────────────────────────────────────────────────────────

  async function openTemplatePicker() {
    setShowTemplatePicker(true);
    if (templates.length > 0) return;
    setTemplatesLoading(true);
    try {
      const result = await callFunction<{ templates: Template[]; total_count: number }>(
        "save-meal-template",
        { action: "list", limit: 10, offset: 0 },
      );
      setTemplates(result.templates ?? []);
      setTemplateTotal(result.total_count ?? 0);
    } catch (err: any) {
      setError(err.message ?? "Failed to load saved meals");
      setShowTemplatePicker(false);
    } finally {
      setTemplatesLoading(false);
    }
  }

  async function loadMoreTemplates() {
    setTemplatesLoading(true);
    try {
      const result = await callFunction<{ templates: Template[]; total_count: number }>(
        "save-meal-template",
        { action: "list", limit: 10, offset: templates.length },
      );
      setTemplates((prev) => [...prev, ...(result.templates ?? [])]);
      setTemplateTotal(result.total_count ?? 0);
    } catch (err: any) {
      setError(err.message ?? "Failed to load more templates");
    } finally {
      setTemplatesLoading(false);
    }
  }

  async function loadTemplate(template: Template) {
    setShowTemplatePicker(false);
    const hasText = text.trim().length > 0;
    // Only bind to source=template for a pure template load (no pre-typed text to merge).
    if (!hasText) setSelectedTemplateId(template.id);
    setLoading(true);
    setError(null);
    try {
      const templateResolved: ResolvedFoodItem[] = template.saved_meal_items
        .filter((ti) => ti.foods)
        .map((ti) => ({
          raw_phrase: ti.default_quantity != null
            ? `${ti.default_quantity} ${ti.default_unit ?? ""}`.trimEnd() + ` ${ti.foods.name}`
            : ti.foods.name,
          normalized_query: ti.foods.normalized_name,
          food_id: ti.food_id,
          quantity: ti.default_quantity,
          unit: ti.default_unit,
          match_confidence: "exact" as const,
          portion_confidence: ti.default_quantity != null
            ? ("exact" as const)
            : ("assumed_default" as const),
          item_confidence: "high" as const,
        }));

      let allResolved: ResolvedFoodItem[] = templateResolved;
      const allClarifications: ClarificationItem[] = [];

      // If user had text in the input, parse + resolve it and merge with template items.
      if (hasText) {
        const parsed = await callFunction<{ ai_parse_request_id: string; items: ParsedFoodItem[] }>(
          "parse-meal",
          { text },
        );
        setAiParseRequestId(parsed.ai_parse_request_id);

        if (parsed.items?.length > 0) {
          const resolved = await callFunction<{
            resolved_items: ResolvedFoodItem[];
            clarification_required: ClarificationItem[];
          }>("resolve-foods", { items: parsed.items });

          allClarifications.push(...(resolved.clarification_required ?? []));
          allResolved = [...(resolved.resolved_items ?? []), ...templateResolved];
        }
      }

      const calc = await callFunction<{
        items: CalculatedItem[];
        clarification_required: PortionClarificationResult[];
        meal_totals: MealTotals;
        meal_confidence: "high" | "medium" | "low";
      }>("calculate-meal", { resolved_items: allResolved, extreme_confirmed_ids: [] });

      for (const c of calc.clarification_required ?? []) {
        allClarifications.push({
          raw_phrase: c.raw_phrase,
          reason: "portion_clarification" as const,
          food_id: c.food_id,
          code: c.code,
          message: c.message,
          suggested_unit: c.suggested_unit,
          suggested_qty: c.suggested_qty,
        });
      }

      setItems(calc.items);
      setTotals(calc.meal_totals);
      setMealConfidence(calc.meal_confidence);
      setNeedsAttention(allClarifications);
      setStep("reviewing");
    } catch (err: any) {
      setError(err.message ?? "Failed to load template");
      setSelectedTemplateId(null);
    } finally {
      setLoading(false);
    }
  }

  const hasDefaultPortions = items.some((i) => i.portion_source === "default");
  const canConfirm = !loading && items.length > 0 && needsAttention.length === 0 && !hasDefaultPortions;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="font-display text-2xl font-semibold text-ink">Log a meal</h1>
      <p className="mt-1 text-sm text-muted">
        Describe what you ate — the app handles the lookup and the math.
      </p>

      {step !== "logged" && (
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Meal type</label>
            <MealTypeDropdown value={mealType} onChange={setMealType} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Date</label>
            <input
              type="date"
              value={logDate}
              min={minDateStr}
              max={todayStr}
              onChange={(e) => setLogDate(e.target.value || todayStr)}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>
      )}

      {step === "input" && (
        <div className="mt-4 space-y-4">
          <form onSubmit={handleParseAndResolve} className="space-y-4">
            <textarea
              required
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. 4 boiled eggs, small avo, bread with butter, tea"
              rows={3}
              maxLength={500}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={loading || text.trim().length === 0}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
              >
                {loading ? "Parsing…" : "Parse meal"}
              </button>
              <button
                type="button"
                onClick={openTemplatePicker}
                disabled={loading}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:border-primary hover:text-primary disabled:opacity-50"
              >
                Use saved meal
              </button>
            </div>
          </form>

          {showTemplatePicker && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
              onClick={() => setShowTemplatePicker(false)}
            >
              <div
                className="w-full max-w-sm rounded-xl border border-border bg-surface shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <p className="text-sm font-semibold text-ink">Saved meals</p>
                  <button onClick={() => setShowTemplatePicker(false)} className="text-lg leading-none text-muted hover:text-ink">×</button>
                </div>
                <div className="px-4 py-4">
                  {templatesLoading && <p className="text-sm text-muted">Loading…</p>}
                  {!templatesLoading && templates.length === 0 && (
                    <p className="text-sm text-muted">No saved meals yet. Log a meal and save it as a template from the history tab.</p>
                  )}
                  {!templatesLoading && templates.length > 0 && (
                    <>
                      <ul className="max-h-64 divide-y divide-border overflow-y-auto">
                        {templates.map((t) => (
                          <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-ink">
                                {t.is_favorite && <span className="mr-1 text-amber-500">★</span>}
                                {t.name}
                              </p>
                              <p className="text-xs text-muted">
                                {t.saved_meal_items.length} item{t.saved_meal_items.length !== 1 ? "s" : ""}
                                {t.usage_count > 0 && ` · used ${t.usage_count}×`}
                              </p>
                            </div>
                            <button
                              onClick={() => loadTemplate(t)}
                              className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                            >
                              {items.length > 0 ? "Add" : "Load"}
                            </button>
                          </li>
                        ))}
                      </ul>
                      {templates.length < templateTotal && (
                        <button
                          onClick={loadMoreTemplates}
                          disabled={templatesLoading}
                          className="mt-2 w-full rounded-lg border border-border py-2 text-xs text-muted hover:text-ink disabled:opacity-50"
                        >
                          {templatesLoading ? "Loading…" : `Load more (${templateTotal - templates.length} remaining)`}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-confidence-low">{error}</p>}
        </div>
      )}

      {step === "reviewing" && (
        <div className="mt-6 space-y-4">
          {needsAttention.length > 0 && (
            <div className="rounded-lg border border-confidence-low/30 bg-red-50 px-4 py-3 text-sm text-confidence-low dark:bg-red-950/30 dark:text-red-300">
              <p className="font-medium">These need a closer look:</p>
              <ul className="mt-1 list-inside space-y-2">
                {needsAttention.map((n, i) => {
                  if (n.reason === "food_form_ambiguous") {
                    return (
                      <li key={i} className="flex items-start gap-2">
                        <div className="flex-1">
                          <span className="font-medium">"{n.raw_phrase}"</span> — multiple food forms with very different calorie densities. Choose the form you ate:
                          <ul className="mt-1 ml-4 list-none space-y-1">
                            {n.options.map((opt, j) => (
                              <li key={j} className="flex items-center gap-2 text-xs">
                                <span className="flex-1">
                                  {opt.name} — {opt.calories_100g} kcal/100g
                                  {opt.serving_size_g ? ` · ${opt.serving_size_g}g serving` : ""}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleFoodFormSelection(i, n.raw_phrase, opt.food_id)}
                                  disabled={loading}
                                  className="rounded bg-primary px-2 py-0.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                                >
                                  Select
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <button
                          aria-label={`Remove ${n.raw_phrase} from clarifications`}
                          onClick={() => dismissClarification(i)}
                          className="mt-0.5 text-xs text-confidence-low/60 hover:text-confidence-low"
                        >
                          Remove
                        </button>
                      </li>
                    );
                  }
                  if (n.reason === "portion_clarification") {
                    const isExtreme = n.code === "EXTREME_PORTION";
                    const gramVal = clarificationGrams[i] ?? "";
                    const gramNum = parseFloat(gramVal);
                    const placeholder = n.suggested_qty ? String(Math.round(n.suggested_qty)) : "e.g. 120";
                    return (
                      <li key={i} className="flex items-start gap-2">
                        <div className="flex-1">
                          <span className="font-medium">"{n.raw_phrase}"</span> — {n.message}
                          {isExtreme && (
                            <button
                              onClick={() => confirmExtremePortion((n as any).food_id)}
                              className="ml-2 rounded bg-amber-500 px-2 py-0.5 text-xs font-medium text-white hover:bg-amber-600"
                            >
                              Confirm amount
                            </button>
                          )}
                          <div className="mt-1.5 flex items-center gap-2">
                            <input
                              type="number"
                              inputMode="decimal"
                              min="1"
                              max="5000"
                              placeholder={placeholder}
                              value={gramVal}
                              onChange={(e) =>
                                setClarificationGrams((prev) => ({ ...prev, [i]: e.target.value }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && gramNum > 0) resolveWithGrams(i, gramNum);
                              }}
                              className="w-24 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-amber-400 dark:border-amber-700 dark:bg-amber-950/50"
                            />
                            <span className="text-xs text-muted">g</span>
                            <button
                              type="button"
                              onClick={() => { if (gramNum > 0) resolveWithGrams(i, gramNum); }}
                              disabled={!(gramNum > 0) || loading}
                              className="rounded bg-amber-500 px-2 py-1 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50"
                            >
                              Set
                            </button>
                          </div>
                        </div>
                        <button
                          aria-label={`Remove ${n.raw_phrase} from clarifications`}
                          onClick={() => dismissClarification(i)}
                          className="mt-0.5 text-xs text-confidence-low/60 hover:text-confidence-low"
                        >
                          Remove
                        </button>
                      </li>
                    );
                  }
                  return (
                    <li key={i} className="flex items-start gap-2">
                      <span className="flex-1">
                        <span className="font-medium">"{n.raw_phrase}"</span> — {n.reason === "ambiguous" ? "unclear portion or type" : "no food match found"}
                      </span>
                      <button
                        aria-label={`Remove ${n.raw_phrase} from clarifications`}
                        onClick={() => dismissClarification(i)}
                        className="mt-0.5 text-xs text-confidence-low/60 hover:text-confidence-low"
                      >
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-xs text-confidence-low/80 dark:text-red-300/80">
                Resolve or remove all items above to enable logging.
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

          {hasDefaultPortions && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Some items have estimated portions (marked "portion?"). Set the actual gram weight before logging.
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleConfirm}
              disabled={!canConfirm}
              aria-disabled={!canConfirm}
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
            Meal logged.{" "}
            <span className="text-primary-dark/70">({loggedMealId})</span>
          </div>
          {loggedDailyStatus?.status === "partial" && loggedDailyStatus.reopened_at && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
              Today's log was re-opened because you added a meal after marking it complete.
            </div>
          )}

          <button onClick={reset} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark">
            Log another meal
          </button>
        </div>
      )}
    </div>
  );
}
