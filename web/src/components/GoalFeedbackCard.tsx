import { useState, useEffect, useCallback } from "react";
import {
  getGoalFeedback,
  saveGoalFeedbackAssessment,
  stateHeadline,
  stateDescription,
  actionLabel,
  stateTone,
  formatWeeklyRate,
  formatAttainment,
  formatAdvisoryAdjustment,
  formatCoverage,
  formatGoalMode,
  hasAdvisoryAdjustment,
  type GoalFeedbackResponse,
  type ProgressState,
  type StateTone,
} from "../lib/goalFeedback";
import ConfidenceBadge from "./ConfidenceBadge";

// ── Tone → Tailwind class maps ────────────────────────────────────────────────

const CARD_BORDER: Record<StateTone, string> = {
  neutral:  "border-gray-200 dark:border-gray-700",
  positive: "border-green-200 dark:border-green-800",
  advisory: "border-amber-200 dark:border-amber-800",
  warning:  "border-red-200 dark:border-red-800",
};

const CARD_BG: Record<StateTone, string> = {
  neutral:  "bg-white dark:bg-gray-800",
  positive: "bg-green-50 dark:bg-green-950",
  advisory: "bg-amber-50 dark:bg-amber-950",
  warning:  "bg-red-50 dark:bg-red-950",
};

const HEADLINE_COLOR: Record<StateTone, string> = {
  neutral:  "text-gray-800 dark:text-gray-200",
  positive: "text-green-800 dark:text-green-300",
  advisory: "text-amber-800 dark:text-amber-300",
  warning:  "text-red-800 dark:text-red-300",
};

const DESC_COLOR: Record<StateTone, string> = {
  neutral:  "text-gray-500 dark:text-gray-400",
  positive: "text-green-700 dark:text-green-400",
  advisory: "text-amber-700 dark:text-amber-400",
  warning:  "text-red-700 dark:text-red-400",
};

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-1 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <span className="text-sm text-gray-600 dark:text-gray-400">{label}</span>
      <span className="text-sm font-medium text-right">{value}</span>
    </div>
  );
}

function EvidenceBlock({
  label,
  p6Status,
  p6Confidence,
  p6Rate,
  p7Status,
  p7Coverage,
}: {
  label: string;
  p6Status: string;
  p6Confidence: "low" | "medium" | "high";
  p6Rate: number | null;
  p7Status: "usable" | "provisional" | "insufficient" | null;
  p7Coverage: number | null;
}) {
  return (
    <div className="space-y-0" data-testid={`evidence-${label.replace(/\s+/g, "-").toLowerCase()}`}>
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{label}</p>
      <SectionRow label="Weight trend"      value={`${p6Status} · ${p6Confidence} confidence`} />
      <SectionRow label="Observed rate"     value={formatWeeklyRate(p6Rate)} />
      <SectionRow label="Nutrition quality" value={p7Status ?? "—"} />
      <SectionRow label="Log coverage"      value={formatCoverage(p7Coverage)} />
    </div>
  );
}

// ── Skeleton states ───────────────────────────────────────────────────────────

function LoadingCard() {
  return (
    <div
      className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6"
      data-testid="goal-feedback-card-loading"
    >
      <p className="text-sm text-gray-500 dark:text-gray-400">Loading goal feedback…</p>
    </div>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 p-6"
      role="alert"
      data-testid="goal-feedback-card-error"
    >
      <p className="text-sm font-medium text-red-700 dark:text-red-400">Feedback unavailable</p>
      <p className="text-sm text-red-600 dark:text-red-500 mt-1">{message}</p>
      <button
        onClick={onRetry}
        className="mt-3 text-sm underline text-red-600 dark:text-red-400 hover:text-red-800"
      >
        Try again
      </button>
    </div>
  );
}

// ── Advisory adjustment banner ─────────────────────────────────────────────────

function AdvisoryBanner({ data }: { data: GoalFeedbackResponse }) {
  // plateau_candidate: tell user explicitly that no adjustment is suggested yet
  if (data.progress_state === "plateau_candidate") {
    return (
      <div
        className="mt-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 px-4 py-3"
        data-testid="plateau-candidate-notice"
      >
        <p className="text-sm text-amber-700 dark:text-amber-400">
          More evidence is needed. No calorie adjustment is suggested yet.
        </p>
      </div>
    );
  }

  // Blocked adjustment — show friendly reason when attempted but blocked
  if (
    data.progress_state === "likely_plateau" &&
    !hasAdvisoryAdjustment(data) &&
    data.adjustment_blocked_reason_codes?.length > 0
  ) {
    const friendlyReasonMap: Record<string, string> = {
      missing_current_target:          "Your calorie target is not set.",
      missing_official_weight:         "No official weight measurement found.",
      low_weight_confidence:           "Weight trend confidence is too low.",
      low_maintenance_confidence:      "Maintenance estimate confidence is too low.",
      insufficient_nutrition_coverage: "Nutrition log coverage is below 70%.",
      aggressive_rate_warning:         "Your goal rate has an unresolved safety warning.",
      rate_exceeds_one_percent_body_weight: "The required correction would exceed 1% of body weight per week.",
      required_correction_below_minimum:   "The required adjustment is below the minimum meaningful change.",
      proposed_target_below_floor:     "The proposed target would be below the safe minimum of 1,000 kcal/day.",
      evidence_conflict:               "Nutrition and weight data are inconsistent — review your logs.",
    };
    const reason = friendlyReasonMap[data.adjustment_blocked_reason_codes[0]] ??
      "A safety condition prevents a specific suggestion.";
    return (
      <div
        className="mt-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 px-4 py-3"
        data-testid="adjustment-blocked-notice"
      >
        <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
          No specific adjustment can be suggested
        </p>
        <p className="text-sm text-amber-700 dark:text-amber-400 mt-0.5" data-testid="adjustment-blocked-reason">
          {reason}
        </p>
      </div>
    );
  }

  if (!hasAdvisoryAdjustment(data)) return null;

  const text = formatAdvisoryAdjustment(
    data.advisory_calorie_adjustment_kcal,
    data.advisory_adjustment_direction,
  );

  // likely_plateau: show proposed target alongside the adjustment
  const proposedTarget = data.proposed_target_kcal;

  return (
    <div
      className="mt-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950 px-4 py-3"
      data-testid="advisory-adjustment-banner"
    >
      <p className="text-sm font-medium text-blue-800 dark:text-blue-300">Advisory suggestion</p>
      <p className="text-sm text-blue-700 dark:text-blue-400 mt-0.5" data-testid="advisory-adjustment-text">
        {text}
      </p>
      {proposedTarget != null && (
        <p className="text-sm text-blue-700 dark:text-blue-400 mt-0.5" data-testid="proposed-target-text">
          Proposed target: {Math.round(proposedTarget)} kcal/day
        </p>
      )}
      <p className="text-xs text-blue-500 dark:text-blue-500 mt-1">
        This is a planning estimate only. Any calorie-target change requires your explicit confirmation.
      </p>
    </div>
  );
}

// ── Reason codes (expandable) ─────────────────────────────────────────────────

function ReasonCodesDetail({ codes }: { codes: string[] }) {
  if (codes.length === 0) return null;
  return (
    <details className="mt-4 group" data-testid="reason-codes-detail">
      <summary className="text-sm font-medium text-gray-600 dark:text-gray-400 cursor-pointer select-none">
        Why this assessment?
      </summary>
      <ul className="mt-2 list-disc pl-5 space-y-0.5" data-testid="reason-codes-list">
        {codes.map((code) => (
          <li key={code} className="text-xs text-gray-500 dark:text-gray-400">{code}</li>
        ))}
      </ul>
    </details>
  );
}

// ── Main card ─────────────────────────────────────────────────────────────────

interface GoalFeedbackCardProps {
  onAssessmentSaved?: (assessmentId: string) => void;
}

export function GoalFeedbackCard({ onAssessmentSaved }: GoalFeedbackCardProps) {
  const [data, setData]       = useState<GoalFeedbackResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [saving, setSaving]   = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getGoalFeedback();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load goal feedback.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!data?.goal_phase?.id) return;
    setSaving(true);
    try {
      const saved = await saveGoalFeedbackAssessment(data.goal_phase.id);
      setSavedId(saved.assessment_id);
      onAssessmentSaved?.(saved.assessment_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save assessment.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingCard />;
  if (error)   return <ErrorCard message={error} onRetry={load} />;
  if (!data)   return null;

  const state  = data.progress_state as ProgressState;
  const tone   = stateTone(state);

  // ── No active phase ────────────────────────────────────────────────────────
  if (state === "no_active_goal_phase") {
    return (
      <div
        className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6"
        data-testid="goal-feedback-card-no-phase"
      >
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">Goal Feedback</h2>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          {stateDescription(state)}
        </p>
      </div>
    );
  }

  // ── Insufficient / stale data ──────────────────────────────────────────────
  if (state === "insufficient_data" || state === "stale_data") {
    return (
      <div
        className={`rounded-2xl border ${CARD_BORDER[tone]} ${CARD_BG[tone]} p-6`}
        data-testid="goal-feedback-card-no-data"
      >
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">Goal Feedback</h2>
        {data.goal_phase && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {formatGoalMode(data.goal_phase.mode)} phase active
          </p>
        )}
        <p className={`mt-3 text-sm ${DESC_COLOR[tone]}`}>
          {stateDescription(state)}
        </p>
      </div>
    );
  }

  // ── Full assessment ────────────────────────────────────────────────────────

  const current    = data.evidence.current;
  const historical = data.evidence.historical_14d;

  return (
    <div
      className={`rounded-2xl border ${CARD_BORDER[tone]} ${CARD_BG[tone]} p-6`}
      data-testid="goal-feedback-card"
    >
      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className={`text-base font-semibold ${HEADLINE_COLOR[tone]}`} data-testid="state-headline">
            {stateHeadline(state)}
          </h2>
          {data.goal_phase && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {formatGoalMode(data.goal_phase.mode)} phase
            </p>
          )}
        </div>
        {current?.p6_confidence && <ConfidenceBadge level={current.p6_confidence} />}
      </div>

      {/* ── State description ── */}
      <p className={`mt-3 text-sm ${DESC_COLOR[tone]}`} data-testid="state-description">
        {stateDescription(state)}
      </p>

      {/* ── Recommended action ── */}
      <div className="mt-3" data-testid="feedback-action">
        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
          {actionLabel(data.feedback_action)}
        </span>
      </div>

      {/* ── Advisory adjustment (cut/bulk only, when eligible) ── */}
      <AdvisoryBanner data={data} />

      {/* ── Key metrics ── */}
      {(data.goal_attainment_ratio != null || current?.p6_weekly_rate_kg != null) && (
        <div className="mt-5 space-y-0" data-testid="key-metrics">
          {current?.p6_weekly_rate_kg != null && (
            <SectionRow label="Observed rate" value={formatWeeklyRate(current.p6_weekly_rate_kg)} />
          )}
          {data.goal_phase?.target_change_kg_per_week != null && (
            <SectionRow
              label="Target rate"
              value={formatWeeklyRate(data.goal_phase.target_change_kg_per_week)}
            />
          )}
          {data.goal_attainment_ratio != null && (
            <SectionRow label="Goal attainment" value={formatAttainment(data.goal_attainment_ratio)} />
          )}
        </div>
      )}

      {/* ── Evidence blocks (expandable) ── */}
      {(current || historical) && (
        <details className="mt-5 group" data-testid="evidence-detail">
          <summary className="text-sm font-medium text-gray-600 dark:text-gray-400 cursor-pointer select-none">
            Evidence details
          </summary>
          <div className="mt-3 space-y-4">
            {current && (
              <EvidenceBlock
                label="Current"
                p6Status={current.p6_status}
                p6Confidence={current.p6_confidence}
                p6Rate={current.p6_weekly_rate_kg}
                p7Status={current.p7_status}
                p7Coverage={current.p7_coverage_fraction}
              />
            )}
            {historical && (
              <EvidenceBlock
                label="14 days ago"
                p6Status={historical.p6_status}
                p6Confidence={historical.p6_confidence}
                p6Rate={historical.p6_weekly_rate_kg}
                p7Status={historical.p7_status}
                p7Coverage={historical.p7_coverage_fraction}
              />
            )}
          </div>
        </details>
      )}

      {/* ── Reason codes ── */}
      <ReasonCodesDetail codes={data.reason_codes} />

      {/* ── Warnings ── */}
      {data.warnings.length > 0 && (
        <div className="mt-4 space-y-1" data-testid="warnings">
          {data.warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-600 dark:text-amber-400">{w}</p>
          ))}
        </div>
      )}

      {/* ── Save action ── */}
      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || !!savedId || !data.goal_phase}
          className="rounded-lg px-4 py-2 text-sm font-medium bg-green-700 text-white hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="save-assessment-btn"
        >
          {savedId ? "Assessment saved" : saving ? "Saving…" : "Save this assessment"}
        </button>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Saves a snapshot. Does not change your calorie target.
        </p>
      </div>
    </div>
  );
}
