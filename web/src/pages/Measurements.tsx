import { useEffect, useMemo, useRef, useState } from "react";
import { AnthropometryTrends } from "../components/AnthropometryTrends";
import {
  ANTHROPOMETRY_PREPARATION,
  ANTHROPOMETRY_PROTOCOL_VERSION,
  ANTHROPOMETRY_SITES,
  deleteAnthropometrySession,
  finalizeAnthropometrySession,
  formatMeasurement,
  formatMeasurementInput,
  inputToCentimetres,
  needsThirdReading,
  saveAnthropometryDraft,
  siteDefinition,
  type AnthropometrySaveResponse,
  type AnthropometrySiteCode,
  type AnthropometrySitePayload,
  type MeasurementUnit,
} from "../lib/anthropometry";

type WorkflowPhase = "setup" | "measure" | "review" | "complete";
type Circuit = 1 | 2 | 3;
type ReadingState = Partial<Record<AnthropometrySiteCode, number[]>>;

const STANDARD_SITE_CODES = ANTHROPOMETRY_SITES
  .filter((site) => !site.optional)
  .map((site) => site.code);

function localDateTimeValue(date = new Date()): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export default function Measurements() {
  const [view, setView] = useState<"record" | "trends">("record");
  const [phase, setPhase] = useState<WorkflowPhase>("setup");
  const [selectedSites, setSelectedSites] = useState<AnthropometrySiteCode[]>(
    STANDARD_SITE_CODES,
  );
  const [unit, setUnit] = useState<MeasurementUnit>("cm");
  const [measuredAtLocal, setMeasuredAtLocal] = useState(localDateTimeValue);
  const [prepared, setPrepared] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [readings, setReadings] = useState<ReadingState>({});
  const [circuit, setCircuit] = useState<Circuit>(1);
  const [siteIndex, setSiteIndex] = useState(0);
  const [readingInput, setReadingInput] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const [completed, setCompleted] = useState<AnthropometrySaveResponse | null>(null);
  const readingInputRef = useRef<HTMLInputElement>(null);

  const resolutionSites = useMemo(
    () => selectedSites.filter((code) => needsThirdReading(readings[code] ?? [])),
    [readings, selectedSites],
  );
  const circuitSites = circuit === 3 ? resolutionSites : selectedSites;
  const currentSiteCode = circuitSites[siteIndex] ?? circuitSites[0];
  const currentSite = currentSiteCode ? siteDefinition(currentSiteCode) : null;
  const readingNumber = circuit;

  function handleViewTabKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextView = event.key === "ArrowLeft" || event.key === "Home" ? "record" : "trends";
    setView(nextView);
    requestAnimationFrame(() => document.getElementById(`measurements-tab-${nextView}`)?.focus());
  }

  useEffect(() => {
    if (phase !== "measure" || !currentSiteCode) return;
    const existing = readings[currentSiteCode]?.[readingNumber - 1];
    setReadingInput(existing == null ? "" : formatMeasurementInput(existing, unit));
    setError(null);
    requestAnimationFrame(() => readingInputRef.current?.focus());
  }, [phase, circuit, siteIndex, currentSiteCode, readingNumber]);

  function measuredAtIso(): string | null {
    const date = new Date(measuredAtLocal);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  }

  function payloadFor(nextReadings: ReadingState): AnthropometrySitePayload[] {
    return selectedSites.map((siteCode) => ({
      site_code: siteCode,
      readings_cm: nextReadings[siteCode] ?? [],
    }));
  }

  function toggleSite(code: AnthropometrySiteCode) {
    setSelectedSites((current) =>
      current.includes(code)
        ? current.filter((siteCode) => siteCode !== code)
        : ANTHROPOMETRY_SITES.map((site) => site.code).filter(
          (siteCode) => siteCode === code || current.includes(siteCode),
        )
    );
  }

  function changeUnit(nextUnit: MeasurementUnit) {
    if (nextUnit === unit) return;
    if (phase === "measure" && readingInput) {
      const parsed = inputToCentimetres(readingInput, unit);
      setReadingInput(
        parsed.valueCm == null ? "" : formatMeasurementInput(parsed.valueCm, nextUnit),
      );
    }
    setUnit(nextUnit);
  }

  async function beginSession() {
    if (busy) return;
    setError(null);
    if (selectedSites.length === 0) {
      setError("Select at least one measurement site.");
      return;
    }
    if (!prepared) {
      setError("Confirm that you have reviewed the preparation steps.");
      return;
    }
    const measuredAt = measuredAtIso();
    if (!measuredAt) {
      setError("Choose a valid measurement date and time.");
      return;
    }
    if (new Date(measuredAt).getTime() > Date.now() + 5 * 60_000) {
      setError("Measurement time cannot be more than five minutes in the future.");
      return;
    }

    setBusy(true);
    try {
      const result = await saveAnthropometryDraft({
        measured_at: measuredAt,
        sites: payloadFor({}),
      });
      setSessionId(result.session.id);
      setReadings({});
      setCircuit(1);
      setSiteIndex(0);
      setStatusMessage("Draft started. First reading circuit.");
      setPhase("measure");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the session.");
    } finally {
      setBusy(false);
    }
  }

  async function persistDraft(nextReadings: ReadingState) {
    const measuredAt = measuredAtIso();
    if (!measuredAt) throw new Error("Measurement date and time is invalid.");
    const result = await saveAnthropometryDraft({
      session_id: sessionId ?? undefined,
      measured_at: measuredAt,
      sites: payloadFor(nextReadings),
    });
    if (!sessionId) setSessionId(result.session.id);
  }

  async function submitReading(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !currentSiteCode) return;
    setError(null);
    const parsed = inputToCentimetres(readingInput, unit);
    if (parsed.error || parsed.valueCm == null) {
      setError(parsed.error ?? "Enter a valid measurement.");
      return;
    }

    const nextSiteReadings = [...(readings[currentSiteCode] ?? [])];
    nextSiteReadings[readingNumber - 1] = parsed.valueCm;
    let nextReadings: ReadingState = {
      ...readings,
      [currentSiteCode]: nextSiteReadings,
    };

    const endsSecondCircuit = circuit === 2 && siteIndex === selectedSites.length - 1;
    let nextResolutionSites = resolutionSites;
    if (endsSecondCircuit) {
      nextResolutionSites = selectedSites.filter((code) =>
        needsThirdReading(nextReadings[code] ?? [])
      );
      const resolutionSet = new Set(nextResolutionSites);
      nextReadings = Object.fromEntries(
        selectedSites.map((code) => [
          code,
          (nextReadings[code] ?? []).slice(0, resolutionSet.has(code) ? 3 : 2),
        ]),
      ) as ReadingState;
    }

    setBusy(true);
    try {
      await persistDraft(nextReadings);
      setReadings(nextReadings);
      setReadingInput("");

      if (siteIndex < circuitSites.length - 1) {
        setSiteIndex((index) => index + 1);
        setStatusMessage(`Reading ${readingNumber} saved.`);
      } else if (circuit === 1) {
        setCircuit(2);
        setSiteIndex(0);
        setStatusMessage("First circuit saved. Begin the second reading circuit.");
      } else if (circuit === 2 && nextResolutionSites.length > 0) {
        setCircuit(3);
        setSiteIndex(0);
        setStatusMessage(
          `${nextResolutionSites.length} ${nextResolutionSites.length === 1 ? "site needs" : "sites need"} one resolution reading.`,
        );
      } else {
        setStatusMessage("All required readings are saved. Review your session.");
        setPhase("review");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this reading.");
    } finally {
      setBusy(false);
    }
  }

  function goBack() {
    setError(null);
    if (siteIndex > 0) {
      setSiteIndex((index) => index - 1);
      return;
    }
    if (circuit === 2) {
      setCircuit(1);
      setSiteIndex(selectedSites.length - 1);
    } else if (circuit === 3) {
      setCircuit(2);
      setSiteIndex(selectedSites.length - 1);
    }
  }

  function backFromReview() {
    if (resolutionSites.length > 0) {
      setCircuit(3);
      setSiteIndex(resolutionSites.length - 1);
    } else {
      setCircuit(2);
      setSiteIndex(selectedSites.length - 1);
    }
    setPhase("measure");
  }

  async function finishSession() {
    if (busy) return;
    setError(null);
    const measuredAt = measuredAtIso();
    if (!measuredAt || !sessionId) {
      setError("This draft is incomplete. Return to the measurement steps and try again.");
      return;
    }
    setBusy(true);
    try {
      const result = await finalizeAnthropometrySession({
        session_id: sessionId,
        measured_at: measuredAt,
        notes: notes.trim() || undefined,
        idempotency_key: idempotencyKey,
        sites: payloadFor(readings),
      });
      setCompleted(result);
      setStatusMessage("Measurement session finalized.");
      setPhase("complete");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not finalize the session.");
    } finally {
      setBusy(false);
    }
  }

  function resetLocalSession() {
    setPhase("setup");
    setSessionId(null);
    setReadings({});
    setCircuit(1);
    setSiteIndex(0);
    setReadingInput("");
    setNotes("");
    setPrepared(false);
    setError(null);
    setStatusMessage("");
    setDiscardConfirm(false);
    setCompleted(null);
    setMeasuredAtLocal(localDateTimeValue());
    setIdempotencyKey(newIdempotencyKey());
  }

  async function discardDraft() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (sessionId) await deleteAnthropometrySession(sessionId);
      resetLocalSession();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not discard the draft.");
      setDiscardConfirm(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Tape measurements</p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-ink">Guided measurement session</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            Record repeatable circumference measurements as a separate progress signal. Nutri does not use these readings to estimate body fat or muscle mass.
          </p>
        </div>
        <UnitToggle unit={unit} onChange={changeUnit} />
      </div>

      <p className="sr-only" aria-live="polite" aria-atomic="true">{statusMessage}</p>

      <div className="mt-6 inline-flex w-full rounded-lg border border-border bg-surface p-1 sm:w-auto" role="tablist" aria-label="Measurement sections" onKeyDown={handleViewTabKeyDown}>
        <button
          type="button"
          id="measurements-tab-record"
          role="tab"
          aria-selected={view === "record"}
          tabIndex={view === "record" ? 0 : -1}
          aria-controls="measurements-panel-record"
          onClick={() => setView("record")}
          className={`min-h-11 flex-1 rounded-md px-4 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:flex-none ${view === "record" ? "bg-primary text-white" : "text-muted hover:text-ink"}`}
        >
          Record measurements
        </button>
        <button
          type="button"
          id="measurements-tab-trends"
          role="tab"
          aria-selected={view === "trends"}
          tabIndex={view === "trends" ? 0 : -1}
          aria-controls="measurements-panel-trends"
          onClick={() => setView("trends")}
          className={`min-h-11 flex-1 rounded-md px-4 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:flex-none ${view === "trends" ? "bg-primary text-white" : "text-muted hover:text-ink"}`}
        >
          History &amp; trends
        </button>
      </div>

      <div id="measurements-panel-trends" role="tabpanel" aria-labelledby="measurements-tab-trends" className={view === "trends" ? "" : "hidden"}>
        {view === "trends" && <AnthropometryTrends unit={unit} />}
      </div>

      <div id="measurements-panel-record" role="tabpanel" aria-labelledby="measurements-tab-record" className={view === "record" ? "" : "hidden"}>

      {phase === "setup" && (
        <SetupPanel
          selectedSites={selectedSites}
          measuredAtLocal={measuredAtLocal}
          prepared={prepared}
          busy={busy}
          error={error}
          onMeasuredAtChange={setMeasuredAtLocal}
          onPreparedChange={setPrepared}
          onToggleSite={toggleSite}
          onSelectStandard={() => setSelectedSites(STANDARD_SITE_CODES)}
          onClear={() => setSelectedSites([])}
          onBegin={() => void beginSession()}
        />
      )}

      {phase === "measure" && currentSite && (
        <MeasurementPanel
          site={currentSite}
          circuit={circuit}
          siteIndex={siteIndex}
          circuitCount={circuitSites.length}
          unit={unit}
          readingInput={readingInput}
          busy={busy}
          error={error}
          canGoBack={circuit !== 1 || siteIndex > 0}
          inputRef={readingInputRef}
          onInputChange={setReadingInput}
          onSubmit={(event) => void submitReading(event)}
          onBack={goBack}
          onDiscard={() => setDiscardConfirm(true)}
        />
      )}

      {phase === "review" && (
        <ReviewPanel
          selectedSites={selectedSites}
          readings={readings}
          unit={unit}
          measuredAtLocal={measuredAtLocal}
          notes={notes}
          busy={busy}
          error={error}
          onNotesChange={setNotes}
          onBack={backFromReview}
          onFinish={() => void finishSession()}
          onDiscard={() => setDiscardConfirm(true)}
        />
      )}

      {phase === "complete" && completed && (
        <CompletedPanel result={completed} unit={unit} onNewSession={resetLocalSession} onOpenTrends={() => setView("trends")} />
      )}

      {discardConfirm && phase !== "complete" && (
        <DiscardConfirmation
          busy={busy}
          onCancel={() => setDiscardConfirm(false)}
          onConfirm={() => void discardDraft()}
        />
      )}
      </div>
    </main>
  );
}

function UnitToggle({ unit, onChange }: { unit: MeasurementUnit; onChange: (unit: MeasurementUnit) => void }) {
  return (
    <fieldset className="shrink-0">
      <legend className="sr-only">Measurement display unit</legend>
      <div className="inline-flex rounded-lg border border-border bg-surface p-1" aria-label="Measurement display unit">
        {(["cm", "in"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            aria-pressed={unit === option}
            className={`min-h-11 min-w-14 rounded-md px-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              unit === option ? "bg-primary text-white" : "text-muted hover:text-ink"
            }`}
          >
            {option === "cm" ? "cm" : "inches"}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

interface SetupPanelProps {
  selectedSites: AnthropometrySiteCode[];
  measuredAtLocal: string;
  prepared: boolean;
  busy: boolean;
  error: string | null;
  onMeasuredAtChange: (value: string) => void;
  onPreparedChange: (value: boolean) => void;
  onToggleSite: (code: AnthropometrySiteCode) => void;
  onSelectStandard: () => void;
  onClear: () => void;
  onBegin: () => void;
}

function SetupPanel(props: SetupPanelProps) {
  return (
    <div className="mt-6 space-y-5">
      <section className="rounded-xl border border-border bg-surface p-4 sm:p-5" aria-labelledby="prepare-heading">
        <h2 id="prepare-heading" className="font-display text-lg font-semibold text-ink">Prepare for a repeatable session</h2>
        <ol className="mt-3 space-y-2 text-sm leading-6 text-muted">
          {ANTHROPOMETRY_PREPARATION.map((step, index) => (
            <li key={step} className="flex gap-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary-light text-xs font-semibold text-primary" aria-hidden="true">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-xl border border-border bg-surface p-4 sm:p-5" aria-labelledby="sites-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="sites-heading" className="font-display text-lg font-semibold text-ink">Choose measurement sites</h2>
            <p className="mt-1 text-sm text-muted">Skip any site you do not want to measure. Missing sites are never recorded as zero.</p>
          </div>
          <div className="flex gap-1">
            <button type="button" onClick={props.onSelectStandard} className="min-h-11 rounded-lg px-3 text-sm font-medium text-primary hover:bg-primary-light focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">Standard sites</button>
            <button type="button" onClick={props.onClear} className="min-h-11 rounded-lg px-3 text-sm font-medium text-muted hover:bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">Clear</button>
          </div>
        </div>

        <fieldset className="mt-4 grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">Sites to include in this session</legend>
          {ANTHROPOMETRY_SITES.map((site) => (
            <label key={site.code} className="flex min-h-16 cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:border-primary focus-within:ring-2 focus-within:ring-primary">
              <input
                type="checkbox"
                checked={props.selectedSites.includes(site.code)}
                onChange={() => props.onToggleSite(site.code)}
                className="mt-1 h-5 w-5 shrink-0 accent-primary"
              />
              <span>
                <span className="block text-sm font-medium text-ink">
                  {site.label}{site.optional && <span className="ml-1 font-normal text-muted">(optional)</span>}
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-muted">{site.shortCue}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="mt-4 rounded-lg border border-primary/30 bg-primary-light p-3 text-sm leading-6 text-ink">
          <strong>Waist and abdomen at navel are different sites.</strong> Waist uses the WHO rib-to-iliac-crest midpoint. The navel measurement is for personal progress and is not treated as a clinical waist measurement.
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface p-4 sm:p-5" aria-labelledby="time-heading">
        <h2 id="time-heading" className="font-display text-lg font-semibold text-ink">Session details</h2>
        <label className="mt-3 block max-w-sm text-sm font-medium text-ink" htmlFor="anthropometry-measured-at">
          Measurement date and time
        </label>
        <input
          id="anthropometry-measured-at"
          type="datetime-local"
          value={props.measuredAtLocal}
          onChange={(event) => props.onMeasuredAtChange(event.target.value)}
          className="mt-1 min-h-11 w-full max-w-sm rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
        />
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 focus-within:ring-2 focus-within:ring-primary">
          <input
            type="checkbox"
            checked={props.prepared}
            onChange={(event) => props.onPreparedChange(event.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
          />
          <span className="text-sm leading-6 text-ink">I reviewed the preparation steps and will use the named landmarks.</span>
        </label>
      </section>

      {props.error && <ErrorMessage message={props.error} />}

      <button
        type="button"
        disabled={props.busy}
        onClick={props.onBegin}
        className="min-h-12 w-full rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50 sm:w-auto"
      >
        {props.busy ? "Starting…" : `Begin with ${props.selectedSites.length} ${props.selectedSites.length === 1 ? "site" : "sites"}`}
      </button>
    </div>
  );
}

interface MeasurementPanelProps {
  site: (typeof ANTHROPOMETRY_SITES)[number];
  circuit: Circuit;
  siteIndex: number;
  circuitCount: number;
  unit: MeasurementUnit;
  readingInput: string;
  busy: boolean;
  error: string | null;
  canGoBack: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  onInputChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  onBack: () => void;
  onDiscard: () => void;
}

function MeasurementPanel(props: MeasurementPanelProps) {
  const parsed = inputToCentimetres(props.readingInput, props.unit);
  const preview = parsed.valueCm == null
    ? null
    : props.unit === "cm"
    ? `About ${formatMeasurement(parsed.valueCm, "in")} for display`
    : `Stored as ${formatMeasurement(parsed.valueCm, "cm")}`;
  const circuitLabel = props.circuit === 1
    ? "First circuit"
    : props.circuit === 2
    ? "Second circuit"
    : "Resolution circuit";

  return (
    <div className="mt-6">
      <div className="rounded-xl border border-border bg-surface p-4 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">{circuitLabel}</p>
            <h2 className="mt-1 font-display text-2xl font-semibold text-ink">{props.site.label}</h2>
          </div>
          <span className="shrink-0 rounded-full bg-background px-3 py-1 text-xs font-medium text-muted">
            {props.siteIndex + 1} of {props.circuitCount}
          </span>
        </div>

        <div
          className="mt-3 h-2 overflow-hidden rounded-full bg-border/60"
          role="progressbar"
          aria-label={`${circuitLabel} progress`}
          aria-valuemin={0}
          aria-valuemax={props.circuitCount}
          aria-valuenow={props.siteIndex + 1}
        >
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${((props.siteIndex + 1) / props.circuitCount) * 100}%` }} />
        </div>

        {props.circuit === 3 && (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100" role="status">
            The first two readings were more than 1.0 cm apart. Tape position, posture, breathing and normal measurement variation can contribute. Take one more reading at the same landmark; Nutri will use the median of all three.
          </div>
        )}

        <div id="measurement-instructions" className="mt-5 space-y-3 text-sm leading-6">
          <div>
            <p className="font-semibold text-ink">Landmark and position</p>
            <p className="mt-1 text-muted">{props.site.landmark}</p>
          </div>
          <div>
            <p className="font-semibold text-ink">Breathing and relaxation</p>
            <p className="mt-1 text-muted">{props.site.breathing}</p>
          </div>
          <p className="rounded-lg bg-background p-3 text-muted">Keep the tape flat, horizontal where instructed, snug and free of tissue compression.</p>
        </div>

        <form className="mt-6" onSubmit={props.onSubmit} noValidate>
          <label htmlFor="circumference-reading" className="block text-sm font-semibold text-ink">
            Reading {props.circuit} in {props.unit === "cm" ? "centimetres" : "inches"}
          </label>
          <div className="relative mt-2 max-w-sm">
            <input
              ref={props.inputRef}
              id="circumference-reading"
              type="number"
              inputMode="decimal"
              step={props.unit === "cm" ? "0.1" : "0.01"}
              min={props.unit === "cm" ? "5" : "2"}
              max={props.unit === "cm" ? "300" : "118.1"}
              value={props.readingInput}
              onChange={(event) => props.onInputChange(event.target.value)}
              aria-describedby={`measurement-instructions measurement-unit-note${props.error ? " measurement-error" : ""}`}
              aria-errormessage={props.error ? "measurement-error" : undefined}
              aria-invalid={Boolean(props.error)}
              autoComplete="off"
              className="min-h-14 w-full rounded-lg border border-border bg-background px-4 py-3 pr-16 text-lg font-semibold outline-none focus:ring-2 focus:ring-primary"
            />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted" aria-hidden="true">{props.unit}</span>
          </div>
          <p id="measurement-unit-note" className="mt-2 text-xs leading-5 text-muted">
            {preview ?? (props.unit === "cm" ? "Record to one decimal place." : "Inch entries convert to the nearest 0.1 cm for storage.")}
          </p>

          {props.error && <div id="measurement-error" className="mt-3"><ErrorMessage message={props.error} /></div>}

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
            <button type="button" onClick={props.onBack} disabled={!props.canGoBack || props.busy} className="min-h-12 rounded-lg border border-border px-4 py-3 text-sm font-medium text-ink hover:bg-background disabled:opacity-40">Back</button>
            <button type="submit" disabled={props.busy || !props.readingInput} className="min-h-12 flex-1 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50 sm:flex-none">
              {props.busy ? "Saving…" : "Save reading and continue"}
            </button>
            <button type="button" onClick={props.onDiscard} disabled={props.busy} className="min-h-12 rounded-lg px-4 py-3 text-sm font-medium text-muted hover:text-ink disabled:opacity-50 sm:ml-auto">Discard draft</button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface ReviewPanelProps {
  selectedSites: AnthropometrySiteCode[];
  readings: ReadingState;
  unit: MeasurementUnit;
  measuredAtLocal: string;
  notes: string;
  busy: boolean;
  error: string | null;
  onNotesChange: (value: string) => void;
  onBack: () => void;
  onFinish: () => void;
  onDiscard: () => void;
}

function ReviewPanel(props: ReviewPanelProps) {
  return (
    <div className="mt-6 space-y-4">
      <section className="rounded-xl border border-border bg-surface p-4 sm:p-6" aria-labelledby="review-heading">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Review</p>
        <h2 id="review-heading" className="mt-1 font-display text-2xl font-semibold text-ink">Check your raw readings</h2>
        <p className="mt-2 text-sm leading-6 text-muted">Nutri preserves these readings and calculates the representative values on the server when you finalize.</p>

        <dl className="mt-5 divide-y divide-border rounded-lg border border-border">
          {props.selectedSites.map((code) => {
            const siteReadings = props.readings[code] ?? [];
            const needsThird = needsThirdReading(siteReadings);
            return (
              <div key={code} className="p-3 sm:flex sm:items-center sm:justify-between sm:gap-4">
                <dt className="text-sm font-medium text-ink">{siteDefinition(code).label}</dt>
                <dd className="mt-1 text-sm text-muted sm:mt-0 sm:text-right">
                  <span>{siteReadings.map((value) => formatMeasurement(value, props.unit)).join(" · ")}</span>
                  {needsThird && <span className="mt-1 block text-xs text-amber-700 dark:text-amber-300">Third reading used because the first pair differed by more than 1.0 cm.</span>}
                </dd>
              </div>
            );
          })}
        </dl>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm font-medium text-ink">Measured</p>
            <p className="mt-1 text-sm text-muted">{new Date(props.measuredAtLocal).toLocaleString()}</p>
          </div>
          <label className="block text-sm font-medium text-ink">
            Notes <span className="font-normal text-muted">(optional)</span>
            <textarea
              value={props.notes}
              onChange={(event) => props.onNotesChange(event.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Conditions that differed from usual"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
            <span className="mt-1 block text-right text-xs font-normal text-muted">{props.notes.length}/500</span>
          </label>
        </div>

        <div className="mt-5 rounded-lg bg-background p-3 text-sm leading-6 text-muted">
          Circumference readings can vary with tape position, posture, breathing, digestion, fluid and other conditions. They do not directly measure body fat, muscle mass or body recomposition.
        </div>
      </section>

      {props.error && <ErrorMessage message={props.error} />}

      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" onClick={props.onBack} disabled={props.busy} className="min-h-12 rounded-lg border border-border px-4 py-3 text-sm font-medium text-ink hover:bg-surface disabled:opacity-50">Back to readings</button>
        <button type="button" onClick={props.onFinish} disabled={props.busy} className="min-h-12 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50">
          {props.busy ? "Finalizing…" : "Finalize session"}
        </button>
        <button type="button" onClick={props.onDiscard} disabled={props.busy} className="min-h-12 rounded-lg px-4 py-3 text-sm font-medium text-muted hover:text-ink disabled:opacity-50 sm:ml-auto">Discard draft</button>
      </div>
    </div>
  );
}

function CompletedPanel({ result, unit, onNewSession, onOpenTrends }: { result: AnthropometrySaveResponse; unit: MeasurementUnit; onNewSession: () => void; onOpenTrends: () => void }) {
  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-4 sm:p-6" aria-labelledby="complete-heading" aria-live="polite">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300" aria-hidden="true">✓</div>
      <h2 id="complete-heading" className="mt-3 font-display text-2xl font-semibold text-ink">Session finalized</h2>
      <p className="mt-2 text-sm leading-6 text-muted">Raw readings are preserved. This finalized session cannot be edited or reopened.</p>

      <dl className="mt-5 grid gap-3 sm:grid-cols-2">
        {result.sites.map((site) => (
          <div key={site.site_code} className="rounded-lg border border-border p-4">
            <dt className="text-sm font-medium text-muted">{siteDefinition(site.site_code).label}</dt>
            <dd className="mt-1 font-display text-2xl font-semibold text-ink">
              {site.representative_cm == null ? "—" : formatMeasurement(site.representative_cm, unit)}
            </dd>
            <p className="mt-1 text-xs text-muted">Representative from {site.reading_count} preserved readings</p>
            {site.quality === "repeatability_warning" && (
              <p className="mt-3 rounded-md bg-amber-50 p-2 text-xs leading-5 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                The first readings differed. The value is kept, with a quality note because measurement technique or normal variation may have contributed.
              </p>
            )}
          </div>
        ))}
      </dl>

      <p className="mt-5 text-xs text-muted">Protocol: {ANTHROPOMETRY_PROTOCOL_VERSION}</p>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <button type="button" onClick={onOpenTrends} className="min-h-12 w-full rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-white hover:bg-primary-dark sm:w-auto">View history &amp; trends</button>
        <button type="button" onClick={onNewSession} className="min-h-12 w-full rounded-lg border border-border px-5 py-3 text-sm font-semibold text-ink hover:bg-background sm:w-auto">Start another session</button>
      </div>
    </section>
  );
}

function DiscardConfirmation({ busy, onCancel, onConfirm }: { busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef(
    typeof document === "undefined" ? null : document.activeElement as HTMLElement | null,
  );

  useEffect(() => () => returnFocusRef.current?.focus(), []);

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape" && !busy) {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
    if (!buttons?.length) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/40 p-4 sm:place-items-center" role="presentation">
      <section ref={dialogRef} onKeyDown={handleKeyDown} className="w-full max-w-md rounded-xl bg-surface p-5 shadow-xl" role="alertdialog" aria-modal="true" aria-labelledby="discard-title" aria-describedby="discard-description">
        <h2 id="discard-title" className="font-display text-lg font-semibold text-ink">Discard this draft?</h2>
        <p id="discard-description" className="mt-2 text-sm leading-6 text-muted">The draft and its saved raw readings will be deleted. This cannot be undone.</p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={busy} autoFocus className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink">Keep draft</button>
          <button type="button" onClick={onConfirm} disabled={busy} className="min-h-11 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">{busy ? "Discarding…" : "Discard draft"}</button>
        </div>
      </section>
    </div>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">{message}</p>;
}
