import { useEffect, useState } from "react";
import { callFunction, getFunction, supabase } from "../lib/supabase";
import {
  GoalPhase, GoalPhaseMode, GoalPhaseStatus, PhaseTransition,
  CalorieTargetSnapshot, EnergyCalcPreview,
} from "../lib/goalTypes";
import { ACTIVITY_LABELS, ABSOLUTE_FLOOR_KCAL } from "../lib/scienceConfig";

// ── Types ────────────────────────────────────────────────────────────────────

interface GetPhasesResponse {
  active_phase: GoalPhase | null;
  phases: GoalPhase[];
  total_count: number;
}

interface StartPhaseBody {
  mode: string;
  starting_weight_source: "manual" | "latest_weight_log";
  starting_weight_kg?: number;
  target_weight_kg?: number;
  target_change_kg_per_week?: number;
  activity_level?: string;
  manual_maintenance_kcal?: number;
  aggressive_rate_acknowledged?: boolean;
  target_protein_g?: number;
  target_carbs_g?: number;
  target_fat_g?: number;
  target_fibre_g?: number;
  transition?: string;
}

interface StartPhaseForm {
  mode: GoalPhaseMode;
  starting_weight_source: "manual" | "latest_weight_log";
  starting_weight_kg: string;
  target_weight_kg: string;
  target_change_kg_per_week: string;
  activity_level: string;
  use_manual_maintenance: boolean;
  manual_maintenance_kcal: string;
  target_protein_g: string;
  target_carbs_g: string;
  target_fat_g: string;
  target_fibre_g: string;
  transition: PhaseTransition | "";
}

const INITIAL_FORM: StartPhaseForm = {
  mode: "cut",
  starting_weight_source: "latest_weight_log",
  starting_weight_kg: "",
  target_weight_kg: "",
  target_change_kg_per_week: "",
  activity_level: "",
  use_manual_maintenance: false,
  manual_maintenance_kcal: "",
  target_protein_g: "",
  target_carbs_g: "",
  target_fat_g: "",
  target_fibre_g: "",
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

const ACTIVITY_LEVEL_OPTIONS = [
  "sedentary", "light", "moderate", "active", "very_active",
] as const;

// ── Main component ────────────────────────────────────────────────────────────

export default function Goals() {
  const [active, setActive] = useState<GoalPhase | null>(null);
  const [history, setHistory] = useState<GoalPhase[]>([]);
  const [visibleHistory, setVisibleHistory] = useState(5);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showNewForm, setShowNewForm] = useState(false);
  const [form, setForm] = useState<StartPhaseForm>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [needsTransition, setNeedsTransition] = useState(false);

  const [latestWeight, setLatestWeight] = useState<number | null | undefined>(undefined);
  const [profileActivityLevel, setProfileActivityLevel] = useState<string>("");

  // Energy preview
  const [preview, setPreview] = useState<EnergyCalcPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [aggressiveAcknowledged, setAggressiveAcknowledged] = useState(false);

  // Active phase snapshot
  const [snapshot, setSnapshot] = useState<CalorieTargetSnapshot | null>(null);

  const [endingPhase, setEndingPhase] = useState(false);
  const [endOutcome, setEndOutcome] = useState<"completed" | "cancelled">("completed");
  const [endReason, setEndReason] = useState("");
  const [endError, setEndError] = useState<string | null>(null);

  useEffect(() => {
    fetchPhases();
    fetchLatestWeight();
    fetchProfile();
  }, []);

  async function fetchProfile() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("activity_level")
        .eq("id", user.id)
        .maybeSingle();
      setProfileActivityLevel(data?.activity_level ?? "");
    } catch {
      // profile may not have activity_level set yet — that's fine
    }
  }

  async function fetchLatestWeight() {
    try {
      const result = await getFunction<{ latest_official: { weight_kg: number } | null }>("get-weight-logs", { limit: "1" });
      setLatestWeight(result.latest_official ? result.latest_official.weight_kg : null);
    } catch {
      setLatestWeight(null);
    }
  }

  async function fetchPhases() {
    setLoading(true);
    setError(null);
    try {
      const result = await getFunction<GetPhasesResponse>("get-goal-phases");
      setActive(result.active_phase);
      setHistory(result.phases.filter((p) => p.status !== "active"));
      setVisibleHistory(5);

      // Fetch snapshot for the active phase if it has one.
      if (result.active_phase?.snapshot_id) {
        fetchSnapshot(result.active_phase.snapshot_id);
      } else {
        setSnapshot(null);
      }
    } catch (err: any) {
      setError(err.message ?? "Failed to load goal phases.");
    } finally {
      setLoading(false);
    }
  }

  async function fetchSnapshot(snapshotId: string) {
    try {
      const { data } = await supabase
        .from("calorie_target_snapshots")
        .select("*")
        .eq("id", snapshotId)
        .maybeSingle();
      setSnapshot(data as CalorieTargetSnapshot | null);
    } catch {
      setSnapshot(null);
    }
  }

  // ── Preview calculation ─────────────────────────────────────────────────────

  async function handlePreview() {
    setPreviewError(null);
    setPreview(null);
    setAggressiveAcknowledged(false);

    const rate = form.mode === "maintenance" ? 0 : parseFloat(form.target_change_kg_per_week || "0");
    const finalRate = form.mode === "cut" ? -Math.abs(rate) : rate;

    const previewBody: Record<string, unknown> = {
      goal_mode: form.mode,
      target_change_kg_per_week: finalRate,
    };
    if (form.activity_level) previewBody.activity_level = form.activity_level;
    if (form.use_manual_maintenance && form.manual_maintenance_kcal) {
      previewBody.manual_maintenance_kcal = parseFloat(form.manual_maintenance_kcal);
    }

    setPreviewing(true);
    try {
      const result = await callFunction<EnergyCalcPreview>("preview-energy-calc", previewBody);
      setPreview(result);
    } catch (err: any) {
      setPreviewError(err.message ?? "Could not calculate preview.");
    } finally {
      setPreviewing(false);
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
      if (isNaN(tw) || tw < 1 || tw > 500) return "Target weight must be between 1 and 500 kg.";
      const sw = form.starting_weight_source === "manual"
        ? parseFloat(form.starting_weight_kg)
        : (latestWeight ?? NaN);
      if (!isNaN(sw)) {
        if (form.mode === "bulk" && tw <= sw) return "Bulk target weight must be higher than your starting weight.";
        if (form.mode === "cut" && tw >= sw) return "Cut target weight must be lower than your starting weight.";
      }
    }

    if (form.mode !== "maintenance" && form.target_change_kg_per_week) {
      const rate = parseFloat(form.target_change_kg_per_week);
      if (isNaN(rate)) return "Weekly change rate must be a number.";
      if (rate <= 0) return `${form.mode === "cut" ? "Loss" : "Gain"} per week must be greater than 0.`;
      if (rate > 2.0) return "Rate cannot exceed 2.0 kg/week.";
    }

    if (form.use_manual_maintenance && form.manual_maintenance_kcal) {
      const m = parseFloat(form.manual_maintenance_kcal);
      if (isNaN(m) || m < 500 || m > 10_000) return "Manual maintenance must be between 500 and 10,000 kcal/day.";
    }

    for (const field of ["target_protein_g", "target_carbs_g", "target_fat_g", "target_fibre_g"] as const) {
      if (form[field]) {
        const v = parseFloat(form[field]);
        if (isNaN(v) || v < 0) return `${field.replace("_g", "").replace("target_", "")} target must be non-negative.`;
      }
    }

    if (active && !form.transition) {
      return "You have an active phase. Choose whether to supersede or cancel it.";
    }

    // If aggressive rate is flagged in the preview, require acknowledgement.
    if (preview?.is_aggressive_rate && !aggressiveAcknowledged) {
      return "Acknowledge the aggressive rate warning before starting this phase.";
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
      const body: StartPhaseBody = {
        mode: form.mode,
        starting_weight_source: form.starting_weight_source,
      };

      if (form.starting_weight_source === "manual") {
        body.starting_weight_kg = parseFloat(form.starting_weight_kg);
      }
      if (form.target_weight_kg) body.target_weight_kg = parseFloat(form.target_weight_kg);
      if (form.mode !== "maintenance" && form.target_change_kg_per_week) {
        const rawRate = parseFloat(form.target_change_kg_per_week);
        body.target_change_kg_per_week = form.mode === "cut" ? -rawRate : rawRate;
      }
      if (form.activity_level) body.activity_level = form.activity_level;
      if (form.use_manual_maintenance && form.manual_maintenance_kcal) {
        body.manual_maintenance_kcal = parseFloat(form.manual_maintenance_kcal);
      }
      if (aggressiveAcknowledged) body.aggressive_rate_acknowledged = true;
      if (form.target_protein_g) body.target_protein_g = parseFloat(form.target_protein_g);
      if (form.target_carbs_g) body.target_carbs_g = parseFloat(form.target_carbs_g);
      if (form.target_fat_g) body.target_fat_g = parseFloat(form.target_fat_g);
      if (form.target_fibre_g) body.target_fibre_g = parseFloat(form.target_fibre_g);
      if (form.transition) body.transition = form.transition;

      await callFunction<{ phase: GoalPhase; snapshot: CalorieTargetSnapshot | null }>(
        "start-goal-phase", body,
      );
      setShowNewForm(false);
      setForm(INITIAL_FORM);
      setPreview(null);
      setAggressiveAcknowledged(false);
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

  // Reset preview when mode or rate changes.
  function updateForm(updater: (f: StartPhaseForm) => StartPhaseForm) {
    setForm(updater);
    setPreview(null);
    setPreviewError(null);
    setAggressiveAcknowledged(false);
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-ink">Goals</h1>
        {!showNewForm && (
          <button
            type="button"
            onClick={() => {
              setShowNewForm(true);
              setForm({
                ...INITIAL_FORM,
                mode: active?.mode ?? "cut",
                activity_level: profileActivityLevel,
              });
              setFormError(null);
              setNeedsTransition(false);
              setPreview(null);
              setPreviewError(null);
              setAggressiveAcknowledged(false);
            }}
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
              snapshot={snapshot}
              onEndSubmit={handleEndPhase}
              endOutcome={endOutcome}
              setEndOutcome={setEndOutcome}
              endReason={endReason}
              setEndReason={setEndReason}
              endError={endError}
              endingPhase={endingPhase}
              onUpdate={fetchPhases}
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
              onClick={() => { setShowNewForm(false); setPreview(null); setPreviewError(null); }}
              className="text-xs text-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>

          <form onSubmit={handleStartPhase} className="mt-3 space-y-5 rounded-lg border border-border bg-surface p-5">
            {/* ── Mode ──────────────────────────────────────────────────────── */}
            <div>
              <label className="block text-xs font-medium text-muted">Phase mode</label>
              <div className="mt-1 flex gap-2">
                {(["cut", "maintenance", "bulk"] as GoalPhaseMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => updateForm((f) => ({ ...f, mode: m }))}
                    className={`rounded-full px-4 py-1.5 text-sm capitalize ${
                      form.mode === m ? "bg-primary text-white" : "border border-border text-muted"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Starting weight ────────────────────────────────────────────── */}
            <div>
              <label className="block text-xs font-medium text-muted">Starting weight</label>
              <div className="mt-1 flex gap-2">
                {(["latest_weight_log", "manual"] as const).map((src) => (
                  <button
                    key={src}
                    type="button"
                    onClick={() => updateForm((f) => ({ ...f, starting_weight_source: src }))}
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
                  type="number" min="1" max="500" step="0.1" placeholder="kg"
                  value={form.starting_weight_kg}
                  onChange={(e) => updateForm((f) => ({ ...f, starting_weight_kg: e.target.value }))}
                  className="mt-2 w-32 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
                />
              )}
              {form.starting_weight_source === "latest_weight_log" && latestWeight !== undefined && (
                latestWeight !== null
                  ? <p className="mt-1.5 text-xs text-muted">Will use <span className="font-medium text-ink">{latestWeight} kg</span></p>
                  : <p className="mt-1.5 text-xs text-confidence-low">No official weight logged yet. <a href="/weight" className="underline">Log one first</a> or switch to manual entry.</p>
              )}
            </div>

            {/* ── Rate ───────────────────────────────────────────────────────── */}
            {form.mode !== "maintenance" && (
              <div>
                <label className="block text-xs font-medium text-muted">
                  {form.mode === "cut" ? "Loss per week (kg)" : "Gain per week (kg)"}
                </label>
                <input
                  type="number" step="0.05" min="0.05" max="2.0" placeholder="e.g. 0.5"
                  value={form.target_change_kg_per_week}
                  onChange={(e) => updateForm((f) => ({ ...f, target_change_kg_per_week: e.target.value }))}
                  className="mt-1 w-32 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
                />
                <p className="mt-1 text-xs text-muted">Enter a positive number; max 2.0 kg/week.</p>
              </div>
            )}

            {/* ── Activity level ─────────────────────────────────────────────── */}
            <div>
              <label className="block text-xs font-medium text-muted">Activity level</label>
              <p className="mt-0.5 text-xs text-muted">
                Used to estimate your maintenance calories.
                {profileActivityLevel && ` Your profile has: ${ACTIVITY_LABELS[profileActivityLevel] ?? profileActivityLevel}`}
              </p>
              <select
                value={form.activity_level || profileActivityLevel}
                onChange={(e) => updateForm((f) => ({ ...f, activity_level: e.target.value }))}
                className="mt-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">— select activity level —</option>
                {ACTIVITY_LEVEL_OPTIONS.map((level) => (
                  <option key={level} value={level}>{ACTIVITY_LABELS[level]}</option>
                ))}
              </select>
            </div>

            {/* ── Manual maintenance override ─────────────────────────────────── */}
            <div>
              <label className="flex items-center gap-2 text-xs font-medium text-muted">
                <input
                  type="checkbox"
                  checked={form.use_manual_maintenance}
                  onChange={(e) => updateForm((f) => ({ ...f, use_manual_maintenance: e.target.checked }))}
                  className="rounded"
                />
                Use manual maintenance override
              </label>
              {form.use_manual_maintenance && (
                <div className="mt-2">
                  <p className="text-xs text-muted mb-1">
                    If you know your actual maintenance calories (e.g. from a metabolic test or tracking history),
                    enter it here. This overrides the equation estimate.
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="number" step="10" min="500" max="10000" placeholder="kcal/day"
                      value={form.manual_maintenance_kcal}
                      onChange={(e) => updateForm((f) => ({ ...f, manual_maintenance_kcal: e.target.value }))}
                      className="w-36 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
                    />
                    <span className="text-xs text-muted">kcal/day</span>
                  </div>
                </div>
              )}
            </div>

            {/* ── Optional: target weight ─────────────────────────────────────── */}
            <div>
              <label className="block text-xs font-medium text-muted">Target weight (optional)</label>
              <input
                type="number" step="0.1" min="1" max="500" placeholder="kg"
                value={form.target_weight_kg}
                onChange={(e) => updateForm((f) => ({ ...f, target_weight_kg: e.target.value }))}
                className="mt-1 w-32 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* ── Macronutrient targets ───────────────────────────────────────── */}
            <details>
              <summary className="cursor-pointer text-xs font-medium text-muted hover:text-ink">
                Optional macronutrient targets ▸
              </summary>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {([
                  { key: "target_protein_g", label: "Protein (g)" },
                  { key: "target_carbs_g",   label: "Carbs (g)" },
                  { key: "target_fat_g",     label: "Fat (g)" },
                  { key: "target_fibre_g",   label: "Fibre (g)" },
                ] as { key: keyof StartPhaseForm; label: string }[]).map(({ key, label }) => (
                  <FormField
                    key={key}
                    label={label}
                    value={form[key] as string}
                    onChange={(v) => updateForm((f) => ({ ...f, [key]: v }))}
                    placeholder="optional"
                  />
                ))}
              </div>
            </details>

            {/* ── Preview calculation ─────────────────────────────────────────── */}
            <div className="border-t border-border pt-4">
              <button
                type="button"
                onClick={handlePreview}
                disabled={previewing}
                className="rounded-lg border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-primary hover:text-white disabled:opacity-50"
              >
                {previewing ? "Calculating…" : "Preview calorie target"}
              </button>
              <p className="mt-1 text-xs text-muted">
                Estimates your calorie target before committing. The final value is calculated by the server when you start the phase.
              </p>

              {previewError && (
                <div className="mt-3 rounded-lg border border-confidence-low bg-red-50 p-3 text-sm text-confidence-low dark:bg-red-950/30">
                  {previewError}
                </div>
              )}

              {preview && !preview.eligible && (
                <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/30">
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Profile incomplete</p>
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{preview.instructions}</p>
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">
                    Missing: {preview.missing_fields.join(", ")}
                  </p>
                </div>
              )}

              {preview?.eligible && (
                <div className="mt-3 space-y-3">
                  {/* Calorie breakdown */}
                  <div className="rounded-lg border border-border bg-surface/50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Calorie breakdown</p>
                    <CalorieBreakdown preview={preview} />
                  </div>

                  {/* Aggressive rate warning */}
                  {preview.is_aggressive_rate && (
                    <div className="rounded-lg border border-amber-400 bg-amber-50 p-3 dark:border-amber-600 dark:bg-amber-950/30">
                      <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">Aggressive rate</p>
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                        The requested rate exceeds 1% of body weight per week, which is considered aggressive.
                        Rapid fat loss or gain increases risk of muscle loss, metabolic adaptation, or nutrient deficiency.
                      </p>
                      <label className="mt-2 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
                        <input
                          type="checkbox"
                          checked={aggressiveAcknowledged}
                          onChange={(e) => setAggressiveAcknowledged(e.target.checked)}
                          className="rounded"
                        />
                        I understand and accept this rate.
                      </label>
                    </div>
                  )}

                  {/* Floor warning */}
                  {preview.warnings?.includes("target_below_floor") && (
                    <div className="rounded-lg border border-confidence-low bg-red-50 p-3 text-sm text-confidence-low dark:bg-red-950/30">
                      Calculated target ({preview.recommended_target_kcal} kcal/day) is below the minimum of {ABSOLUTE_FLOOR_KCAL} kcal/day.
                      Reduce your rate or increase your manual maintenance.
                    </div>
                  )}

                  {/* Expandable explanation */}
                  {preview.explanation && (
                    <details>
                      <summary className="cursor-pointer text-xs text-primary hover:underline">
                        How this was calculated ▸
                      </summary>
                      <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-surface/80 p-3 text-xs text-muted border border-border">
                        {preview.explanation}
                      </pre>
                    </details>
                  )}
                </div>
              )}
            </div>

            {/* ── Transition selector ─────────────────────────────────────────── */}
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
            {history.slice(0, visibleHistory).map((phase) => (
              <HistoryRow key={phase.id} phase={phase} />
            ))}
          </div>
          {visibleHistory < history.length && (
            <button
              onClick={() => setVisibleHistory((v) => v + 5)}
              className="mt-3 w-full rounded-lg border border-border py-2.5 text-sm text-muted hover:text-ink"
            >
              Show more
            </button>
          )}
        </section>
      )}
    </div>
  );
}

// ── CalorieBreakdown ──────────────────────────────────────────────────────────

function CalorieBreakdown({ preview }: { preview: EnergyCalcPreview }) {
  return (
    <div className="space-y-1 text-sm">
      <BreakdownRow label="Resting energy (BMR)" value={`${preview.estimated_bmr_kcal} kcal/day`} />
      <BreakdownRow label={`× Activity multiplier (${preview.input_snapshot?.activity_level ?? ""})`}
                    value={`${preview.estimated_tdee_kcal} kcal/day`} />
      {preview.maintenance_source === "manual_override" ? (
        <BreakdownRow label="Maintenance (manual override)" value={`${preview.effective_maintenance_kcal} kcal/day`} highlight />
      ) : (
        <BreakdownRow label="Estimated maintenance (TDEE)" value={`${preview.effective_maintenance_kcal} kcal/day`} />
      )}
      {preview.daily_adjustment_kcal !== 0 && (
        <BreakdownRow
          label={preview.daily_adjustment_kcal! < 0 ? "Daily deficit" : "Daily surplus"}
          value={`${preview.daily_adjustment_kcal! < 0 ? "" : "+"}${preview.daily_adjustment_kcal} kcal/day`}
        />
      )}
      <div className="border-t border-border pt-1 mt-1">
        <BreakdownRow
          label="Calorie target"
          value={`${preview.recommended_target_kcal} kcal/day`}
          bold
        />
      </div>
    </div>
  );
}

function BreakdownRow({
  label, value, bold, highlight,
}: {
  label: string; value: string; bold?: boolean; highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-xs ${highlight ? "text-blue-600 dark:text-blue-400" : "text-muted"}`}>{label}</span>
      <span className={`text-xs ${bold ? "font-semibold text-ink" : highlight ? "text-blue-600 dark:text-blue-400" : "text-ink"}`}>
        {value}
      </span>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FormField({
  label, value, onChange, placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted">{label}</label>
      <input
        type="number" step="any" placeholder={placeholder} value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
      />
    </div>
  );
}

function ActivePhaseDetail({
  phase, snapshot,
  onEndSubmit, endOutcome, setEndOutcome, endReason, setEndReason,
  endError, endingPhase, onUpdate,
}: {
  phase: GoalPhase;
  snapshot: CalorieTargetSnapshot | null;
  onEndSubmit: (e: React.FormEvent) => void;
  endOutcome: "completed" | "cancelled";
  setEndOutcome: (v: "completed" | "cancelled") => void;
  endReason: string;
  setEndReason: (v: string) => void;
  endError: string | null;
  endingPhase: boolean;
  onUpdate: () => void;
}) {
  const [showEnd, setShowEnd] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editFields, setEditFields] = useState({
    target_weight_kg: phase.target_weight_kg != null ? String(phase.target_weight_kg) : "",
    target_change_kg_per_week: phase.target_change_kg_per_week != null ? String(Math.abs(phase.target_change_kg_per_week)) : "",
    target_protein_g: phase.target_protein_g != null ? String(phase.target_protein_g) : "",
    target_carbs_g: phase.target_carbs_g != null ? String(phase.target_carbs_g) : "",
    target_fat_g: phase.target_fat_g != null ? String(phase.target_fat_g) : "",
    target_fibre_g: phase.target_fibre_g != null ? String(phase.target_fibre_g) : "",
  });
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSuccess, setEditSuccess] = useState(false);

  const editsUsed = phase.edit_count ?? 0;
  const editsRemaining = Math.max(0, 2 - editsUsed);

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEditError(null);
    setEditSuccess(false);

    const body: Record<string, number | null> = {};
    const tw   = editFields.target_weight_kg !== "" ? parseFloat(editFields.target_weight_kg) : null;
    const rate = editFields.target_change_kg_per_week !== "" ? parseFloat(editFields.target_change_kg_per_week) : null;
    const prot = editFields.target_protein_g !== "" ? parseFloat(editFields.target_protein_g) : null;
    const carb = editFields.target_carbs_g !== "" ? parseFloat(editFields.target_carbs_g) : null;
    const fat  = editFields.target_fat_g !== "" ? parseFloat(editFields.target_fat_g) : null;
    const fib  = editFields.target_fibre_g !== "" ? parseFloat(editFields.target_fibre_g) : null;

    if (tw !== null)   { if (isNaN(tw) || tw < 1 || tw > 500) { setEditError("Target weight must be 1–500 kg."); return; } body.target_weight_kg = tw; }
    if (rate !== null) {
      if (isNaN(rate) || rate < 0 || rate > 2.0) { setEditError("Rate must be 0–2.0 kg/wk."); return; }
      body.target_change_kg_per_week = phase.mode === "cut" ? -rate : rate;
    }
    if (prot !== null) { if (isNaN(prot) || prot < 0) { setEditError("Protein must be ≥ 0."); return; } body.target_protein_g = prot; }
    if (carb !== null) { if (isNaN(carb) || carb < 0) { setEditError("Carbs must be ≥ 0."); return; } body.target_carbs_g = carb; }
    if (fat  !== null) { if (isNaN(fat)  || fat  < 0) { setEditError("Fat must be ≥ 0."); return; }  body.target_fat_g = fat; }
    if (fib  !== null) { if (isNaN(fib)  || fib  < 0) { setEditError("Fibre must be ≥ 0."); return; } body.target_fibre_g = fib; }

    if (Object.keys(body).length === 0) { setEditError("No changes to save."); return; }

    setEditSubmitting(true);
    try {
      await callFunction("update-goal-phase", body);
      setEditSuccess(true);
      setShowEdit(false);
      onUpdate();
    } catch (err: any) {
      const code = err?.code ?? "";
      if (code === "EDIT_LIMIT_REACHED") {
        setEditError("Edit limit reached. Start a new phase to change targets.");
      } else {
        setEditError(err?.message ?? "Failed to update phase.");
      }
    } finally {
      setEditSubmitting(false);
    }
  }

  const startDate = new Date(phase.started_at).toLocaleDateString("en-ZA", {
    day: "numeric", month: "short", year: "numeric",
  });

  return (
    <div className="mt-3 rounded-lg border border-border bg-surface px-5 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            phase.mode === "cut"
              ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
              : phase.mode === "bulk"
              ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
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
          <p>
            <span className="text-muted">{phase.mode === "cut" ? "Loss/week: " : phase.mode === "bulk" ? "Gain/week: " : "Rate: "}</span>
            <span className="font-medium text-ink">{Math.abs(phase.target_change_kg_per_week)} kg/wk</span>
          </p>
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
        {phase.target_fibre_g != null && (
          <p><span className="text-muted">Fibre: </span><span className="font-medium text-ink">{phase.target_fibre_g}g</span></p>
        )}
        <p>
          <span className="text-muted">Start weight: </span>
          <span className="font-medium text-ink">{phase.starting_weight_kg} kg</span>
          <span className="ml-1 text-xs text-muted">({phase.starting_weight_source})</span>
        </p>
      </div>

      {/* ── How this was calculated (snapshot) ──────────────────────────── */}
      {snapshot && (
        <details className="mt-3 border-t border-border pt-3">
          <summary className="cursor-pointer text-xs text-primary hover:underline">
            How this target was calculated ▸
          </summary>
          <div className="mt-3 space-y-1 text-xs text-muted">
            <SnapshotRow label="Algorithm" value={`${snapshot.algorithm_name} (${snapshot.algorithm_version})`} />
            <SnapshotRow label="Calculated at" value={new Date(snapshot.calculation_timestamp).toLocaleString("en-ZA")} />
            <SnapshotRow label="Age at calculation" value={`${snapshot.age_years} years`} />
            <SnapshotRow label="Weight used" value={`${snapshot.official_weight_kg} kg`} />
            <SnapshotRow label="Height" value={`${snapshot.height_cm} cm`} />
            <SnapshotRow label="Sex" value={snapshot.equation_sex} />
            <SnapshotRow label="Activity level" value={ACTIVITY_LABELS[snapshot.activity_level] ?? snapshot.activity_level} />
            <SnapshotRow label="Activity multiplier" value={String(snapshot.activity_multiplier)} />
            <div className="border-t border-border mt-1 pt-1 space-y-1">
              <SnapshotRow label="Estimated BMR" value={`${snapshot.calculated_bmr_kcal} kcal/day`} />
              <SnapshotRow label="Estimated TDEE" value={`${snapshot.calculated_tdee_kcal} kcal/day`} />
              <SnapshotRow
                label={snapshot.maintenance_source === "manual_override" ? "Maintenance (manual)" : "Maintenance (equation)"}
                value={`${snapshot.effective_maintenance_kcal} kcal/day`}
              />
              {snapshot.daily_adjustment_kcal !== 0 && (
                <SnapshotRow
                  label={snapshot.daily_adjustment_kcal < 0 ? "Daily deficit" : "Daily surplus"}
                  value={`${snapshot.daily_adjustment_kcal} kcal/day`}
                />
              )}
              <SnapshotRow label="Final target" value={`${snapshot.final_target_kcal} kcal/day`} />
            </div>
            {snapshot.warning_codes.length > 0 && (
              <p className="mt-1 text-amber-600 dark:text-amber-400">
                Warnings at creation: {snapshot.warning_codes.join(", ")}
              </p>
            )}
          </div>
        </details>
      )}

      {/* ── Edit targets ──────────────────────────────────────────────────── */}
      <div className="mt-3 border-t border-border pt-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">
            Edits used: {editsUsed}/2{editsRemaining > 0 ? ` · ${editsRemaining} remaining` : " · no more edits"}
          </span>
          {editsRemaining > 0 && (
            <button
              type="button"
              onClick={() => { setShowEdit((v) => !v); setEditError(null); setEditSuccess(false); }}
              className="text-xs text-primary hover:underline"
            >
              {showEdit ? "Cancel" : "Edit targets"}
            </button>
          )}
        </div>
        {editSuccess && !showEdit && (
          <p className="mt-1 text-xs text-confidence-high">Targets updated.</p>
        )}
        {editsRemaining === 0 && (
          <p className="mt-1 text-xs text-muted">Start a new phase to change targets.</p>
        )}

        {showEdit && (
          <form onSubmit={handleEditSubmit} className="mt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[
                { key: "target_weight_kg", label: "Goal weight (kg)" },
                { key: "target_change_kg_per_week", label: phase.mode === "cut" ? "Loss/wk (kg)" : phase.mode === "bulk" ? "Gain/wk (kg)" : "Rate (kg/wk)" },
                { key: "target_protein_g", label: "Protein (g)" },
                { key: "target_carbs_g", label: "Carbs (g)" },
                { key: "target_fat_g", label: "Fat (g)" },
                { key: "target_fibre_g", label: "Fibre (g)" },
              ].map(({ key, label }) => (
                <div key={key}>
                  <label className="mb-0.5 block text-xs text-muted">{label}</label>
                  <input
                    type="number" min="0" step="any"
                    value={editFields[key as keyof typeof editFields]}
                    onChange={(e) => setEditFields((f) => ({ ...f, [key]: e.target.value }))}
                    className="w-full rounded border border-border bg-surface px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              ))}
            </div>
            {editError && <p className="text-xs text-confidence-low">{editError}</p>}
            <button
              type="submit"
              disabled={editSubmitting}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-50"
            >
              {editSubmitting ? "Saving…" : "Save changes"}
            </button>
          </form>
        )}
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

function SnapshotRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span className="text-ink">{value}</span>
    </div>
  );
}

function HistoryRow({ phase }: { phase: GoalPhase }) {
  const startDate = new Date(phase.started_at).toLocaleDateString("en-ZA", {
    day: "numeric", month: "short", year: "numeric",
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
