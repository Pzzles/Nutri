import { useState, useEffect, useCallback } from "react";
import { callFunction, getFunction } from "../lib/supabase";
import type { GetMealsResponse, MealData, MealItemData } from "../lib/mealTypes";
import { MealTypeDropdown, type MealType } from "../components/MealTypeDropdown";

// ── date helpers ──────────────────────────────────────────────────────────────

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function addDays(dateStr: string, delta: number): string {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, mo - 1, d + delta);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function formatDateLabel(dateStr: string): string {
  const [y, mo, d] = dateStr.split("-").map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatQuantity(item: MealItemData): string {
  if (item.weight_g == null) return "—";
  const g = Math.round(item.weight_g);
  if (!item.unit || item.unit === "g") return `${g}g`;
  return `${item.quantity ?? g} ${item.unit} (${g}g)`;
}

const r0 = (n: number) => Math.round(n);

const MEAL_LABEL: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

// ── types for local interaction state ────────────────────────────────────────

interface EditState {
  itemId: string;
  mealId: string;
  draft: string;
}

interface ConfirmState {
  type: "meal" | "item";
  mealId: string;
  itemId?: string;
}



interface LogAgainState {
  mealId: string;
  mealType: MealType;
  busy: boolean;
  error: string | null;
}

// ── sub-components ────────────────────────────────────────────────────────────

function MacroRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-[10px] uppercase tracking-wide text-muted">{label}</p>
      <p className="text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z" />
    </svg>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function MealHistory({ embedded = false }: { embedded?: boolean }) {
  const [date, setDate] = useState(todayStr);
  const [data, setData] = useState<GetMealsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editState, setEditState] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState<ConfirmState | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [logAgain, setLogAgain] = useState<LogAgainState | null>(null);

  const loadDate = useCallback(async (d: string) => {
    setLoading(true);
    setPageError(null);
    setEditState(null);
    setConfirmDel(null);
    try {
      const resp = await getFunction<GetMealsResponse>("get-meals", { date: d });
      setData(resp);
      setExpanded(new Set(resp.meals.map((m) => m.id)));
    } catch (err: any) {
      setPageError(err.message ?? "Failed to load meals");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDate(date);
  }, [date, loadDate]);

  function toggleExpand(mealId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(mealId) ? next.delete(mealId) : next.add(mealId);
      return next;
    });
  }

  function startEdit(item: MealItemData, mealId: string) {
    setConfirmDel(null);
    setEditState({
      itemId: item.id,
      mealId,
      draft: String(item.weight_g != null ? Math.round(item.weight_g) : ""),
    });
  }

  async function handleSaveEdit() {
    if (!editState) return;
    const weightG = parseFloat(editState.draft);
    if (isNaN(weightG) || weightG <= 0) return;
    setSaving(true);
    try {
      await callFunction("edit-meal-item", {
        meal_id: editState.mealId,
        item_id: editState.itemId,
        weight_g: weightG,
      });
      setEditState(null);
      await loadDate(date);
    } catch (err: any) {
      setPageError(err.message ?? "Failed to save edit");
    } finally {
      setSaving(false);
    }
  }

  function requestDelete(type: "meal" | "item", mealId: string, itemId?: string) {
    setEditState(null);
    setConfirmDel({ type, mealId, itemId });
  }

  async function handleDelete() {
    if (!confirmDel) return;
    setDeleting(true);
    try {
      await callFunction("delete-meal", {
        meal_id: confirmDel.mealId,
        ...(confirmDel.itemId ? { item_id: confirmDel.itemId } : {}),
      });
      setConfirmDel(null);
      await loadDate(date);
    } catch (err: any) {
      setPageError(err.message ?? "Failed to delete");
    } finally {
      setDeleting(false);
    }
  }

  async function handleLogAgain(meal: MealData) {
    if (!logAgain) return;
    setLogAgain((s) => s && { ...s, busy: true, error: null });
    try {
      await callFunction("log-meal", {
        idempotency_key: crypto.randomUUID(),
        meal_type: logAgain.mealType,
        eaten_at: new Date().toISOString(),
        source: "draft",
        raw_input: `REPEAT:${meal.id}`,
        meal_confidence: meal.meal_confidence,
        items: meal.items.map((item) => ({
          food_id: item.food_id,
          raw_phrases: [item.food_name],
          quantity: item.quantity,
          unit: item.unit,
          weight_g: item.weight_g,
          calories: item.calories,
          protein_g: item.protein_g,
          carbs_g: item.carbs_g,
          fat_g: item.fat_g,
          fibre_g: item.fibre_g,
          match_confidence: item.match_confidence,
          portion_confidence: item.portion_confidence,
          item_confidence: item.confidence,
          portion_g: item.weight_g,
          nutrition_source: "repeat",
        })),
      });
      setLogAgain(null);
      if (date === todayStr()) await loadDate(date);
    } catch (err: any) {
      setLogAgain((s) => s && { ...s, busy: false, error: err.message ?? "Failed to log meal." });
    }
  }

  const isToday = date === todayStr();

  return (
    <div className={embedded ? "px-4 pb-4 pt-2" : "mx-auto max-w-lg px-4 py-6"}>
      {/* Date navigation */}
      <div className="mb-5 flex items-center gap-3">
        <button
          onClick={() => setDate((d) => addDays(d, -1))}
          className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full border border-border text-muted hover:border-primary hover:text-primary transition-colors"
          aria-label="Previous day"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-sm font-semibold text-ink">{formatDateLabel(date)}</p>
          {!isToday && (
            <button
              onClick={() => setDate(todayStr())}
              className="text-xs text-primary hover:underline"
            >
              Back to today
            </button>
          )}
        </div>

        <button
          onClick={() => setDate((d) => addDays(d, 1))}
          disabled={isToday}
          className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full border border-border text-muted hover:border-primary hover:text-primary transition-colors disabled:opacity-30 disabled:pointer-events-none"
          aria-label="Next day"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>

      {/* Status feedback */}
      {loading && <p className="py-8 text-center text-sm text-muted">Loading…</p>}
      {pageError && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {pageError}
        </div>
      )}

      {/* Content */}
      {data && !loading && (
        <div className="space-y-3">
          {data.meals.length === 0 && (
            <p className="py-10 text-center text-sm text-muted">No meals logged for this date.</p>
          )}

          {/* Day totals — only when there is food */}
          {data.meals.length > 0 && (
            <div className="rounded-xl border border-border bg-surface p-3">
              <p className="mb-2 text-[10px] uppercase tracking-wide text-muted">Day total</p>
              <div className="grid grid-cols-5 gap-1">
                <MacroRow label="Cal" value={String(r0(data.day_totals.calories))} />
                <MacroRow label="Protein" value={`${r0(data.day_totals.protein_g)}g`} />
                <MacroRow label="Carbs" value={`${r0(data.day_totals.carbs_g)}g`} />
                <MacroRow label="Fat" value={`${r0(data.day_totals.fat_g)}g`} />
                <MacroRow label="Fibre" value={`${r0(data.day_totals.fibre_g)}g`} />
              </div>
            </div>
          )}

          {/* Meal cards */}
          {data.meals.map((meal) => {
            const open = expanded.has(meal.id);
            const isDeletingMeal =
              confirmDel?.type === "meal" && confirmDel.mealId === meal.id;

            return (
              <div
                key={meal.id}
                className="rounded-xl border border-border bg-surface overflow-hidden"
              >
                {/* Meal header */}
                <div className="flex items-center gap-2 px-4 py-3">
                  <button
                    onClick={() => toggleExpand(meal.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <ChevronIcon open={open} />
                    <span className="font-medium text-ink text-sm">
                      {MEAL_LABEL[meal.meal_type] ?? meal.meal_type}
                    </span>
                    <span className="text-xs text-muted">{formatTime(meal.eaten_at)}</span>
                    <span className="ml-auto text-xs font-semibold text-ink">
                      {r0(meal.totals.calories)} kcal
                    </span>
                  </button>

                  {/* Meal delete */}
                  {isDeletingMeal ? (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-xs text-muted">Delete meal?</span>
                      <button
                        onClick={handleDelete}
                        disabled={deleting}
                        className="rounded px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50"
                      >
                        {deleting ? "Deleting…" : "Yes"}
                      </button>
                      <button
                        onClick={() => setConfirmDel(null)}
                        className="text-xs text-muted hover:text-ink"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => { setLogAgain({ mealId: meal.id, mealType: meal.meal_type, busy: false, error: null }); setConfirmDel(null); setEditState(null); }}
                        className="flex-shrink-0 text-xs text-primary hover:underline"
                      >
                        Log again
                      </button>
                      <button
                        onClick={() => requestDelete("meal", meal.id)}
                        className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full text-muted hover:text-red-500 transition-colors"
                        aria-label="Delete meal"
                      >
                        <TrashIcon />
                      </button>
                    </>
                  )}
                </div>

                {/* Log again panel */}
                {logAgain?.mealId === meal.id && (
                  <div className="border-t border-border px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <MealTypeDropdown
                        value={logAgain.mealType}
                        onChange={(v) => setLogAgain((s) => s && { ...s, mealType: v })}
                        disabled={logAgain.busy}
                      />
                      <button
                        onClick={() => handleLogAgain(meal)}
                        disabled={logAgain.busy}
                        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
                      >
                        {logAgain.busy ? "Logging…" : "Log"}
                      </button>
                      <button
                        onClick={() => setLogAgain(null)}
                        disabled={logAgain.busy}
                        className="text-sm text-muted hover:text-ink disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                    {logAgain.error && (
                      <p className="mt-2 text-xs text-confidence-low">{logAgain.error}</p>
                    )}
                  </div>
                )}

                {/* Items list */}
                {open && (
                  <div className="border-t border-border divide-y divide-border">
                    {meal.items.length === 0 && (
                      <p className="px-4 py-3 text-xs text-muted">No items in this meal.</p>
                    )}
                    {meal.items.map((item) => {
                      const isEditing =
                        editState?.itemId === item.id && editState.mealId === meal.id;
                      const isDeletingItem =
                        confirmDel?.type === "item" &&
                        confirmDel.itemId === item.id &&
                        confirmDel.mealId === meal.id;

                      return (
                        <div key={item.id} className="px-4 py-3">
                          {/* Item name + actions row */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm text-ink font-medium">
                                {item.food_name}
                                {item.brand && (
                                  <span className="ml-1 text-xs text-muted font-normal">
                                    {item.brand}
                                  </span>
                                )}
                              </p>
                              <p className="text-xs text-muted">{formatQuantity(item)}</p>
                            </div>

                            {!isEditing && !isDeletingItem && (
                              <div className="flex flex-shrink-0 items-center gap-1">
                                <button
                                  onClick={() => startEdit(item, meal.id)}
                                  className="grid h-6 w-6 place-items-center rounded text-muted hover:text-primary transition-colors"
                                  aria-label="Edit quantity"
                                >
                                  <PencilIcon />
                                </button>
                                <button
                                  onClick={() => requestDelete("item", meal.id, item.id)}
                                  className="grid h-6 w-6 place-items-center rounded text-muted hover:text-red-500 transition-colors"
                                  aria-label="Delete item"
                                >
                                  <TrashIcon />
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Nutrition row */}
                          <p className="mt-1 text-xs text-muted">
                            {r0(item.calories)} kcal · P {r0(item.protein_g)}g · C {r0(item.carbs_g)}g · F {r0(item.fat_g)}g{item.fibre_g != null ? ` · Fi ${r0(item.fibre_g)}g` : ""}
                          </p>

                          {/* Inline edit form */}
                          {isEditing && (
                            <div className="mt-2 flex items-center gap-2">
                              <div className="flex items-center gap-1 rounded-lg border border-border bg-bg px-2 py-1">
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  min="1"
                                  max="5000"
                                  value={editState.draft}
                                  onChange={(e) =>
                                    setEditState((s) => s && { ...s, draft: e.target.value })
                                  }
                                  className="w-20 bg-transparent text-sm text-ink outline-none"
                                  placeholder="grams"
                                  autoFocus
                                />
                                <span className="text-xs text-muted">g</span>
                              </div>
                              <button
                                onClick={handleSaveEdit}
                                disabled={saving}
                                className="rounded-lg bg-primary px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                              >
                                {saving ? "Saving…" : "Save"}
                              </button>
                              <button
                                onClick={() => setEditState(null)}
                                className="text-xs text-muted hover:text-ink"
                              >
                                Cancel
                              </button>
                            </div>
                          )}

                          {/* Inline delete confirmation */}
                          {isDeletingItem && (
                            <div className="mt-2 flex items-center gap-2">
                              <span className="text-xs text-muted">Remove this item?</span>
                              <button
                                onClick={handleDelete}
                                disabled={deleting}
                                className="rounded px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50"
                              >
                                {deleting ? "Removing…" : "Yes"}
                              </button>
                              <button
                                onClick={() => setConfirmDel(null)}
                                className="text-xs text-muted hover:text-ink"
                              >
                                No
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
