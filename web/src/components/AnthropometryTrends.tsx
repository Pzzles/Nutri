import { useEffect, useMemo, useState } from "react";
import { AnthropometryChart } from "./charts/AnthropometryChart";
import {
  ANTHROPOMETRY_SITES,
  formatMeasurement,
  formatMeasurementChange,
  getAnthropometricProgress,
  siteDefinition,
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
  change: AnthropometryChange | null;
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
  circumference_repeatability_warning:
    "One endpoint has a repeatability note, so Nutri does not generate a cross-signal sentence.",
  weight_status_not_eligible:
    "The Phase 6 weight trend needs more coverage before these signals can be compared.",
  weight_confidence_not_eligible:
    "The Phase 6 weight trend needs medium or high confidence for this comparison.",
  insufficient_weight_trend_points:
    "At least two observed Phase 6 trend points are needed.",
  no_aligned_weight_endpoint:
    "No observed weight-trend point was close enough to each circumference endpoint.",
  aligned_weight_points_not_distinct:
    "The two circumference endpoints did not align to distinct, ordered weight-trend points.",
  no_material_cross_signal_template:
    "The numeric changes are shown above, but this pattern has no versioned descriptive sentence.",
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
  const baseline = selectedSeries?.points[0] ?? null;
  const comparison = data.weight_comparison;
  const selectedDefinition = siteDefinition(selectedSite);

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

        {latest && baseline && selectedSeries && (
          <>
            <dl className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border p-3">
                <dt className="text-xs text-muted">Latest representative</dt>
                <dd className="mt-1 font-display text-xl font-semibold text-ink">{formatMeasurement(latest.representative_cm, unit)}</dd>
                <p className="mt-1 text-xs text-muted">{formatDate(latest.measured_at)}</p>
              </div>
              <ChangeCard label="From previous session" change={selectedSeries.previous_change} unit={unit} />
              <ChangeCard label={`From first (${formatDate(baseline.measured_at)})`} change={selectedSeries.since_first_change} unit={unit} />
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
          {comparison.circumference && comparison.weight_trend && (
            comparison.eligible || comparison.reason_codes?.includes("no_material_cross_signal_template")
          ) && (
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-background p-3">
                <dt className="text-xs text-muted">{comparison.site_code ? siteDefinition(comparison.site_code).label : "Circumference"} change</dt>
                <dd className="mt-1 text-sm font-semibold text-ink">{formatMeasurementChange(comparison.circumference.change_cm, unit)}</dd>
              </div>
              <div className="rounded-lg bg-background p-3">
                <dt className="text-xs text-muted">Aligned Phase 6 weight-trend change</dt>
                <dd className="mt-1 text-sm font-semibold text-ink">{`${comparison.weight_trend.change_kg > 0 ? "+" : ""}${comparison.weight_trend.change_kg.toFixed(1)} kg`}</dd>
              </div>
            </dl>
          )}
          <p className="mt-4 text-xs leading-5 text-muted">This comparison uses nearby observed Phase 6 trend points only. It does not infer fat loss, muscle gain or body recomposition, and it does not alter targets or goal feedback.</p>
        </section>
      )}

      {selectedSeries && (
        <section className="rounded-xl border border-border bg-surface p-4 sm:p-5" aria-labelledby="measurement-history-heading">
          <h2 id="measurement-history-heading" className="font-display text-xl font-semibold text-ink">{selectedDefinition.label} history</h2>
          <ol className="mt-3 divide-y divide-border">
            {[...selectedSeries.points].reverse().map((point) => (
              <li key={`${point.session_id}-${point.site_code}`} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-ink">{formatDate(point.measured_at)}</p>
                  <p className="text-xs text-muted">Finalized representative</p>
                </div>
                <div className="sm:text-right">
                  <p className="text-sm font-semibold text-ink">{formatMeasurement(point.representative_cm, unit)}</p>
                  {point.quality === "repeatability_warning" && (
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Readings varied; value retained with a repeatability note.</p>
                  )}
                </div>
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
          <div><dt>Change</dt><dd className="font-mono">{data.algorithm_versions.change}</dd></div>
          <div><dt>Comparison</dt><dd className="font-mono">{data.algorithm_versions.weight_comparison}</dd></div>
          <div><dt>Weight trend</dt><dd className="font-mono">{data.algorithm_versions.weight_trend}</dd></div>
        </dl>
      </details>
    </div>
  );
}
