import { useEffect, useMemo, useState } from "react";
import { AnthropometryChart } from "./charts/AnthropometryChart";
import {
  ANTHROPOMETRY_SITES,
  formatMeasurement,
  formatMeasurementChange,
  getAnthropometricProgress,
  siteDefinition,
  type AnthropometryChangeEvidence,
  type AnthropometryChange,
  type AnthropometryComparisonReasonCode,
  type AnthropometryProgressResponse,
  type AnthropometrySiteCode,
  type MeasurementUnit,
} from "../lib/anthropometry";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDuration(elapsedDays: number): string {
  const weeks = Math.round(elapsedDays / 7);
  if (elapsedDays >= 14 && Math.abs(elapsedDays - weeks * 7) < 0.01) {
    return `${weeks} weeks`;
  }
  const days = Math.round(elapsedDays);
  return Math.abs(elapsedDays - days) < 0.01
    ? `${days} ${days === 1 ? "day" : "days"}`
    : `${elapsedDays.toFixed(1)} days`;
}

function ChangeCard({
  label,
  change,
  unit,
}: {
  label: string;
  change: AnthropometryChangeEvidence | AnthropometryChange | null;
  unit: MeasurementUnit;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 font-display text-xl font-semibold text-ink">
        {change ? formatMeasurementChange(change.change_cm, unit) : "Not enough data"}
      </dd>
      {change && <p className="mt-1 text-xs text-muted">over {formatDuration(change.elapsed_days)}</p>}
    </div>
  );
}

const REASON_MESSAGES: Record<AnthropometryComparisonReasonCode, string> = {
  insufficient_circumference_points:
    "At least two waist or abdomen-at-navel sessions are needed for a comparison.",
  circumference_interval_too_short:
    "The circumference endpoints need to be at least 14 days apart.",
  circumference_quality_not_eligible:
    "The latest central measurement is retained but is not eligible for interpretation because of its quality result.",
  incompatible_anthropometry_protocol:
    "These sessions use incompatible measurement protocols, so Nutri keeps them visible without calculating a change.",
  latest_central_measurement_not_at_weight_as_of:
    "The latest eligible session does not contain a comparable waist or abdomen-at-navel measurement.",
  weight_status_not_eligible:
    "The Phase 6 weight trend needs more coverage before these signals can be compared.",
  weight_confidence_not_eligible:
    "The Phase 6 weight trend needs medium or high confidence for this comparison.",
  weight_rate_interval_unavailable:
    "The canonical Phase 6 weekly-rate uncertainty range is not available yet.",
  weight_data_stale:
    "The Phase 6 trend is stale, so Nutri does not compare it with circumference.",
  weight_not_aligned_with_anthropometry:
    "The latest weight is more than seven calendar days from the measurement session.",
  no_material_cross_signal_template:
    "The numeric changes are shown, but this historical response has no versioned descriptive sentence.",
};

export function AnthropometryTrends({ unit }: { unit: MeasurementUnit }) {
  const [data, setData] = useState<AnthropometryProgressResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSite, setSelectedSite] = useState<AnthropometrySiteCode>("waist");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await getAnthropometricProgress());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load measurement history.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!data?.series.length) return;
    if (!data.series.some((series) => series.site_code === selectedSite)) {
      setSelectedSite(data.series[0].site_code);
    }
  }, [data, selectedSite]);

  const selectedSeries = useMemo(
    () => data?.series.find((series) => series.site_code === selectedSite) ?? null,
    [data, selectedSite],
  );

  if (loading) {
    return (
      <section className="mt-6" aria-label="Loading measurement history">
        <div className="h-12 animate-pulse rounded-lg bg-border/40" />
        <div className="mt-4 h-64 animate-pulse rounded-xl bg-border/40" />
      </section>
    );
  }

  if (error) {
    return (
      <section className="mt-6 rounded-xl border border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/30">
        <h2 className="font-display text-lg font-semibold text-red-900 dark:text-red-100">Measurement history unavailable</h2>
        <p role="alert" className="mt-2 text-sm text-red-800 dark:text-red-200">{error}</p>
        <button type="button" onClick={() => void load()} className="mt-4 min-h-11 rounded-lg border border-red-400 px-4 text-sm font-semibold text-red-900 dark:text-red-100">Try again</button>
      </section>
    );
  }

  if (!data || data.series.length === 0) {
    return (
      <section className="mt-6 rounded-xl border border-border bg-surface p-5 text-center">
        <h2 className="font-display text-xl font-semibold text-ink">No finalized measurements yet</h2>
        <p className="mt-2 text-sm leading-6 text-muted">Complete a guided session to create your first recorded circumference point. Missing sites stay missing; Nutri never converts them to zero.</p>
      </section>
    );
  }

  const latest = selectedSeries?.points[selectedSeries.points.length - 1] ?? null;
  const baseline = selectedSeries?.change_summary?.baseline?.from ?? selectedSeries?.points[0] ?? null;
  const comparison = data.weight_comparison;
  const selectedDefinition = siteDefinition(selectedSite);
  const contextWarningCodes = [
    ...(selectedSeries?.change_summary?.previous?.context_warning_codes ?? []),
    ...(selectedSeries?.change_summary?.baseline?.context_warning_codes ?? []),
  ];
  const hasContextCaution = new Set(contextWarningCodes).size > 0;
  const hasProtocolMismatch = selectedSeries?.warning_codes?.includes("protocol_versions_not_comparable") ?? false;

  return (
    <div className="mt-6 space-y-5">
      <section className="rounded-xl border border-border bg-surface p-4 sm:p-5" aria-labelledby="circumference-trend-heading">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="circumference-trend-heading" className="font-display text-xl font-semibold text-ink">Circumference trend</h2>
            <p className="mt-1 text-sm text-muted">Recorded points only—no smoothing, interpolation or filled-in dates.</p>
          </div>
          <label className="text-sm font-medium text-ink">
            Measurement site
            <select
              value={selectedSite}
              onChange={(event) => setSelectedSite(event.target.value as AnthropometrySiteCode)}
              className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary sm:w-64"
            >
              {ANTHROPOMETRY_SITES.filter((site) =>
                data.series.some((series) => series.site_code === site.code)
              ).map((site) => <option key={site.code} value={site.code}>{site.label}</option>)}
            </select>
          </label>
        </div>

        {selectedSite === "abdomen_navel" && (
          <p className="mt-4 rounded-lg bg-blue-50 p-3 text-sm leading-6 text-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
            Abdomen at navel is a personal-progress site. It is not the WHO waist measurement and is not compared with waist-risk thresholds.
          </p>
        )}

        {hasProtocolMismatch && (
          <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            These measurements used different protocols and are shown separately rather than compared automatically.
          </p>
        )}

        {hasContextCaution && (
          <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            These sessions were measured under different conditions, so part of the difference may reflect timing, food, clothing or recent activity. The measurements remain valid recorded observations.
          </p>
        )}

        {latest && selectedSeries && (
          <>
            <dl className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border p-3">
                <dt className="text-xs text-muted">Latest representative</dt>
                <dd className="mt-1 font-display text-xl font-semibold text-ink">{formatMeasurement(latest.representative_cm, unit)}</dd>
                <p className="mt-1 text-xs text-muted">{formatDate(latest.measured_at)}</p>
              </div>
              <ChangeCard label="From previous comparable session" change={selectedSeries.change_summary?.previous ?? selectedSeries.previous_change ?? null} unit={unit} />
              <ChangeCard label={baseline ? `From comparable baseline (${formatDate(baseline.measured_at)})` : "From comparable baseline"} change={selectedSeries.change_summary?.baseline ?? selectedSeries.since_first_change ?? null} unit={unit} />
            </dl>
            <div className="mt-4">
              <AnthropometryChart siteCode={selectedSite} points={selectedSeries.points} unit={unit} />
            </div>
          </>
        )}
      </section>

      {comparison && (
        <section className="rounded-xl border border-border bg-surface p-4 sm:p-5" aria-labelledby="cross-signal-heading">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Descriptive comparison</p>
          <h2 id="cross-signal-heading" className="mt-1 font-display text-xl font-semibold text-ink">Circumference and weight trend</h2>
          {comparison.eligible && comparison.description ? (
            <p className="mt-3 text-base font-medium leading-7 text-ink">{comparison.description}</p>
          ) : (
            <p className="mt-3 text-sm leading-6 text-muted">
              {comparison.reason_codes?.[0]
                ? REASON_MESSAGES[comparison.reason_codes[0]]
                : "A descriptive comparison is not available for these recorded points."}
            </p>
          )}
          {comparison.circumference && (
            comparison.eligible || comparison.reason_codes?.includes("no_material_cross_signal_template")
          ) && (
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-background p-3">
                <dt className="text-xs text-muted">{comparison.site_code ? siteDefinition(comparison.site_code).label : "Circumference"} change</dt>
                <dd className="mt-1 text-sm font-semibold text-ink">{formatMeasurementChange(comparison.circumference.change_cm, unit)}</dd>
              </div>
              <div className="rounded-lg bg-background p-3">
                <dt className="text-xs text-muted">Phase 6 weekly rate and uncertainty range</dt>
                <dd className="mt-1 text-sm font-semibold text-ink">
                  {comparison.weight_trend.weekly_rate_kg != null
                    ? `${comparison.weight_trend.weekly_rate_kg.toFixed(2)} kg/week (${comparison.weight_trend.lower_kg?.toFixed(2)} to ${comparison.weight_trend.upper_kg?.toFixed(2)})`
                    : comparison.weight_trend.change_kg != null
                    ? `${comparison.weight_trend.change_kg > 0 ? "+" : ""}${comparison.weight_trend.change_kg.toFixed(1)} kg`
                    : "Unavailable"}
                </dd>
              </div>
            </dl>
          )}
          <p className="mt-4 text-xs leading-5 text-muted">This comparison uses the canonical Phase 6 weekly-rate uncertainty range calculated as of the measurement session. It does not infer fat loss, muscle gain or body recomposition, and it does not alter targets or goal feedback.</p>
        </section>
      )}

      {selectedSeries && (
        <section className="rounded-xl border border-border bg-surface p-4 sm:p-5" aria-labelledby="measurement-history-heading">
          <h2 id="measurement-history-heading" className="font-display text-xl font-semibold text-ink">{selectedDefinition.label} history</h2>
          <ol className="mt-3 divide-y divide-border">
            {[...selectedSeries.points].reverse().map((point) => (
              <li key={`${point.session_id}-${point.site_code}`} className="py-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-ink">{formatDate(point.measured_at)}</p>
                  <p className="text-xs text-muted">Finalized representative</p>
                </div>
                <div className="sm:text-right">
                  <p className="text-sm font-semibold text-ink">{formatMeasurement(point.representative_cm, unit)}</p>
                  {point.quality === "repeatability_warning" && (
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Readings varied; value retained with a repeatability note.</p>
                  )}
                  {point.quality === "pair_agree_with_isolated_reading" && (
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">One isolated reading was preserved and excluded.</p>
                  )}
                  {point.quality === "high_variability" && (
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Low confidence; excluded from progress interpretation.</p>
                  )}
                </div>
                </div>
                <details className="mt-2 rounded-lg bg-background p-2 text-xs text-muted">
                  <summary className="min-h-11 cursor-pointer py-3 font-medium text-ink">Context, raw readings and calculation provenance</summary>
                  <dl className="grid gap-2 pb-2 sm:grid-cols-2">
                    <div><dt>Local measurement time</dt><dd>{point.measurement_context?.local_time ?? "Not recorded (legacy session)"}</dd></div>
                    <div><dt>Food timing</dt><dd>{point.measurement_context?.meal_timing.replace(/_/g, " ") ?? "not recorded"}</dd></div>
                    <div><dt>After bathroom</dt><dd>{point.measurement_context?.after_bathroom == null ? "Not recorded" : point.measurement_context.after_bathroom ? "Yes" : "No"}</dd></div>
                    <div><dt>Exercise in previous 12 hours</dt><dd>{point.measurement_context?.exercise_within_previous_12_hours == null ? "Not recorded" : point.measurement_context.exercise_within_previous_12_hours ? "Yes" : "No"}</dd></div>
                    <div><dt>Measurement help</dt><dd>{point.measurement_context?.measurement_assistance.replace(/_/g, " ") ?? "not recorded"}</dd></div>
                    <div><dt>Clothing</dt><dd>{point.measurement_context?.clothing_level.replace(/_/g, " ") ?? "not recorded"}</dd></div>
                    <div><dt>Raw readings</dt><dd>{point.raw_readings?.map((reading) => `${reading.reading_index}: ${formatMeasurement(reading.value_cm, unit)}`).join(" · ") || "Unavailable for this historical row"}</dd></div>
                    <div><dt>Selected readings</dt><dd>{point.selected_reading_indices?.join(" and ") ?? "Legacy calculation"}</dd></div>
                    <div><dt>Quality</dt><dd>{point.quality.replace(/_/g, " ")}</dd></div>
                    <div><dt>Selected-pair spread</dt><dd>{point.selected_pair_spread_cm == null ? "Legacy calculation" : formatMeasurement(point.selected_pair_spread_cm, unit)}</dd></div>
                    <div><dt>Warnings</dt><dd>{point.warning_codes?.map((code) => code.replace(/_/g, " ")).join(", ") || "None"}</dd></div>
                    <div><dt>Interpretation eligible</dt><dd>{point.eligible_for_interpretation == null ? "Legacy rule" : point.eligible_for_interpretation ? "Yes" : "No"}</dd></div>
                    <div className="sm:col-span-2"><dt>Algorithm</dt><dd className="font-mono">{point.algorithm_version ?? "Legacy calculation"}</dd></div>
                  </dl>
                </details>
              </li>
            ))}
          </ol>
        </section>
      )}

      <details className="rounded-xl border border-border bg-surface p-4 text-sm">
        <summary className="min-h-11 cursor-pointer font-medium text-ink">Limits and calculation versions</summary>
        <ul className="mt-3 list-disc space-y-2 pl-5 leading-6 text-muted">
          {data.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
        </ul>
        <dl className="mt-4 grid gap-2 text-xs text-muted sm:grid-cols-3">
          <div><dt>Change summary</dt><dd className="font-mono">{data.algorithm_versions.change_summary}</dd></div>
          <div><dt>Context comparison</dt><dd className="font-mono">{data.algorithm_versions.context_comparison}</dd></div>
          <div><dt>Protocol compatibility</dt><dd className="font-mono">{data.algorithm_versions.protocol_compatibility}</dd></div>
          <div><dt>Comparison</dt><dd className="font-mono">{data.algorithm_versions.weight_comparison}</dd></div>
          <div><dt>Weight trend</dt><dd className="font-mono">{data.algorithm_versions.weight_trend}</dd></div>
        </dl>
      </details>
    </div>
  );
}
