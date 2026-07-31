import { useEffect, useRef, useState } from "react";
import { callFunction } from "../lib/supabase";
import { FoodSearchResult } from "../lib/types";

// ── Create custom food ────────────────────────────────────────────────────────

const COUNT_UNITS = ["piece", "slice", "cup", "tbsp", "tsp", "scoop", "sachet"];
const ALL_UNITS = ["g", "ml", ...COUNT_UNITS];

interface CreateForm {
  name: string;
  serving_size: string;
  serving_unit: string;
  gram_per_serving: string;
  calories: string;
  protein_g: string;
  carbs_g: string;
  fat_g: string;
  fibre_g: string;
}

const BLANK_FORM: CreateForm = {
  name: "", serving_size: "1", serving_unit: "piece",
  gram_per_serving: "", calories: "", protein_g: "",
  carbs_g: "", fat_g: "", fibre_g: "",
};

function CreateCustomFoodForm({ onCreated }: { onCreated: (name: string) => void }) {
  const [form, setForm] = useState<CreateForm>(BLANK_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isCountUnit = COUNT_UNITS.includes(form.serving_unit);
  const set = (k: keyof CreateForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const name = form.name.trim();
    if (!name) { setError("Name is required."); return; }
    const servingSize = parseFloat(form.serving_size);
    if (!servingSize || servingSize <= 0) { setError("Serving size must be > 0."); return; }
    const cal = parseFloat(form.calories);
    const prot = parseFloat(form.protein_g);
    const carb = parseFloat(form.carbs_g);
    const fat = parseFloat(form.fat_g);
    if ([cal, prot, carb, fat].some(isNaN)) { setError("Calories, protein, carbs, and fat are required."); return; }

    const body: Record<string, any> = {
      name, serving_size: servingSize, serving_unit: form.serving_unit,
      calories: cal, protein_g: prot, carbs_g: carb, fat_g: fat,
    };
    if (form.fibre_g !== "") body.fibre_g = parseFloat(form.fibre_g);
    if (isCountUnit && form.gram_per_serving !== "") body.gram_per_serving = parseFloat(form.gram_per_serving);

    setSubmitting(true);
    try {
      await callFunction("create-custom-food", body);
      setSuccess(`"${name}" saved. You can now log it by name.`);
      setForm(BLANK_FORM);
      onCreated(name);
    } catch (err: any) {
      setError(err.message ?? "Failed to create food.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary";
  const labelCls = "mb-1 block text-xs font-medium text-muted";

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-4 rounded-lg border border-border bg-surface px-5 py-5">
      <p className="text-sm font-semibold text-ink">Create custom food</p>

      <div>
        <label className={labelCls}>Food name</label>
        <input required value={form.name} onChange={set("name")} placeholder="e.g. Homemade roti" className={inputCls} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Serving size</label>
          <input type="number" min="0.01" step="any" required value={form.serving_size} onChange={set("serving_size")} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Unit</label>
          <select value={form.serving_unit} onChange={set("serving_unit")} className={inputCls}>
            {ALL_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
      </div>

      {isCountUnit && (
        <div>
          <label className={labelCls}>Grams per {form.serving_unit} <span className="text-muted font-normal">(optional — enables "1 {form.serving_unit}" logging without a weight prompt)</span></label>
          <input type="number" min="1" step="any" value={form.gram_per_serving} onChange={set("gram_per_serving")} placeholder="e.g. 80" className={inputCls} />
        </div>
      )}

      <p className="text-xs text-muted">Macros per serving ({form.serving_size || "?"} {form.serving_unit})</p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([
          { key: "calories", label: "Calories (kcal)" },
          { key: "protein_g", label: "Protein (g)" },
          { key: "carbs_g", label: "Carbs (g)" },
          { key: "fat_g", label: "Fat (g)" },
        ] as const).map(({ key, label }) => (
          <div key={key}>
            <label className={labelCls}>{label}</label>
            <input type="number" min="0" step="any" required value={form[key]} onChange={set(key)} className={inputCls} />
          </div>
        ))}
      </div>

      <div className="w-1/2">
        <label className={labelCls}>Fibre (g) <span className="font-normal text-muted">optional</span></label>
        <input type="number" min="0" step="any" value={form.fibre_g} onChange={set("fibre_g")} className={inputCls} />
      </div>

      {error && <p className="text-sm text-confidence-low">{error}</p>}
      {success && <p className="text-sm text-confidence-high">{success}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? "Saving…" : "Save food"}
      </button>
    </form>
  );
}

const MAX_COMPARE = 4;

function fmt(n: number | null | undefined, decimals = 1) {
  if (n == null) return "—";
  return Number(n).toFixed(decimals);
}

function SourceBadge({ source }: { source: string }) {
  const label: Record<string, string> = {
    usda_fdc: "USDA",
    open_food_facts: "OFF",
    user_manual: "Custom",
    imported: "Import",
  };
  return (
    <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted">
      {label[source] ?? source}
    </span>
  );
}

function MacroRow({ label, value, unit = "g" }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-xs font-medium text-ink">
        {value !== "—" ? `${value}${unit}` : "—"}
      </span>
    </div>
  );
}

function FoodCard({
  food,
  inCompare,
  onToggle,
}: {
  food: FoodSearchResult;
  inCompare: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{food.name}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            {food.brand && <span className="text-xs text-muted">{food.brand}</span>}
            <SourceBadge source={food.source} />
            {food.match_type === "fuzzy" && food.similarity != null && (
              <span className="text-[10px] text-muted">
                {Math.round(food.similarity * 100)}% match
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onToggle}
          disabled={!inCompare && false}
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            inCompare
              ? "bg-primary text-white"
              : "border border-border text-muted hover:border-primary hover:text-primary"
          }`}
        >
          {inCompare ? "Added" : "+ Compare"}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2 border-t border-border pt-3">
        {[
          { label: "Calories", value: fmt(food.calories_100g, 0), unit: " kcal" },
          { label: "Protein", value: fmt(food.protein_100g), unit: "g" },
          { label: "Carbs", value: fmt(food.carbs_100g), unit: "g" },
          { label: "Fat", value: fmt(food.fat_100g), unit: "g" },
        ].map(({ label, value, unit }) => (
          <div key={label} className="text-center">
            <p className="text-sm font-semibold text-ink">
              {value}
              <span className="text-[10px] font-normal text-muted">{unit}</span>
            </p>
            <p className="text-[10px] text-muted">{label}</p>
          </div>
        ))}
      </div>
      <p className="mt-1 text-right text-[10px] text-muted">per 100 g</p>
    </div>
  );
}

function ComparisonTable({ foods, onRemove }: { foods: FoodSearchResult[]; onRemove: (id: string) => void }) {
  const rows: { label: string; key: keyof FoodSearchResult; unit: string; decimals?: number }[] = [
    { label: "Calories", key: "calories_100g", unit: "kcal", decimals: 0 },
    { label: "Protein", key: "protein_100g", unit: "g" },
    { label: "Carbs", key: "carbs_100g", unit: "g" },
    { label: "Fat", key: "fat_100g", unit: "g" },
    { label: "Fibre", key: "fibre_100g", unit: "g" },
    { label: "Serving", key: "serving_size_g", unit: "g", decimals: 0 },
  ];

  // Highlight the best (lowest for fat, highest for protein) — per row
  const highlights = rows.reduce<Record<string, string>>((acc, row) => {
    const vals = foods.map((f) => Number(f[row.key] ?? 0));
    const best =
      row.key === "fat_100g"
        ? Math.min(...vals)
        : row.key === "protein_100g" || row.key === "calories_100g"
        ? Math.max(...vals.filter((v) => v > 0))
        : null;
    if (best !== null && best !== Infinity && best !== -Infinity) {
      const bestIdx = vals.indexOf(best);
      if (bestIdx !== -1) acc[`${row.key}-${foods[bestIdx].id}`] = row.key === "fat_100g" ? "low" : "high";
    }
    return acc;
  }, {});

  return (
    <div className="mt-8">
      <h2 className="font-display text-base font-semibold text-ink">
        Comparison{" "}
        <span className="text-sm font-normal text-muted">({foods.length} foods · per 100 g)</span>
      </h2>

      <div className="mt-3 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface">
              <th className="px-4 py-2 text-left text-xs font-medium text-muted">Nutrient</th>
              {foods.map((f) => (
                <th key={f.id} className="min-w-[120px] px-4 py-2 text-left">
                  <div className="flex items-start justify-between gap-1">
                    <span className="text-xs font-medium text-ink leading-tight">{f.name}</span>
                    <button
                      onClick={() => onRemove(f.id)}
                      className="shrink-0 text-[10px] text-muted hover:text-confidence-low"
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                  {f.brand && <p className="text-[10px] text-muted">{f.brand}</p>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={row.key} className={ri % 2 === 0 ? "" : "bg-surface"}>
                <td className="px-4 py-2 text-xs text-muted">{row.label}</td>
                {foods.map((f) => {
                  const raw = f[row.key] as number | null;
                  const val = raw != null ? Number(raw).toFixed(row.decimals ?? 1) : "—";
                  const highlightKey = `${row.key}-${f.id}`;
                  const hl = highlights[highlightKey];
                  return (
                    <td
                      key={f.id}
                      className={`px-4 py-2 text-xs font-medium ${
                        hl === "high"
                          ? "text-confidence-high"
                          : hl === "low"
                          ? "text-confidence-low"
                          : "text-ink"
                      }`}
                    >
                      {val !== "—" ? `${val} ${row.unit}` : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-right text-[10px] text-muted">
        Green = highest protein / most calories · Red = most fat
      </p>
    </div>
  );
}

export default function SearchFood() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoodSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compareList, setCompareList] = useState<FoodSearchResult[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setError(null);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await callFunction<{ results: FoodSearchResult[] }>("search-food", { query: trimmed });
        setResults(data.results);
      } catch (err: any) {
        setError(err.message ?? "Search failed");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 350);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function toggleCompare(food: FoodSearchResult) {
    setCompareList((prev) => {
      if (prev.some((f) => f.id === food.id)) return prev.filter((f) => f.id !== food.id);
      if (prev.length >= MAX_COMPARE) return prev;
      return [...prev, food];
    });
  }

  const compareIds = new Set(compareList.map((f) => f.id));

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Food search</h1>
          <p className="mt-1 text-sm text-muted">
            Search by name, then add foods to compare them side by side.
          </p>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className={`shrink-0 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
            showCreate
              ? "border-primary bg-primary text-white"
              : "border-border text-muted hover:border-primary hover:text-primary"
          }`}
        >
          {showCreate ? "Cancel" : "+ Custom food"}
        </button>
      </div>

      {showCreate && (
        <CreateCustomFoodForm
          onCreated={(name) => {
            setShowCreate(false);
            setQuery(name);
          }}
        />
      )}

      <div className="mt-6">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. avocado, chicken breast, oats…"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          autoFocus
        />
      </div>

      {loading && <p className="mt-4 text-sm text-muted">Searching…</p>}
      {error && <p className="mt-4 text-sm text-confidence-low">{error}</p>}

      {!loading && !error && query.trim().length >= 2 && results.length === 0 && (
        <p className="mt-4 text-sm text-muted">
          No foods found for "{query.trim()}".{" "}
          {!showCreate && (
            <button
              onClick={() => setShowCreate(true)}
              className="font-medium text-primary hover:underline"
            >
              Create a custom food?
            </button>
          )}
        </p>
      )}

      {results.length > 0 && (
        <div className="mt-4 space-y-2">
          {compareList.length > 0 && compareList.length < 2 && (
            <p className="text-xs text-muted">Add one more food to start comparing.</p>
          )}
          {compareList.length >= MAX_COMPARE && (
            <p className="text-xs text-muted">
              Max {MAX_COMPARE} foods in compare. Remove one to add another.
            </p>
          )}
          {results.map((food) => (
            <FoodCard
              key={food.id}
              food={food}
              inCompare={compareIds.has(food.id)}
              onToggle={() => toggleCompare(food)}
            />
          ))}
        </div>
      )}

      {compareList.length >= 2 && (
        <ComparisonTable foods={compareList} onRemove={(id) => setCompareList((p) => p.filter((f) => f.id !== id))} />
      )}
    </div>
  );
}
