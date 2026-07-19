import { useEffect, useState } from "react";
import { callFunction } from "../lib/supabase";

interface DashboardData {
  date: string;
  totals: { calories: number; protein_g: number; carbs_g: number; fat_g: number; fibre_g: number };
  goal: { target_calories: number | null; target_protein_g: number | null } | null;
  percent_of_goal: { calories: number | null; protein_g: number | null } | null;
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callFunction<DashboardData>("dashboard-summary", {})
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="font-display text-2xl font-semibold text-ink">Today</h1>

      {error && <p className="mt-4 text-sm text-confidence-low">{error}</p>}

      {!data && !error && <p className="mt-4 text-sm text-muted">Loading…</p>}

      {data && (
        <div className="mt-6 space-y-4">
          <div className="rounded-lg border border-border bg-surface px-5 py-4">
            <p className="font-display text-3xl font-semibold text-ink">{data.totals.calories}</p>
            <p className="text-sm text-muted">
              kcal today
              {data.percent_of_goal?.calories != null && (
                <span> · {data.percent_of_goal.calories}% of goal</span>
              )}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Stat label="Protein" value={`${data.totals.protein_g}g`} />
            <Stat label="Carbs" value={`${data.totals.carbs_g}g`} />
            <Stat label="Fat" value={`${data.totals.fat_g}g`} />
          </div>

          {!data.goal && (
            <p className="text-sm text-muted">No goal set yet — totals shown without a target.</p>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3 text-center">
      <p className="font-display text-lg font-semibold text-ink">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}
