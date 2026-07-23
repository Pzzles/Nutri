import { useState } from "react";
import { callFunction } from "../lib/supabase";
import { DailyLogStatus, DailyLogStatusValue } from "../lib/goalTypes";

interface Props {
  date: string;
  status: DailyLogStatusValue;
  onStatusChange?: (updated: DailyLogStatus) => void;
}

const LABEL: Record<DailyLogStatusValue, string> = {
  unknown: "Mark log complete",
  partial: "Mark log complete",
  complete: "Re-open log",
};

const STATUS_COPY: Record<DailyLogStatusValue, string> = {
  unknown: "Log not yet marked",
  partial: "Log in progress",
  complete: "Log marked complete",
};

export default function DailyStatusControl({ date, status, onStatusChange }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<DailyLogStatusValue>(status);

  async function toggle() {
    const next: DailyLogStatusValue = current === "complete" ? "partial" : "complete";
    setLoading(true);
    setError(null);
    try {
      const updated = await callFunction<DailyLogStatus>("set-daily-log-status", {
        date,
        status: next,
      });
      setCurrent(updated.status);
      onStatusChange?.(updated);
    } catch (err: any) {
      setError(err.message ?? "Failed to update log status.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
      <div>
        <p className="text-sm font-medium text-ink">{STATUS_COPY[current]}</p>
        {current === "complete" && (
          <p className="text-xs text-muted">Logging a new meal will re-open this automatically.</p>
        )}
      </div>
      <div className="flex items-center gap-3">
        {current === "complete" && (
          <span
            aria-label="Day marked complete"
            className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-green-500 text-white"
          >
            <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M3 8l3.5 3.5 6.5-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        )}
        <button
          type="button"
          onClick={toggle}
          disabled={loading}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
            current === "complete"
              ? "border border-border text-muted hover:border-primary hover:text-primary"
              : "bg-primary text-white hover:bg-primary-dark"
          }`}
        >
          {loading ? "…" : LABEL[current]}
        </button>
      </div>
      {error && <p className="mt-1 w-full text-xs text-confidence-low">{error}</p>}
    </div>
  );
}
