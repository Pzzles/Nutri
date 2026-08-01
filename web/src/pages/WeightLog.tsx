import { useEffect, useRef, useState } from "react";
import { callFunction, getFunction } from "../lib/supabase";
import type { WeightLog, GetWeightLogsResponse } from "../lib/weightTypes";
import {
  getWeightTrend,
  formatWeight,
  formatRate,
  formatRateDirection,
  formatConfidence,
  formatRateRange,
  formatRecency,
  mapWarningToMessage,
  TrendError,
  type WeightTrendResponse,
  type TrendConfidence,
} from "../lib/weightTrend";
import { WeightTrendChart } from "../components/charts/WeightTrendChart";

const PAGE_SIZE = 10;

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WeightLogPage() {
  const [logs, setLogs] = useState<WeightLog[]>([]);
  const [latestOfficial, setLatestOfficial] = useState<WeightLog | null>(null);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [trend, setTrend] = useState<WeightTrendResponse | null>(null);
  const [trendLoading, setTrendLoading] = useState(true);
  const [trendError, setTrendError] = useState<TrendError | null>(null);

  const [weightInput, setWeightInput] = useState("");
  const [notesInput, setNotesInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [howExpanded, setHowExpanded] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void fetchLogs();
    void fetchTrend();
    return () => abortRef.current?.abort();
  }, []);

  // ── Fetchers ───────────────────────────────────────────────────────────────

  async function fetchLogs() {
    setLogsLoading(true);
    setLogsError(null);
    try {
      const result = await getFunction<GetWeightLogsResponse>("get-weight-logs", {
        limit: String(PAGE_SIZE + 1),
      });
      setHasMore(result.logs.length > PAGE_SIZE);
      setLogs(result.logs.slice(0, PAGE_SIZE));
      setLatestOfficial(result.latest_official);
    } catch (err) {
      setLogsError(err instanceof Error ? err.message : "Failed to load weight logs.");
    } finally {
      setLogsLoading(false);
    }
  }

  async function fetchTrend() {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setTrendLoading(true);
    setTrendError(null);
    try {
      const result = await getWeightTrend({ signal: ctrl.signal });
      setTrend(result);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setTrendError(
        err instanceof TrendError
          ? err
          : new TrendError("BACKEND_ERROR", "Trend unavailable"),
      );
    } finally {
      setTrendLoading(false);
    }
  }

  async function loadMore() {
    const lastLog = logs[logs.length - 1];
    if (!lastLog) return;
    setLoadingMore(true);
    setLogsError(null);
    try {
      const result = await getFunction<GetWeightLogsResponse>("get-weight-logs", {
        limit: String(PAGE_SIZE + 1),
        before_date: lastLog.logged_date,
      });
      const seen = new Set(logs.map((l) => l.id));
      const fresh = result.logs.filter((l) => !seen.has(l.id));
      setHasMore(result.logs.length > PAGE_SIZE && fresh.length > 0);
      setLogs((prev) => [...prev, ...fresh.slice(0, PAGE_SIZE)]);
    } catch (err) {
      setLogsError(err instanceof Error ? err.message : "Failed to load more entries.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleLog(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const kg = parseFloat(weightInput);
    if (isNaN(kg) || kg < 1 || kg > 500) {
      setFormError("Enter a weight between 1 and 500 kg.");
      return;
    }

    setSubmitting(true);
    try {
      const newLog = await callFunction<WeightLog>("log-weight", {
        weight_kg: kg,
        notes: notesInput.trim() || undefined,
      });
      if (!newLog) throw new Error("log-weight returned no data");
      setLogs((prev) => [newLog, ...prev]);
      setLatestOfficial(newLog);
      setWeightInput("");
      setNotesInput("");
      void fetchTrend();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to log weight.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Screen-reader summary ──────────────────────────────────────────────────

  const srSummary = buildSrSummary(trend, latestOfficial);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="font-display text-2xl font-semibold text-ink">Weight</h1>

      {/* Screen-reader only summary */}
      {srSummary && (
        <p className="sr-only" aria-live="polite">{srSummary}</p>
      )}

      {/* Latest weight */}
      {latestOfficial && (
        <div className="mt-4 rounded-lg border border-border bg-surface px-5 py-4">
          <p className="text-xs text-muted">Latest measurement</p>
          <p className="font-display text-3xl font-semibold text-ink">
            {latestOfficial.weight_kg}{" "}
            <span className="text-lg font-normal text-muted">kg</span>
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {formatDateTime(latestOfficial.measured_at)}
          </p>
        </div>
      )}

      {/* Trend section */}
      <div className="mt-4 rounded-lg border border-border bg-surface px-4 pt-4 pb-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Trend</p>
          {trend && <ConfidenceBadge confidence={trend.confidence} />}
        </div>

        {trendLoading && (
          <div data-testid="trend-loading-skeleton" aria-label="Loading trend data">
            <div className="h-[200px] animate-pulse rounded bg-border/40" />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="h-8 animate-pulse rounded bg-border/40" />
              <div className="h-8 animate-pulse rounded bg-border/40" />
            </div>
          </div>
        )}

        {!trendLoading && trendError && (
          <TrendErrorCard error={trendError} onRetry={() => void fetchTrend()} />
        )}

        {!trendLoading && !trendError && trend && (
          <>
            {/* Chart — always shown when we have raw logs or trend points */}
            {(logs.length >= 2 || trend.trend_points.length >= 2) && (
              <WeightTrendChart
                rawLogs={logs.map((l) => ({
                  id: l.id,
                  weight_kg: Number(l.weight_kg),
                  measured_at: l.measured_at,
                  is_official: l.is_official,
                }))}
                trendPoints={trend.trend_points}
                flaggedIds={trend.flagged_measurements}
              />
            )}

            {/* Summary metrics */}
            <TrendSummary trend={trend} />

            {/* Data quality */}
            <TrendDataQuality trend={trend} />

            {/* Status-specific message */}
            <TrendStatusMessage trend={trend} />

            {/* Warnings */}
            {trend.warnings.length > 0 && (
              <TrendWarnings warnings={trend.warnings} />
            )}
          </>
        )}

        {!trendLoading && !trendError && !trend && logs.length === 0 && (
          <p className="text-sm text-muted py-4 text-center">
            Log your first weight to start seeing your trend.
          </p>
        )}

        {/* How is this calculated */}
        <details
          open={howExpanded}
          onToggle={(e) => setHowExpanded((e.target as HTMLDetailsElement).open)}
          className="mt-1"
        >
          <summary className="cursor-pointer text-xs text-muted hover:text-ink select-none">
            How is this calculated?
          </summary>
          <HowCalculated trend={trend} />
        </details>
      </div>

      {/* No-data empty state (when no logs at all) */}
      {!logsLoading && !latestOfficial && logs.length === 0 && (
        <div className="mt-4 rounded-lg border border-border bg-surface px-5 py-6 text-center">
          <p className="text-sm font-medium text-ink">No weight entries yet</p>
          <p className="mt-1 text-sm text-muted">
            Log your first weight below to start tracking your trend.
          </p>
        </div>
      )}

      {/* Log form */}
      <form onSubmit={handleLog} noValidate className="mt-6 space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="number"
              step="0.1"
              min="1"
              max="500"
              placeholder="Weight"
              value={weightInput}
              onChange={(e) => setWeightInput(e.target.value)}
              required
              aria-label="Weight in kilograms"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 pr-10 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">
              kg
            </span>
          </div>
          <button
            type="submit"
            disabled={submitting || !weightInput}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {submitting ? "Logging…" : "Log"}
          </button>
        </div>
        <input
          type="text"
          placeholder="Notes (optional)"
          value={notesInput}
          onChange={(e) => setNotesInput(e.target.value)}
          maxLength={500}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
        />
        {formError && (
          <p className="text-sm text-confidence-low" role="alert">{formError}</p>
        )}
      </form>

      {/* History */}
      <section className="mt-8" aria-label="Weight history">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">History</h2>

        {logsError && (
          <p className="mt-3 text-sm text-confidence-low" role="alert">{logsError}</p>
        )}
        {logsLoading && <p className="mt-3 text-sm text-muted">Loading…</p>}

        {!logsLoading && logs.length === 0 && (
          <p className="mt-3 text-sm text-muted">No weight entries yet.</p>
        )}

        {logs.length > 0 && (
          <>
            <div className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
              {(() => {
                const hasNonOfficial = logs.some((l) => !l.is_official);
                return logs.map((log) => (
                  <div key={log.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-ink">{log.weight_kg} kg</p>
                      <p className="text-xs text-muted">{formatDate(log.logged_date)}</p>
                      {log.notes && (
                        <p className="mt-0.5 text-xs text-muted">{log.notes}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {hasNonOfficial && log.is_official && (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300">
                          Official
                        </span>
                      )}
                      <p className="text-xs text-muted">{formatTime(log.measured_at)}</p>
                    </div>
                  </div>
                ));
              })()}
            </div>
            {hasMore && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="mt-3 w-full rounded-lg border border-border py-2.5 text-sm text-muted hover:text-ink disabled:opacity-50"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ConfidenceBadge({ confidence }: { confidence: TrendConfidence }) {
  const styles: Record<TrendConfidence, string> = {
    low:    "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
    medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
    high:   "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[confidence]}`}>
      {formatConfidence(confidence)} confidence
    </span>
  );
}

function TrendSummary({ trend }: { trend: WeightTrendResponse }) {
  const { latest_raw_weight_kg, latest_trend_weight_kg, weekly_rate } = trend;
  const rate = weekly_rate;

  return (
    <div data-testid="trend-summary" className="grid grid-cols-2 gap-x-4 gap-y-3 pt-1">
      {latest_raw_weight_kg !== null && (
        <div>
          <p className="text-xs text-muted">Latest measurement</p>
          <p className="text-sm font-semibold text-ink">
            {formatWeight(latest_raw_weight_kg)}
          </p>
        </div>
      )}
      {latest_trend_weight_kg !== null && (
        <div>
          <p className="text-xs text-muted">Trend weight</p>
          <p className="text-sm font-semibold text-ink">
            {formatWeight(latest_trend_weight_kg)}
          </p>
        </div>
      )}
      {rate !== null && (
        <>
          <div>
            <p className="text-xs text-muted">Estimated change</p>
            <p className="text-sm font-semibold text-ink">
              {formatRate(rate.estimate_kg)}
            </p>
            <p className="text-xs text-muted capitalize">
              {formatRateDirection(rate.estimate_kg)}
            </p>
          </div>
          {formatRateRange(rate.lower_kg, rate.upper_kg) && (
            <div>
              <p className="text-xs text-muted">Estimated range</p>
              <p className="text-sm font-semibold text-ink">
                {formatRateRange(rate.lower_kg, rate.upper_kg)}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TrendDataQuality({ trend }: { trend: WeightTrendResponse }) {
  const { measurements, window: trendWindow } = trend;
  const {
    distinct_modelling_days,
    largest_gap_days,
    latest_measured_at,
    selected_rate_window_days,
  } = measurements;
  const inclusive_calendar_days = trendWindow.inclusive_calendar_days;

  const recency = formatRecency(latest_measured_at);
  const gapDays = Math.round(largest_gap_days);

  const rateWindowNote = (() => {
    if (!selected_rate_window_days || selected_rate_window_days === 28) return null;
    return `Rate estimated using ${selected_rate_window_days} days because fewer measurements were available in the latest 28 days.`;
  })();

  return (
    <div className="space-y-1 pt-1 text-xs text-muted border-t border-border">
      <p className="pt-2 font-medium text-ink text-xs">Data coverage</p>
      <p>Based on {distinct_modelling_days} measurement day{distinct_modelling_days !== 1 ? "s" : ""}</p>
      <p>Span: {inclusive_calendar_days} days</p>
      {gapDays > 0 && <p>Largest gap: {gapDays} day{gapDays !== 1 ? "s" : ""}</p>}
      <p>Latest measurement: {recency}</p>
      {selected_rate_window_days && (
        <p>Rate window: {selected_rate_window_days} days</p>
      )}
      {rateWindowNote && (
        <p className="text-ink/70 italic">{rateWindowNote}</p>
      )}
    </div>
  );
}

function TrendStatusMessage({ trend }: { trend: WeightTrendResponse }) {
  const { status } = trend;

  const messages: Record<typeof status, { label: string; detail: string } | null> = {
    insufficient_measurements: {
      label: "More data needed",
      detail:
        "More distinct measurement days are needed before a weekly rate can be estimated. Measurements don't need to be daily.",
    },
    insufficient_coverage: {
      label: "Coverage building up",
      detail:
        "Your measurements do not yet cover enough calendar time for a reliable rate estimate. Continue logging over the coming days.",
    },
    provisional: {
      label: "Provisional estimate",
      detail:
        "This is an early estimate. The direction may become clearer as more measurements are recorded.",
    },
    usable: null,
    stale: {
      label: "Stale data",
      detail:
        "The most recent measurement is over two weeks old. This trend may no longer represent your current weight.",
    },
  };

  const msg = messages[status];
  if (!msg) return null;

  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs">
      <p className="font-medium text-ink">{msg.label}</p>
      <p className="mt-0.5 text-muted">{msg.detail}</p>
    </div>
  );
}

function TrendWarnings({ warnings }: { warnings: string[] }) {
  const messages = warnings
    .map((w) => mapWarningToMessage(w))
    .filter(Boolean) as string[];

  const unknownCount = warnings.length - messages.length;

  return (
    <div className="space-y-1">
      {messages.map((msg, i) => (
        <p key={i} className="text-xs text-muted">
          ⚠ {msg}
        </p>
      ))}
      {unknownCount > 0 && (
        <p className="text-xs text-muted">
          ⚠ One measurement could not be included in the trend calculation.
        </p>
      )}
    </div>
  );
}

function TrendErrorCard({
  error,
  onRetry,
}: {
  error: TrendError;
  onRetry: () => void;
}) {
  if (error.code === "INVALID_PROFILE_TIMEZONE") {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 px-3 py-2 text-xs" role="alert">
        <p className="font-medium text-ink">Timezone configuration issue</p>
        <p className="mt-0.5 text-muted">{error.message}</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border px-3 py-2 text-xs" role="alert">
      <p className="font-medium text-ink">Trend unavailable</p>
      <p className="mt-0.5 text-muted">
        The trend could not be calculated right now.
      </p>
      <button
        onClick={onRetry}
        className="mt-2 text-primary underline hover:no-underline"
        type="button"
      >
        Try again
      </button>
    </div>
  );
}

function HowCalculated({ trend }: { trend: WeightTrendResponse | null }) {
  const versions = trend?.algorithm_versions;

  return (
    <div className="mt-2 space-y-1.5 text-xs text-muted">
      <p>
        <strong className="text-ink">Raw weights</strong> are preserved and shown
        as individual dots. Same-day readings are all visible.
      </p>
      <p>
        <strong className="text-ink">Trend weight</strong> reduces ordinary
        day-to-day fluctuation using an exponentially weighted moving average
        that accounts for the actual time between measurements.
      </p>
      <p>
        <strong className="text-ink">Daily representative:</strong> when multiple
        readings occur on the same calendar day, one is selected for trend
        modelling (official reading preferred; median otherwise).
      </p>
      <p>
        <strong className="text-ink">Estimated weekly change</strong> is derived
        from a Theil-Sen estimator on timestamped measurements and may use 28, 56
        or 84 days of history depending on how much data is available.
      </p>
      <p>
        <strong className="text-ink">Estimated uncertainty range</strong> reflects
        the spread of the underlying rate estimates. It is NOT a guaranteed 95%
        confidence interval — the true rate may fall outside it, especially with
        sparse or inconsistent data.
      </p>
      <p>All values are estimates, not guarantees.</p>
      {versions && (
        <details className="mt-1">
          <summary className="cursor-pointer text-ink/60 hover:text-ink">
            Algorithm versions
          </summary>
          <ul className="mt-1 space-y-0.5 font-mono text-[10px]">
            <li>Daily rep: {versions.daily_representative}</li>
            <li>Smoothing: {versions.smoothing}</li>
            <li>Rate: {versions.rate}</li>
            <li>Interval: {versions.interval}</li>
            <li>Confidence: {versions.confidence}</li>
          </ul>
        </details>
      )}
    </div>
  );
}

// ── Screen-reader summary builder ─────────────────────────────────────────────

function buildSrSummary(
  trend: WeightTrendResponse | null,
  latestOfficial: WeightLog | null,
): string | null {
  if (!trend) return null;
  const parts: string[] = [];

  if (latestOfficial) {
    parts.push(`Latest measurement: ${latestOfficial.weight_kg} kg.`);
  }
  if (trend.latest_trend_weight_kg != null) {
    parts.push(`Trend weight: ${formatWeight(trend.latest_trend_weight_kg)}.`);
  }
  if (trend.weekly_rate) {
    parts.push(
      `Estimated weekly change: ${formatRate(trend.weekly_rate.estimate_kg)}.`,
    );
  }
  if (trend.confidence) {
    parts.push(`Confidence: ${formatConfidence(trend.confidence)}.`);
  }

  const m = trend.measurements;
  if (m) {
    const spanDays = trend.window?.inclusive_calendar_days ?? 0;
    parts.push(
      `Based on ${m.distinct_modelling_days} measurement day${m.distinct_modelling_days !== 1 ? "s" : ""} over ${spanDays} days.`,
    );
  }

  return parts.join(" ");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-ZA", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatTime(isoStr: string): string {
  return new Date(isoStr).toLocaleTimeString("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateTime(isoStr: string): string {
  return new Date(isoStr).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
