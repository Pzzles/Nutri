import { useEffect, useState } from "react";
import { callFunction } from "../lib/supabase";
import { WeightLog, GetWeightLogsResponse } from "../lib/weightTypes";

export default function WeightLogPage() {
  const [logs, setLogs] = useState<WeightLog[]>([]);
  const [latestOfficial, setLatestOfficial] = useState<WeightLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [weightInput, setWeightInput] = useState("");
  const [notesInput, setNotesInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    fetchLogs();
  }, []);

  async function fetchLogs() {
    setLoading(true);
    setError(null);
    try {
      const result = await callFunction<GetWeightLogsResponse>("get-weight-logs", {});
      setLogs(result.logs);
      setLatestOfficial(result.latest_official);
    } catch (err: any) {
      setError(err.message ?? "Failed to load weight logs.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLog(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const kg = parseFloat(weightInput);
    if (isNaN(kg) || kg < 20 || kg > 300) {
      setFormError("Enter a weight between 20 and 300 kg.");
      return;
    }

    setSubmitting(true);
    try {
      const newLog = await callFunction<WeightLog>("log-weight", {
        weight_kg: kg,
        notes: notesInput.trim() || undefined,
      });
      setLogs((prev) => [newLog, ...prev]);
      setLatestOfficial(newLog);
      setWeightInput("");
      setNotesInput("");
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
          <p className="text-xs text-muted">Latest</p>
          <p className="font-display text-3xl font-semibold text-ink">
            {latestOfficial.weight_kg} <span className="text-lg font-normal text-muted">kg</span>
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {formatDateTime(latestOfficial.measured_at)}
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
              min="20"
              max="300"
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
          <div className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
            {logs.map((log) => (
              <div key={log.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-ink">{log.weight_kg} kg</p>
                  <p className="text-xs text-muted">{formatDate(log.logged_date)}</p>
                  {log.notes && <p className="mt-0.5 text-xs text-muted">{log.notes}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {log.is_official && (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300">
                      Official
                    </span>
                  )}
                  <p className="text-xs text-muted">{formatTime(log.measured_at)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

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
