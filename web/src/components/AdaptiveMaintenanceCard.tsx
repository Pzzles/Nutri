import { useState, useEffect, useCallback } from "react";
import {
  getAdaptiveMaintenance,
  saveMaintenanceEstimate,
  formatKcal,
  formatKcalRange,
  formatCoverage,
  formatDiff,
  describeDiff,
  formatConfidence,
  formatGoalMode,
  hasEstimate,
  type AdaptiveMaintenanceResponse,
  type MaintenanceConfidence,
} from "../lib/adaptiveMaintenance";
import ConfidenceBadge from "./ConfidenceBadge";

// ── Sub-components ────────────────────────────────────────────────────────────

function ConfidenceIndicator({ confidence }: { confidence: MaintenanceConfidence | undefined }) {
  if (!confidence) return null;
  return <ConfidenceBadge level={confidence} />;
}

function SectionRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between py-1 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <span className="text-sm text-gray-600 dark:text-gray-400">{label}</span>
      <span className="text-sm font-medium text-right">
        {value}
        {sub && <span className="block text-xs text-gray-400 dark:text-gray-500 font-normal">{sub}</span>}
      </span>
    </div>
  );
}

// ── Main card ─────────────────────────────────────────────────────────────────

interface AdaptiveMaintenanceCardProps {
  /** Called after a snapshot is successfully saved. */
  onSnapshotSaved?: (snapshotId: string) => void;
  /** Opens the weight-log view from an incomplete estimate state. */
  onLogWeight?: () => void;
}

export function AdaptiveMaintenanceCard({ onSnapshotSaved, onLogWeight }: AdaptiveMaintenanceCardProps) {
  const [data, setData]       = useState<AdaptiveMaintenanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [saving, setSaving]   = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getAdaptiveMaintenance();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load maintenance estimate.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!data?.goal_phase?.id) return;
    setSaving(true);
    try {
      const saved = await saveMaintenanceEstimate(data.goal_phase.id);
      setSavedId(saved.snapshot_id);
      onSnapshotSaved?.(saved.snapshot_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save estimate.");
    } finally {
      setSaving(false);
    }
  };

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6"
        data-testid="maintenance-card-loading"
      >
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading maintenance estimate…</p>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div
        className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 p-6"
        role="alert"
        data-testid="maintenance-card-error"
      >
        <p className="text-sm font-medium text-red-700 dark:text-red-400">Estimate unavailable</p>
        <p className="text-sm text-red-600 dark:text-red-500 mt-1">{error}</p>
        <button
          onClick={load}
          className="mt-3 text-sm underline text-red-600 dark:text-red-400 hover:text-red-800"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!data) return null;

  // ── No active goal phase ─────────────────────────────────────────────────
  if (data.status === "no_active_goal_phase") {
    return (
      <div
        className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6"
        data-testid="maintenance-card-no-phase"
      >
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">Observed Maintenance</h2>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          {data.message ?? "Start a goal phase to begin tracking your observed maintenance."}
        </p>
      </div>
    );
  }

  // ── Insufficient or stale weight data ────────────────────────────────────
  if (data.status === "insufficient_weight_data" || data.status === "stale_weight_data") {
    const isStale = data.status === "stale_weight_data";

    return (
      <div
        className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6"
        data-testid="maintenance-card-weight-gap"
      >
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">Observed Maintenance</h2>
        {data.goal_phase && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {formatGoalMode(data.goal_phase.mode)} phase active
          </p>
        )}
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
          This will estimate how many calories would keep your weight stable, using your completed
          food logs and your actual weight trend.
        </p>

        <div className="mt-5 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 p-4">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
            {isStale ? "Log a current weight to continue" : "Building your weight trend"}
          </p>
          <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
            {isStale
              ? "Your latest weight is more than 14 days old."
              : "Your phase is too new to calculate a weekly weight-change rate yet."}
          </p>
        </div>

        <div className="mt-5">
          <p className="text-sm font-medium text-gray-800 dark:text-gray-200">What to do next</p>
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-gray-600 dark:text-gray-400">
            <li>Log your weight on at least 4 different days across at least 7 days.</li>
            <li>Mark food-log days complete. The first estimate needs at least 14 complete days and 50% coverage.</li>
          </ol>
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            The estimate becomes more reliable after 14+ days and at least 6 weigh-in days.
          </p>
        </div>

        {onLogWeight && (
          <button
            type="button"
            onClick={onLogWeight}
            className="mt-5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Log weight
          </button>
        )}
      </div>
    );
  }

  // ── Insufficient nutrition ───────────────────────────────────────────────
  if (data.status === "insufficient_nutrition_days" || data.status === "insufficient_nutrition_coverage") {
    return (
      <div
        className="rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 p-6"
        data-testid="maintenance-card-insufficient-nutrition"
      >
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">Observed Maintenance</h2>
        <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">
          More complete food-log days are needed before your observed maintenance can be estimated.
        </p>
        {data.nutrition && (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {data.nutrition.eligible_days} of {data.analysis_window?.calendar_days ?? "?"} days confirmed complete
          </p>
        )}
        {data.nutrition && data.nutrition.probably_complete_days > 0 && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">
            {data.nutrition.probably_complete_days} day(s) appear partially logged — confirm them on the Log page.
          </p>
        )}
      </div>
    );
  }

  // ── Usable / provisional estimate ────────────────────────────────────────
  if (!hasEstimate(data)) return null;

  // hasEstimate guarantees status is usable/provisional and maintenance is defined.
  // goal_phase is always present for usable/provisional responses.
  const { maintenance, nutrition, weight_trend, analysis_window } = data;
  const goal_phase = data.goal_phase!;
  const isProvisional = data.status === "provisional";

  const equationDiff  = describeDiff(maintenance.observed_minus_equation_kcal, "equation estimate");
  const effectiveDiff = describeDiff(maintenance.observed_minus_effective_kcal, "phase maintenance");

  return (
    <div
      className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6"
      data-testid="maintenance-card"
    >
      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">Observed Maintenance</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {formatGoalMode(goal_phase.mode)} phase · {analysis_window.calendar_days}-day window
          </p>
        </div>
        <ConfidenceIndicator confidence={data.confidence} />
      </div>

      {isProvisional && (
        <div className="mt-3 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 px-3 py-2">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Provisional estimate — more complete food-log days will improve accuracy.
          </p>
        </div>
      )}

      {/* ── Observed estimate (primary) ── */}
      <div className="mt-5" data-testid="observed-estimate">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
          Observed estimate
        </p>
        <p className="text-3xl font-bold text-gray-900 dark:text-gray-100 mt-1">
          {formatKcal(maintenance.observed_estimate_kcal)}
        </p>
        {(maintenance.lower_kcal != null && maintenance.upper_kcal != null) && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Estimated range:{" "}
            <span data-testid="maintenance-range">
              {formatKcalRange(maintenance.lower_kcal, maintenance.upper_kcal)}
            </span>
          </p>
        )}
      </div>

      {/* ── Comparison values ── */}
      <div className="mt-5 space-y-0" data-testid="comparison-values">
        {maintenance.equation_estimate_kcal != null && (
          <SectionRow
            label="Equation estimate"
            value={formatKcal(maintenance.equation_estimate_kcal)}
            sub={equationDiff || undefined}
          />
        )}
        {maintenance.manual_override_kcal != null && (
          <SectionRow
            label="Manual override"
            value={formatKcal(maintenance.manual_override_kcal)}
          />
        )}
        {maintenance.observed_minus_equation_kcal != null && (
          <SectionRow
            label="Observed vs equation"
            value={formatDiff(maintenance.observed_minus_equation_kcal)}
          />
        )}
      </div>

      {/* ── Evidence summary ── */}
      <div className="mt-5 space-y-0" data-testid="evidence-summary">
        <SectionRow label="Complete food-log days"  value={String(nutrition.eligible_days)} />
        <SectionRow label="Analysis period"          value={`${analysis_window.selected_weight_window_days} days`} />
        <SectionRow label="Nutrition coverage"       value={formatCoverage(nutrition.coverage_fraction)} />
        <SectionRow
          label="Weight trend"
          value={
            weight_trend.weekly_rate_kg < 0
              ? `${Math.abs(weight_trend.weekly_rate_kg).toFixed(2)} kg/week loss`
              : weight_trend.weekly_rate_kg > 0
              ? `${weight_trend.weekly_rate_kg.toFixed(2)} kg/week gain`
              : "Stable"
          }
        />
      </div>

      {/* ── Expandable explanation ── */}
      <details className="mt-5 group" data-testid="how-calculated">
        <summary className="text-sm font-medium text-gray-600 dark:text-gray-400 cursor-pointer select-none">
          How this was calculated
        </summary>
        <div className="mt-3 text-sm text-gray-600 dark:text-gray-400 space-y-2">
          <p>
            Your observed maintenance is estimated from your average daily food intake and your
            observed weight-change rate using the energy-balance equation:
          </p>
          <p className="font-mono text-xs bg-gray-50 dark:bg-gray-900 rounded p-2">
            observed maintenance = average intake − (weekly rate × 7,700 ÷ 7)
          </p>
          <p>
            Based on <strong>{nutrition.eligible_days}</strong> confirmed food-log days
            and <strong>{analysis_window.selected_weight_window_days}</strong> days of weight data.
            Nutrition coverage: <strong>{formatCoverage(nutrition.coverage_fraction)}</strong>.
          </p>
          <p>
            The estimated range reflects weight-trend uncertainty only — it does not capture
            systematic food-logging error.
          </p>
          <p>
            <strong>What this is:</strong> a planning estimate. It is not a laboratory measurement.
          </p>
          <p>
            <strong>What this is not:</strong> proof that you logged inaccurately, evidence of
            metabolic adaptation, or a recommendation to change your calorie target.
          </p>
          <ul className="mt-2 list-disc pl-5 space-y-1">
            <li>Incomplete nutrition days are not treated as zero calories.</li>
            <li>Daily weighing is not required — weekly measurements are supported.</li>
            <li>No calorie target has been changed.</li>
          </ul>
          {equationDiff && <p>{equationDiff}</p>}
          {effectiveDiff && equationDiff !== effectiveDiff && <p>{effectiveDiff}</p>}
        </div>
      </details>

      {/* ── Warnings ── */}
      {data.warnings && data.warnings.length > 0 && (
        <div className="mt-4 space-y-1" data-testid="warnings">
          {data.warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-600 dark:text-amber-400">{w}</p>
          ))}
        </div>
      )}

      {/* ── Probably-complete days prompt ── */}
      {nutrition.probably_complete_days > 0 && (
        <div className="mt-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950 px-3 py-2">
          <p className="text-xs text-blue-700 dark:text-blue-400">
            {nutrition.probably_complete_days} day(s) have meals logged but are not marked complete. Confirm
            them on the Log page to improve your estimate.
          </p>
        </div>
      )}

      {/* ── Save action ── */}
      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || !!savedId}
          className="rounded-lg px-4 py-2 text-sm font-medium bg-green-700 text-white hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="save-snapshot-btn"
        >
          {savedId ? "Estimate saved" : saving ? "Saving…" : "Save this estimate"}
        </button>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Saves a snapshot. Does not change your calorie target.
        </p>
      </div>
    </div>
  );
}
