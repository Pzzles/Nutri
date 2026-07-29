import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { callFunction } from "../lib/supabase";
import { GoalPhase, DailyLogStatus, WeightChange } from "../lib/goalTypes";
import GoalPhaseCard from "../components/GoalPhaseCard";
import DailyStatusControl from "../components/DailyStatusControl";
import MealHistory from "./MealHistory";
import { WeekCalorieChart, WeekDay } from "../components/charts/WeekCalorieChart";
import { MacroRingChart } from "../components/charts/MacroRingChart";

interface LatestWeight {
  weight_kg: number;
  measured_at: string;
  logged_date: string;
}

interface DashboardData {
  date: string;
  totals: { calories: number; protein_g: number; carbs_g: number; fat_g: number; fibre_g: number };
  goal: { target_calories: number | null; target_protein_g: number | null } | null;
  percent_of_goal: { calories: number | null; protein_g: number | null; fibre_g: number | null } | null;
  active_phase: GoalPhase | null;
  daily_log_status: DailyLogStatus;
  weight_change: WeightChange | null;
  latest_weight: LatestWeight | null;
  week_trend: WeekDay[];
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
            <GoalPhaseCard phase={data.active_phase} weightChange={data.weight_change} />
          )}

          {/* 7-day calorie trend */}
          {data.week_trend?.length > 0 && (
            <div className="rounded-lg border border-border bg-surface px-4 pt-4 pb-2">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">This week</p>
                {data.goal?.target_calories && (
                  <p className="text-xs text-muted">
                    Goal: {data.goal.target_calories} kcal
                  </p>
                )}
              </div>
              <WeekCalorieChart
                data={data.week_trend}
                target={data.goal?.target_calories ?? null}
              />
            </div>
          )}

          {/* Today: macro ring + calorie summary */}
          <div className="rounded-lg border border-border bg-surface px-5 py-4">
            <div className="flex items-center gap-5">
              <MacroRingChart
                protein={data.totals.protein_g}
                carbs={data.totals.carbs_g}
                fat={data.totals.fat_g}
                calories={data.totals.calories}
              />
              <div className="min-w-0 flex-1">
                <p className="font-display text-3xl font-semibold text-ink leading-none">
                  {data.totals.calories}
                  <span className="ml-1.5 text-base font-normal text-muted">kcal</span>
                </p>
                {data.percent_of_goal?.calories != null && (
                  <p className="mt-0.5 text-xs text-muted">{data.percent_of_goal.calories}% of goal</p>
                )}
                <div className="mt-3 grid grid-cols-4 gap-x-2 text-center">
                  <MacroStat label="Protein" value={data.totals.protein_g} color="#0094FF" />
                  <MacroStat label="Carbs" value={data.totals.carbs_g} color="#F59E0B" />
                  <MacroStat label="Fat" value={data.totals.fat_g} color="#EF4444" />
                  <MacroStat label="Fibre" value={data.totals.fibre_g} color="#22C55E" />
                </div>
              </div>
            </div>
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
                  <p className="text-xs text-muted">{formatDate(data.latest_weight.logged_date)}</p>
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

function MacroStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <p className="text-sm font-semibold text-ink">{value}g</p>
      <p className="text-xs" style={{ color }}>{label}</p>
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
