import { Link } from "react-router-dom";
import { GoalPhase, WeightChange } from "../lib/goalTypes";

interface Props {
  phase: GoalPhase;
  weightChange: WeightChange | null;
}

const MODE_LABEL: Record<string, string> = {
  cut: "Cut",
  maintenance: "Maintenance",
  bulk: "Bulk",
};

const MODE_BADGE_CLASS: Record<string, string> = {
  cut: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  maintenance: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  bulk: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
};

export default function GoalPhaseCard({ phase, weightChange }: Props) {
  const startDate = new Date(phase.started_at).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const RATE_SUFFIX: Record<string, string> = { cut: "loss", bulk: "gain", maintenance: "change" };
  const weeklyRateLabel =
    phase.target_change_kg_per_week != null
      ? `${Math.abs(phase.target_change_kg_per_week)} kg/week ${RATE_SUFFIX[phase.mode] ?? "change"}`
      : null;

  return (
    <div className="rounded-lg border border-border bg-surface px-5 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              MODE_BADGE_CLASS[phase.mode] ?? "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
            }`}
          >
            {MODE_LABEL[phase.mode] ?? phase.mode}
          </span>
          <span className="text-xs text-muted">since {startDate}</span>
        </div>
        <Link
          to="/goals"
          className="text-xs text-primary hover:underline"
          aria-label="Manage goals"
        >
          Manage
        </Link>
      </div>

      {/* Targets row */}
      {(phase.target_calories != null || weeklyRateLabel) && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          {phase.target_calories != null && (
            <p className="text-sm text-ink">
              <span className="font-semibold">{phase.target_calories}</span>{" "}
              <span className="text-muted">kcal target</span>
            </p>
          )}
          {weeklyRateLabel && (
            <p className="text-sm text-ink">
              <span className="font-semibold">{weeklyRateLabel}</span>
            </p>
          )}
          {phase.target_weight_kg != null && (
            <p className="text-sm text-ink">
              <span className="text-muted">goal </span>
              <span className="font-semibold">{phase.target_weight_kg} kg</span>
            </p>
          )}
        </div>
      )}

      {/* Observed weight change — raw data only, no interpretation */}
      {weightChange && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-xs text-muted">Observed weight change</p>
          <div className="mt-1 flex items-baseline gap-2">
            <p className="text-sm font-semibold text-ink">
              {weightChange.latest_weight_kg != null
                ? `${weightChange.latest_weight_kg} kg`
                : "No weight logged yet"}
            </p>
            {weightChange.change_kg != null && (
              <p
                className={`text-xs font-medium ${
                  weightChange.change_kg < 0
                    ? "text-green-600 dark:text-green-400"
                    : weightChange.change_kg > 0
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-muted"
                }`}
              >
                {weightChange.change_kg > 0 ? "+" : ""}
                {weightChange.change_kg} kg in {weightChange.days_in_phase}d
              </p>
            )}
          </div>
          <p className="text-xs text-muted">
            Starting: {weightChange.starting_weight_kg} kg
          </p>
        </div>
      )}
    </div>
  );
}
