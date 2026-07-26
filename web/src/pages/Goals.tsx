import { useEffect, useState } from "react";
import { callFunction, getFunction } from "../lib/supabase";
import { GoalPhase, GoalPhaseMode, GoalPhaseStatus, PhaseTransition } from "../lib/goalTypes";

// ── Types ────────────────────────────────────────────────────────────────────

interface GetPhasesResponse {
  active_phase: GoalPhase | null;
  phases: GoalPhase[];
  total_count: number;
}

interface StartPhaseForm {
  mode: GoalPhaseMode;
  starting_weight_source: "manual" | "latest_weight_log";
  starting_weight_kg: string;
  target_weight_kg: string;
  target_change_kg_per_week: string;
  target_calories: string;
  target_protein_g: string;
  target_carbs_g: string;
  target_fat_g: string;
  transition: PhaseTransition | "";
}

const INITIAL_FORM: StartPhaseForm = {
  mode: "cut",
  starting_weight_source: "latest_weight_log",
  starting_weight_kg: "",
  target_weight_kg: "",
  target_change_kg_per_week: "",
  target_calories: "",
  target_protein_g: "",
  target_carbs_g: "",
  target_fat_g: "",
  transition: "",
};

const STATUS_LABEL: Record<GoalPhaseStatus, string> = {
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
  superseded: "Superseded",
};

const MODE_LABEL: Record<GoalPhaseMode, string> = {
  cut: "Cut",
  maintenance: "Maintenance",
  bulk: "Bulk",
};

// ── Main component ────────────────────────────────────────────────────────────

export default function Goals() {
  const [active, setActive] = useState<GoalPhase | null>(null);
  const [history, setHistory] = useState<GoalPhase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showNewForm, setShowNewForm] = useState(false);
  const [form, setForm] = useState<StartPhaseForm>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [needsTransition, setNeedsTransition] = useState(false);

  const [endingPhase, setEndingPhase] = useState(false);
  const [endOutcome, setEndOutcome] = useState<"completed" | "cancelled">("completed");
  const [endReason, setEndReason] = useState("");
  const [endError, setEndError] = useState<string | null>(null);

  useEffect(() => {
    fetchPhases();
  }, []);

  async function fetchPhases() {
    setLoading(true);
    setError(null);
    try {
      const result = await getFunction<GetPhasesResponse>("get-goal-phases");
      setActive(result.active_phase);
      setHistory(result.phases.filter((p) => p.status !== "active"));
    } catch (err: any) {
      setError(err.message ?? "Failed to load goal phases.");
    } finally {
      setLoading(false);
    }
  }

  // ── Start new phase ─────────────────────────────────────────────────────────

  function validateForm(): string | null {
    if (form.starting_weight_source === "manual") {
      const w = parseFloat(form.starting_weight_kg);
      if (!form.starting_weight_kg || isNaN(w)) return "Enter a starting weight.";
      if (w < 20 || w > 300) return "Starting weight must be between 20 and 300 kg.";
    }

    if (form.target_weight_kg) {
      const tw = parseFloat(form.target_weight_kg);
      if (isNaN(tw) || tw < 20 || tw > 300) return "Target weight must be between 20 and 300 kg.";
    }

    if (form.target_change_kg_per_week) {
      const rate = parseFloat(form.target_change_kg_per_week);
      if (isNaN(rate)) return "Weekly change rate must be a number.";
      if (form.mode === "cut") {
        // User enters a positive loss amount; we negate it on submit.
        if (rate <= 0) return "Loss per week must be greater than 0.";
        if (rate > 2.0) return "Loss per week cannot exceed 2.0 kg/week.";
      } else if (form.mode === "bulk") {
        if (rate <= 0) return "Gain per week must be greater than 0.";
        if (rate > 2.0) return "Gain per week cannot exceed 2.0 kg/week.";
      } else {
        if (rate !== 0) return "A maintenance phase requires a zero or blank rate.";
      }
    }

    if (form.target_calories) {
      const c = parseFloat(form.target_calories);
      if (isNaN(c) || c <= 0) return "Target calories must be a positive number.";
    }

    for (const field of ["target_protein_g", "target_carbs_g", "target_fat_g"] as const) {
      if (form[field]) {
        const v = parseFloat(form[field]);
        if (isNaN(v) || v < 0) return `${field.replace("_g", "").replace("target_", "")} target must be non-negative.`;
      }
    }

    if (active && !form.transition) {
      return "You have an active phase. Choose whether to supersede or cancel it.";
    }

    return null;
  }

  async function handleStartPhase(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validateForm();
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setNeedsTransition(false);

    try {
      const body: Record<string, unknown> = {
        mode: form.mode,
        starting_weight_source: form.starting_weight_source,
      };

      if (form.starting_weight_source === "manual") {
        body.starting_weight_kg = parseFloat(form.starting_weight_kg);
      }
      if (form.target_weight_kg) body.target_weight_kg = parseFloat(form.target_weight_kg);
      if (form.target_change_kg_per_week) {
        const rawRate = parseFloat(form.target_change_kg_per_week);
        // Cut: user enters positive loss amount → send negative. Bulk/maintenance: send as-is.
        body.target_change_kg_per_week = form.mode === "cut" ? -rawRate : rawRate;
      }
      if (form.target_calories) body.target_calories = parseFloat(form.target_calories);
      if (form.target_protein_g) body.target_protein_g = parseFloat(form.target_protein_g);
      if (form.target_carbs_g) body.target_carbs_g = parseFloat(form.target_carbs_g);
      if (form.target_fat_g) body.target_fat_g = parseFloat(form.target_fat_g);
      if (form.transition) body.transition = form.transition;

      await callFunction<GoalPhase>("start-goal-phase", body);
      setShowNewForm(false);
      setForm(INITIAL_FORM);
      await fetchPhases();
    } catch (err: any) {
      if (err.message?.includes("ACTIVE_PHASE_EXISTS")) {
        setNeedsTransition(true);
        setFormError("An active phase exists. Choose what to do with it below.");
      } else {
        setFormError(err.message ?? "Failed to start goal phase.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ── End active phase ─────────────────────────────────────────────────────────

  async function handleEndPhase(e: React.FormEvent) {
    e.preventDefault();
    setEndingPhase(true);
    setEndError(null);
    try {
      await callFunction("end-goal-phase", {
        outcome: endOutcome,
        ended_reason: endReason || undefined,
      });
      setEndingPhase(false);
      setEndReason("");
      await fetchPhases();
    } catch (err: any) {
      setEndError(err.message ?? "Failed to end goal phase.");
    } finally {
      setEndingPhase(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-ink">Goals</h1>
        {!showNewForm && (
          <button
            type="button"
            onClick={() => { setShowNewForm(true); setForm({ ...INITIAL_FORM, mode: active?.mode ?? "cut" }); setFormError(null); setNeedsTransition(false); }}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-dark"
          >
            Start new phase
          </button>
        )}
      </div>

      {error && <p className="mt-4 text-sm text-confidence-low">{error}</p>}
      {loading && <p className="mt-4 text-sm text-muted">Loading…</p>}

      {/* ── Active phase ───────────────────────────────────────────────────── */}
      {!loading && !error && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Active phase</h2>
          {active ? (
            <ActivePhaseDetail
              phase={active}
              onEndSubmit={handleEndPhase}
              endOutcome={endOutcome}
              setEndOutcome={setEndOutcome}
              endReason={endReason}
              setEndReason={setEndReason}
              endError={endError}
              endingPhase={endingPhase}
            />
          ) : (
            <p className="mt-3 text-sm text-muted">No active phase. Start one below.</p>
          )}
        </section>
      )}

      {/* ── New phase form ──────────────────────────────────────────────────── */}
      {showNewForm && (
        <section className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">New phase</h2>
            <button
              type="button"
              onClick={() => setShowNewForm(false)}
              className="text-xs text-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
          <form onSubmit={handleStartPhase} className="mt-3 space-y-4 rounded-lg border border-border bg-surface p-5">
            {/* Mode */}
            <div>
              <label className="block text-xs font-medium text-muted">Mode</label>
              <div className="mt-1 flex gap-2">
                {(["cut", "maintenance", "bulk"] as GoalPhaseMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, mode: m }))}
                    className={`rounded-full px-4 py-1.5 text-sm capitalize ${
                      form.mode === m ? "bg-primary text-white" : "border border-border text-muted"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* Starting weight */}
            <div>
              <label className="block text-xs font-medium text-muted">Starting weight</label>
              <div className="mt-1 flex gap-2">
                {(["latest_weight_log", "manual"] as const).map((src) => (
                  <button
                    key={src}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, starting_weight_source: src }))}
                    className={`rounded-full px-3 py-1 text-xs ${
                      form.starting_weight_source === src
                        ? "bg-primary text-white"
                        : "border border-border text-muted"
                    }`}
                  >
                    {src === "latest_weight_log" ? "Use latest logged weight" : "Enter manually"}
                  </button>
                ))}
              </div>
              {form.starting_weight_source === "manual" && (
                <input
                  type="number"
                  min="20"
                  max="300"
                  step="0.1"
                  placeholder="kg"
                  value={form.starting_weight_kg}
                  onChange={(e) => setForm((f) => ({ ...f, starting_weight_kg: e.target.value }))}
                  className="mt-2 w-32 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
                />
              )}
            </div>

            {/* Optional targets */}
            <div className="grid grid-cols-2 gap-3">
              <FormField
                label="Target weight (kg)"
                value={form.target_weight_kg}
                onChange={(v) => setForm((f) => ({ ...f, target_weight_kg: v }))}
                placeholder="optional"
              />
              <FormField
                label={form.mode === "cut" ? "Loss per week (kg)" : form.mode === "bulk" ? "Gain per week (kg)" : "Weekly rate (kg/week)"}
                value={form.target_change_kg_per_week}
                onChange={(v) => setForm((f) => ({ ...f, target_change_kg_per_week: v }))}
                placeholder={form.mode === "maintenance" ? "0" : "e.g. 0.5"}
              />
              <FormField
                label="Target calories (kcal)"
                value={form.target_calories}
                onChange={(v) => setForm((f) => ({ ...f, target_calories: v }))}
                placeholder="optional"
              />
              <FormField
                label="Protein (g)"
                value={form.target_protein_g}
                onChange={(v) => setForm((f) => ({ ...f, target_protein_g: v }))}
                placeholder="optional"
              />
              <FormField
                label="Carbs (g)"
                value={form.target_carbs_g}
                onChange={(v) => setForm((f) => ({ ...f, target_carbs_g: v }))}
                placeholder="optional"
              />
              <FormField
                label="Fat (g)"
                value={form.target_fat_g}
                onChange={(v) => setForm((f) => ({ ...f, target_fat_g: v }))}
                placeholder="optional"
              />
            </div>

            {/* Transition selector — shown if active phase exists or the API bounced with conflict */}
            {(active || needsTransition) && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/30">
                <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                  You have an active phase. What should happen to it?
                </p>
                <div className="mt-2 flex gap-2">
                  {(["supersede", "cancel"] as PhaseTransition[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, transition: t }))}
                      className={`rounded-full px-3 py-1 text-xs capitalize ${
                        form.transition === t ? "bg-amber-600 text-white" : "border border-amber-400 text-amber-700 dark:text-amber-300"
                      }`}
                    >
                      {t === "supersede" ? "Supersede (keep history)" : "Cancel it"}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {formError && <p className="text-sm text-confidence-low">{formError}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
            >
              {submitting ? "Starting…" : "Start phase"}
            </button>
          </form>
        </section>
      )}

      {/* ── History ────────────────────────────────────────────────────────── */}
      {!loading && history.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">History</h2>
          <div className="mt-3 space-y-3">
            {history.map((phase) => (
              <HistoryRow key={phase.id} phase={phase} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FormField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted">{label}</label>
      <input
        type="number"
        step="any"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
      />
    </div>
  );
}

function ActivePhaseDetail({
  phase,
  onEndSubmit,
  endOutcome,
  setEndOutcome,
  endReason,
  setEndReason,
  endError,
  endingPhase,
}: {
  phase: GoalPhase;
  onEndSubmit: (e: React.FormEvent) => void;
  endOutcome: "completed" | "cancelled";
  setEndOutcome: (v: "completed" | "cancelled") => void;
  endReason: string;
  setEndReason: (v: string) => void;
  endError: string | null;
  endingPhase: boolean;
}) {
  const [showEnd, setShowEnd] = useState(false);

  const startDate = new Date(phase.started_at).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <div className="mt-3 rounded-lg border border-border bg-surface px-5 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            phase.mode === "cut"
              ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
              : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
          }`}>
            {MODE_LABEL[phase.mode] ?? phase.mode}
          </span>
          <span className="text-xs text-muted">started {startDate}</span>
        </div>
        <button
          type="button"
          onClick={() => setShowEnd((v) => !v)}
          className="text-xs text-muted hover:text-confidence-low"
        >
          {showEnd ? "Cancel" : "End phase"}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-y-1 text-sm sm:grid-cols-3">
        {phase.target_calories != null && (
          <p><span className="text-muted">Calories: </span><span className="font-medium text-ink">{phase.target_calories} kcal</span></p>
        )}
        {phase.target_change_kg_per_week != null && (
          <p><span className="text-muted">{phase.mode === "cut" ? "Loss/week: " : phase.mode === "bulk" ? "Gain/week: " : "Rate: "}</span><span className="font-medium text-ink">{Math.abs(phase.target_change_kg_per_week!)} kg/wk</span></p>
        )}
        {phase.target_weight_kg != null && (
          <p><span className="text-muted">Goal weight: </span><span className="font-medium text-ink">{phase.target_weight_kg} kg</span></p>
        )}
        {phase.target_protein_g != null && (
          <p><span className="text-muted">Protein: </span><span className="font-medium text-ink">{phase.target_protein_g}g</span></p>
        )}
        {phase.target_carbs_g != null && (
          <p><span className="text-muted">Carbs: </span><span className="font-medium text-ink">{phase.target_carbs_g}g</span></p>
        )}
        {phase.target_fat_g != null && (
          <p><span className="text-muted">Fat: </span><span className="font-medium text-ink">{phase.target_fat_g}g</span></p>
        )}
        <p>
          <span className="text-muted">Start weight: </span>
          <span className="font-medium text-ink">{phase.starting_weight_kg} kg</span>
          <span className="ml-1 text-xs text-muted">({phase.starting_weight_source})</span>
        </p>
      </div>

      {showEnd && (
        <form onSubmit={onEndSubmit} className="mt-4 space-y-3 border-t border-border pt-4">
          <p className="text-sm font-medium text-ink">End this phase</p>
          <div className="flex gap-2">
            {(["completed", "cancelled"] as const).map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setEndOutcome(o)}
                className={`rounded-full px-3 py-1 text-xs capitalize ${
                  endOutcome === o ? "bg-primary text-white" : "border border-border text-muted"
                }`}
              >
                {o}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Reason (optional)"
            value={endReason}
            onChange={(e) => setEndReason(e.target.value)}
            maxLength={200}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
          {endError && <p className="text-sm text-confidence-low">{endError}</p>}
          <button
            type="submit"
            disabled={endingPhase}
            className="rounded-lg border border-confidence-low px-3 py-1.5 text-sm text-confidence-low hover:bg-confidence-low hover:text-white disabled:opacity-50"
          >
            {endingPhase ? "Ending…" : `Mark as ${endOutcome}`}
          </button>
        </form>
      )}
    </div>
  );
}

function HistoryRow({ phase }: { phase: GoalPhase }) {
  const startDate = new Date(phase.started_at).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const endDate = phase.ended_at
    ? new Date(phase.ended_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })
    : null;

  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-ink">{MODE_LABEL[phase.mode] ?? phase.mode}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs ${
          phase.status === "completed" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
          : phase.status === "superseded" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
          : "bg-border text-muted"
        }`}>
          {STATUS_LABEL[phase.status] ?? phase.status}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-muted">
        {startDate}{endDate ? ` — ${endDate}` : ""}
        {phase.ended_reason ? ` · ${phase.ended_reason}` : ""}
      </p>
      {(phase.target_calories != null || phase.target_weight_kg != null) && (
        <div className="mt-1 flex gap-3 text-xs text-muted">
          {phase.target_calories != null && <span>{phase.target_calories} kcal</span>}
          {phase.target_weight_kg != null && <span>goal {phase.target_weight_kg} kg</span>}
          {phase.target_change_kg_per_week != null && (
            <span>{Math.abs(phase.target_change_kg_per_week)} kg/wk {phase.mode === "bulk" ? "gain" : "loss"}</span>
          )}
        </div>
      )}
    </div>
  );
}
