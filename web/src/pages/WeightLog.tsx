import { useEffect, useState } from "react";
import { callFunction, getFunction } from "../lib/supabase";
import { WeightLog, GetWeightLogsResponse, WeightTrendResult } from "../lib/weightTypes";
import { WeightTrendChart } from "../components/charts/WeightTrendChart";

const PAGE_SIZE = 10;

export default function WeightLogPage() {
  const [logs, setLogs] = useState<WeightLog[]>([]);
  const [latestOfficial, setLatestOfficial] = useState<WeightLog | null>(null);
  const [trend, setTrend] = useState<WeightTrendResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [weightInput, setWeightInput] = useState("");
  const [notesInput, setNotesInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    fetchAll();
  }, []);

  async function fetchAll() {
    setLoading(true);
    setError(null);
    try {
      const [logsResult, trendResult] = await Promise.all([
        getFunction<GetWeightLogsResponse>("get-weight-logs", { limit: String(PAGE_SIZE + 1) }),
        getFunction<WeightTrendResult>("get-weight-trend").catch(() => null),
      ]);
      setHasMore(logsResult.logs.length > PAGE_SIZE);
      setLogs(logsResult.logs.slice(0, PAGE_SIZE));
      setLatestOfficial(logsResult.latest_official);
      setTrend(trendResult);
    } catch (err: any) {
      setError(err.message ?? "Failed to load weight logs.");
    } finally {
      setLoading(false);
    }
  }

  async function refreshTrend() {
    try {
      const result = await getFunction<WeightTrendResult>("get-weight-trend");
      setTrend(result);
    } catch {
      // non-fatal — trend is informational
    }
  }

  async function loadMore() {
    const lastLog = logs[logs.length - 1];
    if (!lastLog) return;
    setLoadingMore(true);
    setError(null);
    try {
      const result = await getFunction<GetWeightLogsResponse>("get-weight-logs", {
        limit: String(PAGE_SIZE + 1),
        before_date: lastLog.logged_date,
      });
      const seen = new Set(logs.map((l) => l.id));
      const fresh = result.logs.filter((l) => !seen.has(l.id));
      setHasMore(result.logs.length > PAGE_SIZE && fresh.length > 0);
      setLogs((prev) => [...prev, ...fresh.slice(0, PAGE_SIZE)]);
    } catch (err: any) {
      setError(err.message ?? "Failed to load more entries.");
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
      // Refresh trend after a new measurement.
      void refreshTrend();
    } catch (err: any) {
      setFormError(err.message ?? "Failed to log weight.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="font-display text-2xl font-semibold text-ink">Weight</h1>

      {latestOfficial && (
        <div className="mt-4 rounded-lg border border-border bg-surface px-5 py-4">
          <p className="text-xs text-muted">Current weight</p>
          <p className="font-display text-3xl font-semibold text-ink">
            {latestOfficial.weight_kg}{" "}
            <span className="text-lg font-normal text-muted">kg</span>
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {formatDateTime(latestOfficial.measured_at)}
          </p>
        </div>
      )}

      {/* Trend chart + stats — chart renders from trend data when available,
          falls back to raw logs so it always appears once 2+ entries exist */}
      {(trend ? trend.trend_points.length >= 2 : logs.length >= 2) && (
        <div className="mt-4 rounded-lg border border-border bg-surface px-4 pt-4 pb-3 space-y-3">
          <div className="flex items-start justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              Trend
            </p>
            {trend && <TrendBadge confidence={trend.confidence} />}
          </div>

          <WeightTrendChart
            trendPoints={trend?.trend_points}
            data={
              trend
                ? undefined
                : [...logs].reverse().map((l) => ({ date: l.logged_date, weight: Number(l.weight_kg) }))
            }
          />

          {trend && <TrendStats trend={trend} />}

          <p className="text-xs text-muted leading-relaxed">
            The trend reduces normal daily weight fluctuations. It is an estimate
            and may change as more measurements are recorded.
          </p>
        </div>
      )}

      {/* No-data empty state */}
      {!loading && !latestOfficial && (
        <div className="mt-4 rounded-lg border border-border bg-surface px-5 py-6 text-center">
          <p className="text-sm text-muted">
            Log your first weight to see your trend.
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
        {formError && <p className="text-sm text-confidence-low">{formError}</p>}
      </form>

      {/* History */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">History</h2>

        {error && <p className="mt-3 text-sm text-confidence-low">{error}</p>}
        {loading && <p className="mt-3 text-sm text-muted">Loading…</p>}

        {!loading && logs.length === 0 && (
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

// ── Sub-components ────────────────────────────────────────────────────────────

function TrendBadge({ confidence }: { confidence: "low" | "medium" | "high" }) {
  const styles: Record<string, string> = {
    low:    "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
    medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
    high:   "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  };
  const labels: Record<string, string> = {
    low: "Low confidence", medium: "Medium confidence", high: "High confidence",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[confidence]}`}>
      {labels[confidence]}
    </span>
  );
}

function TrendStats({ trend }: { trend: WeightTrendResult }) {
  const { latest_trend_weight_kg, weekly_rate_kg, measurement_count, coverage_days } = trend;

  const rateLabel = (): string => {
    if (weekly_rate_kg === null) return "—";
    const abs = Math.abs(weekly_rate_kg);
    const dir = weekly_rate_kg > 0.05 ? "▲" : weekly_rate_kg < -0.05 ? "▼" : "→";
    return `${dir} ${abs.toFixed(2)} kg/week`;
  };

  const coverageLabel = (): string => {
    const days = Math.round(coverage_days);
    return `Based on ${measurement_count} weigh-in${measurement_count !== 1 ? "s" : ""} across ${days} day${days !== 1 ? "s" : ""}`;
  };

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
      {latest_trend_weight_kg !== null && (
        <div>
          <p className="text-xs text-muted">Trend weight</p>
          <p className="text-sm font-semibold text-ink">
            {latest_trend_weight_kg.toFixed(1)} kg
          </p>
        </div>
      )}
      {weekly_rate_kg !== null && (
        <div>
          <p className="text-xs text-muted">Estimated rate</p>
          <p className="text-sm font-semibold text-ink">{rateLabel()}</p>
        </div>
      )}
      <div className="col-span-2">
        <p className="text-xs text-muted">{coverageLabel()}</p>
      </div>
    </div>
  );
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
