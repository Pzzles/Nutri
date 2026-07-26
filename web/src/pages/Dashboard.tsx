import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { callFunction } from "../lib/supabase";
import { GoalPhase, DailyLogStatus, WeightChange } from "../lib/goalTypes";
import GoalPhaseCard from "../components/GoalPhaseCard";
import DailyStatusControl from "../components/DailyStatusControl";
import MealHistory from "./MealHistory";

interface LatestWeight {
  weight_kg: number;
  measured_at: string;
  logged_date: string;
}

interface DashboardData {
  date: string;
  totals: { calories: number; protein_g: number; carbs_g: number; fat_g: number; fibre_g: number };
  goal: { target_calories: number | null; target_protein_g: number | null } | null;
  percent_of_goal: { calories: number | null; protein_g: number | null } | null;
  active_phase: GoalPhase | null;
  daily_log_status: DailyLogStatus;
  weight_change: WeightChange | null;
  latest_weight: LatestWeight | null;
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dailyStatus, setDailyStatus] = useState<DailyLogStatus | null>(null);
  const [mealsOpen, setMealsOpen] = useState(false);

  useEffect(() => {
    callFunction<DashboardData>("dashboard-summary", {})
      .then((d) => {
        setData(d);
        setDailyStatus(d.daily_log_status);
      })
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="font-display text-2xl font-semibold text-ink">Dashboard</h1>

      {error && <p className="mt-4 text-sm text-confidence-low">{error}</p>}
      {!data && !error && <p className="mt-4 text-sm text-muted">Loading…</p>}

      {data && (
        <div className="mt-6 space-y-4">
          {/* Active goal phase card */}
          {data.active_phase && (
            <GoalPhaseCard
              phase={data.active_phase}
              weightChange={data.weight_change}
            />
          )}

          {/* Calories */}
          <div className="rounded-lg border border-border bg-surface px-5 py-4">
            <p className="font-display text-3xl font-semibold text-ink">{data.totals.calories}</p>
            <p className="text-sm text-muted">
              kcal today
              {data.percent_of_goal?.calories != null && (
                <span> · {data.percent_of_goal.calories}% of goal</span>
              )}
            </p>
          </div>

          {/* Macros */}
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Protein" value={`${data.totals.protein_g}g`} />
            <Stat label="Carbs" value={`${data.totals.carbs_g}g`} />
            <Stat label="Fat" value={`${data.totals.fat_g}g`} />
          </div>

          {/* Meals widget — expandable history panel */}
          <div className="rounded-lg border border-border bg-surface overflow-hidden">
            <button
              onClick={() => setMealsOpen((o) => !o)}
              className="flex w-full items-center justify-between px-5 py-3 text-left hover:bg-surface-hover transition-colors"
            >
              <span className="text-sm font-medium text-ink">Meals</span>
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted">{data.totals.calories} kcal today</span>
                <ChevronIcon open={mealsOpen} />
              </div>
            </button>
            {mealsOpen && (
              <div className="border-t border-border">
                <MealHistory embedded />
              </div>
            )}
          </div>

          {/* Latest weight tile */}
          <Link
            to="/progress"
            className="flex items-center justify-between rounded-lg border border-border bg-surface px-5 py-3 hover:border-primary transition-colors"
            aria-label="View weight & goals"
          >
            <div>
              {data.latest_weight ? (
                <>
                  <p className="font-display text-xl font-semibold text-ink">
                    {data.latest_weight.weight_kg}{" "}
                    <span className="text-sm font-normal text-muted">kg</span>
                  </p>
                  <p className="text-xs text-muted">
                    {formatDate(data.latest_weight.logged_date)}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted">No weight logged yet</p>
              )}
            </div>
            <span className="text-xs text-primary">Progress →</span>
          </Link>

          {/* Daily log completeness */}
          <DailyStatusControl
            date={data.date}
            status={dailyStatus?.status ?? "unknown"}
            onStatusChange={setDailyStatus}
          />

          {!data.goal && !data.active_phase && (
            <p className="text-sm text-muted">
              No goal set yet —{" "}
              <Link to="/progress" className="text-primary hover:underline">
                start a phase
              </Link>{" "}
              to track progress.
            </p>
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

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-4 w-4 text-muted transition-transform ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
