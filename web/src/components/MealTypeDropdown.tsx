export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

const LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

export function MealTypeDropdown({
  value,
  onChange,
  disabled,
}: {
  value: MealType;
  onChange: (v: MealType) => void;
  disabled?: boolean;
}) {
  return (
    <div className="relative inline-block">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as MealType)}
        disabled={disabled}
        className="appearance-none cursor-pointer rounded-lg border border-border bg-surface px-3 py-2 pr-8 text-sm text-ink outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        {(Object.keys(LABELS) as MealType[]).map((t) => (
          <option key={t} value={t}>{LABELS[t]}</option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </span>
    </div>
  );
}
