import { useEffect, useRef, useState } from "react";
import { AnthropometryTrends } from "../components/AnthropometryTrends";
import {
  ANTHROPOMETRY_PREPARATION,
  ANTHROPOMETRY_PROTOCOL_VERSION,
  ANTHROPOMETRY_SITES,
  deleteAnthropometrySession,
  finalizeAnthropometrySession,
  formatMeasurement,
  formatMeasurementInput,
  getAnthropometryDrafts,
  inputToCentimetres,
  needsThirdReading,
  saveAnthropometryDraft,
  siteDefinition,
  type AnthropometryHistorySession,
  type AnthropometrySaveResponse,
  type AnthropometryRepresentativePreview,
  type AnthropometryMeasurementContextInput,
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

function draftDateTimeValue(iso: string | null): string {
  return iso ? localDateTimeValue(new Date(iso)) : localDateTimeValue();
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
  const [resolutionSites, setResolutionSites] = useState<AnthropometrySiteCode[]>([]);
  const [retakeSite, setRetakeSite] = useState<AnthropometrySiteCode | null>(null);
  const [retakeResumeIndex, setRetakeResumeIndex] = useState<number | null>(null);
  const [qualityDecision, setQualityDecision] = useState<AnthropometryRepresentativePreview | null>(null);
  const [qualityConfirmed, setQualityConfirmed] = useState(false);
  const [acknowledgedSites, setAcknowledgedSites] = useState<AnthropometrySiteCode[]>([]);
  const [readingInput, setReadingInput] = useState("");
  const [notes, setNotes] = useState("");
  const [measurementContext, setMeasurementContext] = useState<AnthropometryMeasurementContextInput>({
    meal_timing: "not_recorded",
    after_bathroom: null,
    exercise_within_previous_12_hours: null,
    measurement_assistance: "not_recorded",
    clothing_level: "not_recorded",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const [completed, setCompleted] = useState<AnthropometrySaveResponse | null>(null);
  const [availableDrafts, setAvailableDrafts] = useState<AnthropometryHistorySession[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(true);
  const [draftLoadError, setDraftLoadError] = useState<string | null>(null);
  const [recoveryDiscardId, setRecoveryDiscardId] = useState<string | null>(null);
  const readingInputRef = useRef<HTMLInputElement>(null);

  const circuitSites = retakeSite
    ? [retakeSite]
    : circuit === 3
    ? resolutionSites
    : selectedSites;
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

  async function loadDrafts() {
    setDraftsLoading(true);
    setDraftLoadError(null);
    try {
      setAvailableDrafts(await getAnthropometryDrafts());
    } catch (cause) {
      setDraftLoadError(cause instanceof Error ? cause.message : "Could not check for saved drafts.");
    } finally {
      setDraftsLoading(false);
    }
  }

  useEffect(() => {
    void loadDrafts();
  }, []);

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
    if (draftsLoading || draftLoadError || availableDrafts.length > 0) {
      setError("Resolve the saved draft before starting another session.");
      return;
    }
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
        measurement_context: measurementContext,
        sites: payloadFor({}),
      });
      setSessionId(result.session.id);
      setReadings({});
      setCircuit(1);
      setSiteIndex(0);
      setResolutionSites([]);
      setRetakeSite(null);
      setRetakeResumeIndex(null);
      setQualityDecision(null);
      setQualityConfirmed(false);
      setAcknowledgedSites([]);
      setStatusMessage("Draft started. First reading circuit.");
      setPhase("measure");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the session.");
    } finally {
      setBusy(false);
    }
  }

  async function resumeDraft(draft: AnthropometryHistorySession) {
    if (busy || draft.status !== "draft") return;
    setBusy(true);
    setError(null);
    try {
      const nextReadings = Object.fromEntries(
        ANTHROPOMETRY_SITES.map((site) => [
          site.code,
          draft.readings
            .filter((reading) => reading.site_code === site.code)
            .sort((left, right) => left.reading_number - right.reading_number)
            .map((reading) => reading.value_cm),
        ]).filter(([, values]) => (values as number[]).length > 0),
      ) as ReadingState;
      const restoredSites = ANTHROPOMETRY_SITES.map((site) => site.code)
        .filter((code) => (nextReadings[code]?.length ?? 0) > 0);
      const nextSelectedSites = restoredSites.length > 0 ? restoredSites : STANDARD_SITE_CODES;
      const nextContext: AnthropometryMeasurementContextInput = {
        meal_timing: draft.measurement_context?.meal_timing ?? "not_recorded",
        after_bathroom: draft.measurement_context?.after_bathroom ?? null,
        exercise_within_previous_12_hours:
          draft.measurement_context?.exercise_within_previous_12_hours ?? null,
        measurement_assistance:
          draft.measurement_context?.measurement_assistance ?? "not_recorded",
        clothing_level: draft.measurement_context?.clothing_level ?? "not_recorded",
      };
      const refreshed = await saveAnthropometryDraft({
        session_id: draft.id,
        measured_at: draft.measured_at ?? undefined,
        notes: draft.notes ?? undefined,
        measurement_context: nextContext,
        sites: nextSelectedSites.map((siteCode) => ({
          site_code: siteCode,
          readings_cm: nextReadings[siteCode] ?? [],
        })),
      });

      setSessionId(draft.id);
      setSelectedSites(nextSelectedSites);
      setReadings(nextReadings);
      setMeasuredAtLocal(draftDateTimeValue(draft.measured_at));
      setNotes(draft.notes ?? "");
      setMeasurementContext(nextContext);
      setPrepared(true);
      setIdempotencyKey(newIdempotencyKey());
      setAcknowledgedSites([]);
      setQualityConfirmed(false);
      setRetakeSite(null);
      setAvailableDrafts((current) => current.filter((entry) => entry.id !== draft.id));

      const firstMissing = nextSelectedSites.findIndex((code) =>
        (nextReadings[code]?.length ?? 0) < 1
      );
      if (firstMissing >= 0) {
        setCircuit(1);
        setSiteIndex(firstMissing);
        setResolutionSites([]);
        setQualityDecision(null);
        setPhase("measure");
        setStatusMessage("Saved draft resumed. Continue the first reading circuit.");
        return;
      }
      const secondMissing = nextSelectedSites.findIndex((code) =>
        (nextReadings[code]?.length ?? 0) < 2
      );
      if (secondMissing >= 0) {
        setCircuit(2);
        setSiteIndex(secondMissing);
        setResolutionSites([]);
        setQualityDecision(null);
        setPhase("measure");
        setStatusMessage("Saved draft resumed. Continue the second reading circuit.");
        return;
      }

      const nextResolutionSites = nextSelectedSites.filter((code) =>
        needsThirdReading(nextReadings[code] ?? [])
      );
      const resolutionIndex = nextResolutionSites.findIndex((code) =>
        (nextReadings[code]?.length ?? 0) < 3
      );
      setResolutionSites(nextResolutionSites);
      if (resolutionIndex >= 0) {
        setCircuit(3);
        setSiteIndex(resolutionIndex);
        setQualityDecision(null);
        setPhase("measure");
        setStatusMessage("Saved draft resumed. Continue the resolution circuit.");
        return;
      }

      const pendingDecision = refreshed.previews?.find((preview) =>
        preview.quality === "pair_agree_with_isolated_reading" ||
        preview.quality === "high_variability"
      );
      if (pendingDecision) {
        const pendingIndex = Math.max(0, nextResolutionSites.indexOf(pendingDecision.site_code));
        setCircuit(3);
        setSiteIndex(pendingIndex);
        setRetakeResumeIndex(pendingIndex);
        setQualityDecision(pendingDecision);
        setPhase("measure");
        setStatusMessage("Saved draft resumed. Review the measurement confidence decision again.");
        return;
      }

      setQualityDecision(null);
      setPhase("review");
      setStatusMessage("Saved draft resumed. Review the preserved raw readings.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not resume the saved draft.");
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
      measurement_context: measurementContext,
      sites: payloadFor(nextReadings),
    });
    if (!sessionId) setSessionId(result.session.id);
    return result;
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

    let nextSiteReadings = [...(readings[currentSiteCode] ?? [])];
    nextSiteReadings[readingNumber - 1] = parsed.valueCm;
    let nextReadings: ReadingState = {
      ...readings,
      [currentSiteCode]: nextSiteReadings,
    };

    if (
      retakeSite && circuit === 2 &&
      !needsThirdReading(nextSiteReadings)
    ) {
      nextSiteReadings = nextSiteReadings.slice(0, 2);
      nextReadings = { ...nextReadings, [currentSiteCode]: nextSiteReadings };
    }

    const endsSecondCircuit = !retakeSite && circuit === 2 &&
      siteIndex === selectedSites.length - 1;
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
      const draftResult = await persistDraft(nextReadings);
      setReadings(nextReadings);
      setReadingInput("");

      const preview = circuit === 3
        ? draftResult.previews?.find((entry) => entry.site_code === currentSiteCode)
        : undefined;
      if (preview && (
        preview.quality === "pair_agree_with_isolated_reading" ||
        preview.quality === "high_variability"
      )) {
        if (!retakeSite) setRetakeResumeIndex(siteIndex);
        setQualityDecision(preview);
        setQualityConfirmed(false);
        setStatusMessage(
          preview.quality === "high_variability"
            ? `${siteDefinition(currentSiteCode).label} has low measurement confidence. Choose whether to retake or explicitly save it.`
            : `${siteDefinition(currentSiteCode).label} has one isolated reading. Choose whether to retake or continue with the agreeing pair.`,
        );
        return;
      }

      if (retakeSite) {
        if (circuit === 1) {
          setCircuit(2);
          setStatusMessage("First retake reading saved. Take the second reading.");
        } else if (circuit === 2 && needsThirdReading(nextSiteReadings)) {
          setCircuit(3);
          setStatusMessage("The retake needs one resolution reading.");
        } else {
          setRetakeSite(null);
          setRetakeResumeIndex(null);
          if (
            retakeResumeIndex != null &&
            retakeResumeIndex < resolutionSites.length - 1
          ) {
            setCircuit(3);
            setSiteIndex(retakeResumeIndex + 1);
            setStatusMessage("Retake saved. Continue the resolution circuit.");
          } else {
            setStatusMessage("All required readings are saved. Review your session.");
            setPhase("review");
          }
        }
        return;
      }

      if (siteIndex < circuitSites.length - 1) {
        setSiteIndex((index) => index + 1);
        setStatusMessage(`Reading ${readingNumber} saved.`);
      } else if (circuit === 1) {
        setCircuit(2);
        setSiteIndex(0);
        setStatusMessage("First circuit saved. Begin the second reading circuit.");
      } else if (circuit === 2 && nextResolutionSites.length > 0) {
        setResolutionSites(nextResolutionSites);
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

  async function retakeQualityDecisionSite() {
    if (busy || !qualityDecision) return;
    const siteCode = qualityDecision.site_code;
    const nextReadings: ReadingState = { ...readings, [siteCode]: [] };
    setBusy(true);
    setError(null);
    try {
      await persistDraft(nextReadings);
      setReadings(nextReadings);
      setQualityDecision(null);
      setQualityConfirmed(false);
      setAcknowledgedSites((current) => current.filter((code) => code !== siteCode));
      setRetakeSite(siteCode);
      setCircuit(1);
      setSiteIndex(0);
      setReadingInput("");
      setStatusMessage(`Retaking ${siteDefinition(siteCode).label}. First reading.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the retake.");
    } finally {
      setBusy(false);
    }
  }

  function continueAfterQualityDecision() {
    if (!qualityDecision) return;
    const siteCode = qualityDecision.site_code;
    if (qualityDecision.quality === "high_variability") {
      if (!qualityConfirmed) return;
      setAcknowledgedSites((current) => current.includes(siteCode) ? current : [...current, siteCode]);
    }
    setQualityDecision(null);
    setQualityConfirmed(false);
    setRetakeSite(null);
    setRetakeResumeIndex(null);
    if (retakeResumeIndex != null && retakeResumeIndex < resolutionSites.length - 1) {
      setCircuit(3);
      setSiteIndex(retakeResumeIndex + 1);
      setStatusMessage("Decision saved. Continue the resolution circuit.");
    } else {
      setStatusMessage("All required readings are saved. Review your session.");
      setPhase("review");
    }
  }

  function addOptionalThirdReading(siteCode: AnthropometrySiteCode) {
    setResolutionSites([siteCode]);
    setRetakeResumeIndex(0);
    setCircuit(3);
    setSiteIndex(0);
    setPhase("measure");
    setStatusMessage(`Add an optional third reading for ${siteDefinition(siteCode).label}.`);
  }

  function goBack() {
    setError(null);
    if (retakeSite) {
      if (circuit === 2) setCircuit(1);
      if (circuit === 3) setCircuit(2);
      return;
    }
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
    const completedResolutionSites = selectedSites.filter((code) =>
      (readings[code] ?? []).length === 3
    );
    if (completedResolutionSites.length > 0) {
      setResolutionSites(completedResolutionSites);
      setCircuit(3);
      setSiteIndex(completedResolutionSites.length - 1);
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
        measurement_context: measurementContext,
        idempotency_key: idempotencyKey,
        sites: payloadFor(readings),
        high_variability_acknowledgements: acknowledgedSites.map((site_code) => ({
          site_code,
          acknowledged: true as const,
        })),
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
    setResolutionSites([]);
    setRetakeSite(null);
    setRetakeResumeIndex(null);
    setQualityDecision(null);
    setQualityConfirmed(false);
    setAcknowledgedSites([]);
    setReadingInput("");
    setNotes("");
    setMeasurementContext({
      meal_timing: "not_recorded",
      after_bathroom: null,
      exercise_within_previous_12_hours: null,
      measurement_assistance: "not_recorded",
      clothing_level: "not_recorded",
    });
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
      const targetId = recoveryDiscardId ?? sessionId;
      if (targetId) await deleteAnthropometrySession(targetId);
      if (recoveryDiscardId) {
        setAvailableDrafts((current) => current.filter((draft) => draft.id !== recoveryDiscardId));
        setRecoveryDiscardId(null);
        setDiscardConfirm(false);
        setStatusMessage("Saved draft discarded.");
      } else {
        resetLocalSession();
      }
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
        <>
          {draftsLoading && <DraftLoadingPanel />}
          {!draftsLoading && draftLoadError ? (
            <DraftLoadErrorPanel message={draftLoadError} onRetry={() => void loadDrafts()} />
          ) : !draftsLoading && availableDrafts.length > 0 ? (
            <DraftRecoveryPanel
              drafts={availableDrafts}
              busy={busy}
              error={error}
              onResume={(draft) => void resumeDraft(draft)}
              onDiscard={(draft) => {
                setRecoveryDiscardId(draft.id);
                setDiscardConfirm(true);
              }}
            />
          ) : null}
          {(draftsLoading || (!draftLoadError && availableDrafts.length === 0)) && (
            <SetupPanel
              selectedSites={selectedSites}
              measuredAtLocal={measuredAtLocal}
              prepared={prepared}
              measurementContext={measurementContext}
              busy={busy || draftsLoading}
              error={error}
              onMeasuredAtChange={setMeasuredAtLocal}
              onPreparedChange={setPrepared}
              onMeasurementContextChange={setMeasurementContext}
              onToggleSite={toggleSite}
              onSelectStandard={() => setSelectedSites(STANDARD_SITE_CODES)}
              onClear={() => setSelectedSites([])}
              onBegin={() => void beginSession()}
            />
          )}
        </>
      )}

      {phase === "measure" && currentSite && !qualityDecision && (
        <MeasurementPanel
          site={currentSite}
          circuit={circuit}
          siteIndex={siteIndex}
          circuitCount={circuitSites.length}
          unit={unit}
          readingInput={readingInput}
          busy={busy}
          isRetake={Boolean(retakeSite)}
          error={error}
          canGoBack={circuit !== 1 || siteIndex > 0}
          inputRef={readingInputRef}
          onInputChange={setReadingInput}
          onSubmit={(event) => void submitReading(event)}
          onBack={goBack}
          onDiscard={() => setDiscardConfirm(true)}
        />
      )}

      {phase === "measure" && qualityDecision && (
        <QualityDecisionPanel
          preview={qualityDecision}
          site={siteDefinition(qualityDecision.site_code)}
          readings={readings[qualityDecision.site_code] ?? []}
          unit={unit}
          busy={busy}
          error={error}
          confirmed={qualityConfirmed}
          onConfirmedChange={setQualityConfirmed}
          onRetake={() => void retakeQualityDecisionSite()}
          onContinue={continueAfterQualityDecision}
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
          measurementContext={measurementContext}
          busy={busy}
          error={error}
          onNotesChange={setNotes}
          onAddThird={addOptionalThirdReading}
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
          onCancel={() => {
            setDiscardConfirm(false);
            setRecoveryDiscardId(null);
          }}
          onConfirm={() => void discardDraft()}
        />
      )}
      </div>
    </main>
  );
}

function DraftLoadingPanel() {
  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-5" aria-label="Checking for saved measurement drafts">
      <div className="h-5 w-52 animate-pulse rounded bg-border/50" />
      <div className="mt-3 h-12 animate-pulse rounded bg-border/30" />
    </section>
  );
}

function DraftLoadErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="mt-6 rounded-xl border border-red-300 bg-red-50 p-5 dark:border-red-800 dark:bg-red-950/30" aria-labelledby="draft-load-error-heading">
      <h2 id="draft-load-error-heading" className="font-display text-lg font-semibold text-red-900 dark:text-red-100">Could not check saved drafts</h2>
      <p role="alert" className="mt-2 text-sm text-red-800 dark:text-red-200">{message}</p>
      <p className="mt-2 text-sm leading-6 text-red-800 dark:text-red-200">Starting a new session is paused so an existing draft is not duplicated.</p>
      <button type="button" onClick={onRetry} className="mt-4 min-h-11 rounded-lg border border-red-400 px-4 text-sm font-semibold text-red-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-700 dark:text-red-100">Try again</button>
    </section>
  );
}

function DraftRecoveryPanel({
  drafts,
  busy,
  error,
  onResume,
  onDiscard,
}: {
  drafts: AnthropometryHistorySession[];
  busy: boolean;
  error: string | null;
  onResume: (draft: AnthropometryHistorySession) => void;
  onDiscard: (draft: AnthropometryHistorySession) => void;
}) {
  return (
    <section className="mt-6 rounded-xl border border-primary/40 bg-surface p-4 sm:p-6" aria-labelledby="saved-drafts-heading">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary">Recovery</p>
      <h2 id="saved-drafts-heading" className="mt-1 font-display text-xl font-semibold text-ink">
        {drafts.length === 1 ? "You have a saved measurement draft" : `You have ${drafts.length} saved measurement drafts`}
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted">Resume preserved context and raw readings, or discard a draft before starting another session. Low-confidence acknowledgement is never restored and must be confirmed again.</p>
      <ol className="mt-4 divide-y divide-border rounded-lg border border-border">
        {drafts.map((draft, index) => (
          <li key={draft.id} className="p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{index === 0 ? "Latest draft" : `Earlier draft ${index + 1}`}</p>
                <p className="mt-1 break-words text-xs text-muted">
                  {draft.measured_at ? new Date(draft.measured_at).toLocaleString() : "Measurement time not recorded"} · {draft.readings.length} preserved {draft.readings.length === 1 ? "reading" : "readings"}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button type="button" onClick={() => onResume(draft)} disabled={busy} className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50">Resume</button>
                <button type="button" onClick={() => onDiscard(draft)} disabled={busy} className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-ink hover:bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50">Discard</button>
              </div>
            </div>
          </li>
        ))}
      </ol>
      {error && <div className="mt-4"><ErrorMessage message={error} /></div>}
    </section>
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
  measurementContext: AnthropometryMeasurementContextInput;
  busy: boolean;
  error: string | null;
  onMeasuredAtChange: (value: string) => void;
  onPreparedChange: (value: boolean) => void;
  onMeasurementContextChange: (value: AnthropometryMeasurementContextInput) => void;
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
        <fieldset className="mt-5 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-semibold text-ink">Measurement conditions <span className="font-normal text-muted">(optional)</span></legend>
          <p className="mb-3 text-xs leading-5 text-muted">Recording conditions helps explain possible variation. Differences never change or invalidate your representative values.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-ink">Food timing
              <select value={props.measurementContext.meal_timing} onChange={(event) => props.onMeasurementContextChange({ ...props.measurementContext, meal_timing: event.target.value as AnthropometryMeasurementContextInput["meal_timing"] })} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3">
                <option value="not_recorded">Not recorded</option><option value="before_food">Before food</option><option value="after_food">After food</option>
              </select>
            </label>
            <label className="text-sm font-medium text-ink">Measurement help
              <select value={props.measurementContext.measurement_assistance} onChange={(event) => props.onMeasurementContextChange({ ...props.measurementContext, measurement_assistance: event.target.value as AnthropometryMeasurementContextInput["measurement_assistance"] })} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3">
                <option value="not_recorded">Not recorded</option><option value="self">Measured myself</option><option value="assisted">Assisted</option>
              </select>
            </label>
            <label className="text-sm font-medium text-ink">Clothing level
              <select value={props.measurementContext.clothing_level} onChange={(event) => props.onMeasurementContextChange({ ...props.measurementContext, clothing_level: event.target.value as AnthropometryMeasurementContextInput["clothing_level"] })} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3">
                <option value="not_recorded">Not recorded</option><option value="minimal">Minimal</option><option value="light">Light</option><option value="normal">Normal</option><option value="other">Other</option>
              </select>
            </label>
            <label className="text-sm font-medium text-ink">After using the bathroom
              <select value={props.measurementContext.after_bathroom === null ? "not_recorded" : String(props.measurementContext.after_bathroom)} onChange={(event) => props.onMeasurementContextChange({ ...props.measurementContext, after_bathroom: event.target.value === "not_recorded" ? null : event.target.value === "true" })} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3">
                <option value="not_recorded">Not recorded</option><option value="true">Yes</option><option value="false">No</option>
              </select>
            </label>
            <label className="text-sm font-medium text-ink sm:col-span-2">Exercise in the previous 12 hours
              <select value={props.measurementContext.exercise_within_previous_12_hours === null ? "not_recorded" : String(props.measurementContext.exercise_within_previous_12_hours)} onChange={(event) => props.onMeasurementContextChange({ ...props.measurementContext, exercise_within_previous_12_hours: event.target.value === "not_recorded" ? null : event.target.value === "true" })} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-3 sm:max-w-sm">
                <option value="not_recorded">Not recorded</option><option value="true">Yes</option><option value="false">No</option>
              </select>
            </label>
          </div>
        </fieldset>
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
  isRetake: boolean;
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
  const circuitLabel = props.isRetake
    ? `Retake · reading ${props.circuit}`
    : props.circuit === 1
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
            {props.isRetake
              ? "Take one more reading at the same landmark."
              : "The first two readings differed, or you chose an optional check. Tape position, posture, breathing and normal measurement variation can contribute."} Nutri will preserve all three and use the mean of the closest pair.
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
              {props.busy
                ? props.circuit === 3
                  ? "Checking consistency…"
                  : "Saving…"
                : "Save reading and continue"}
            </button>
            <button type="button" onClick={props.onDiscard} disabled={props.busy} className="min-h-12 rounded-lg px-4 py-3 text-sm font-medium text-muted hover:text-ink disabled:opacity-50 sm:ml-auto">Discard draft</button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface QualityDecisionPanelProps {
  preview: AnthropometryRepresentativePreview;
  site: (typeof ANTHROPOMETRY_SITES)[number];
  readings: number[];
  unit: MeasurementUnit;
  busy: boolean;
  error: string | null;
  confirmed: boolean;
  onConfirmedChange: (value: boolean) => void;
  onRetake: () => void;
  onContinue: () => void;
  onDiscard: () => void;
}

function QualityDecisionPanel(props: QualityDecisionPanelProps) {
  const highVariability = props.preview.quality === "high_variability";
  return (
    <section
      className="mt-6 rounded-xl border border-border bg-surface p-4 sm:p-6"
      aria-labelledby="low-confidence-heading"
      aria-live="polite"
    >
      <p className="inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-100">
        {highVariability ? "Measurement confidence: Low" : "One reading was isolated"}
      </p>
      <h2 id="low-confidence-heading" className="mt-3 font-display text-2xl font-semibold text-ink">
        Review {props.site.label}
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted">
        {highVariability
          ? "No pair was within 1.0 cm. Tape position, posture, breathing, or ordinary measurement variation may have contributed. You can retake this site or explicitly save the closest-pair value with low confidence."
          : `Readings ${props.preview.selected_reading_indices?.join(" and ")} formed the closest agreeing pair. The remaining reading is preserved but excluded from the representative. You may retake the site or continue with the agreeing pair.`}
      </p>
      <p className="mt-4 rounded-lg bg-background p-3 text-sm text-muted">
        Recorded: {props.readings.map((value) => formatMeasurement(value, props.unit)).join(" · ")}
      </p>
      <p className="mt-4 text-sm leading-6 text-muted">
        Server representative preview: {formatMeasurement(props.preview.representative_cm, props.unit)} from readings {props.preview.selected_reading_indices?.join(" and ")}.
      </p>

      {highVariability && (
        <label className="mt-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100">
          <input
            type="checkbox"
            checked={props.confirmed}
            onChange={(event) => props.onConfirmedChange(event.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
          />
          <span>I understand this value has low measurement confidence and will not be used for progress interpretation.</span>
        </label>
      )}

      {props.error && <div className="mt-4"><ErrorMessage message={props.error} /></div>}

      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={props.onRetake}
          disabled={props.busy}
          className="min-h-12 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
        >
          {props.busy ? "Preparing retake…" : "Retake this site"}
        </button>
        <button
          type="button"
          onClick={props.onContinue}
          disabled={props.busy || (highVariability && !props.confirmed)}
          className="min-h-12 rounded-lg border border-border px-5 py-3 text-sm font-semibold text-ink hover:bg-background disabled:opacity-40"
        >
          {highVariability ? "Save with low confidence" : "Continue with agreeing pair"}
        </button>
        <button type="button" onClick={props.onDiscard} disabled={props.busy} className="min-h-12 rounded-lg px-4 py-3 text-sm font-medium text-muted hover:text-ink disabled:opacity-50 sm:ml-auto">
          Discard draft
        </button>
      </div>
    </section>
  );
}

interface ReviewPanelProps {
  selectedSites: AnthropometrySiteCode[];
  readings: ReadingState;
  unit: MeasurementUnit;
  measuredAtLocal: string;
  notes: string;
  measurementContext: AnthropometryMeasurementContextInput;
  busy: boolean;
  error: string | null;
  onNotesChange: (value: string) => void;
  onAddThird: (siteCode: AnthropometrySiteCode) => void;
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
                  {siteReadings.length === 2 && (
                    <button
                      type="button"
                      onClick={() => props.onAddThird(code)}
                      disabled={props.busy}
                      className="mt-2 block min-h-11 text-sm font-semibold text-primary underline-offset-2 hover:underline sm:ml-auto"
                    >
                      Add optional third reading
                    </button>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm font-medium text-ink">Measured</p>
            <p className="mt-1 text-sm text-muted">{new Date(props.measuredAtLocal).toLocaleString()}</p>
            <p className="mt-2 text-xs leading-5 text-muted">
              Context: {props.measurementContext.meal_timing.replace(/_/g, " ")} · {props.measurementContext.measurement_assistance.replace(/_/g, " ")} · {props.measurementContext.clothing_level.replace(/_/g, " ")}
            </p>
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
            <dd className="mt-1 text-xs text-muted">Representative from {site.reading_count} preserved readings</dd>
            {site.quality === "repeatability_warning" && (
              <dd className="mt-3 rounded-md bg-amber-50 p-2 text-xs leading-5 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                The first readings differed. The value is kept, with a quality note because measurement technique or normal variation may have contributed.
              </dd>
            )}
            {site.quality === "pair_agree_with_isolated_reading" && (
              <dd className="mt-3 rounded-md bg-amber-50 p-2 text-xs leading-5 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                One reading was preserved but excluded. Readings {site.selected_reading_indices?.join(" and ")} supplied the representative.
              </dd>
            )}
            {site.quality === "high_variability" && (
              <dd className="mt-3 rounded-md bg-amber-50 p-2 text-xs leading-5 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                Saved with explicit low-confidence acknowledgement. This value is ineligible for progress interpretation.
              </dd>
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
