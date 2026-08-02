/**
 * Phase 8 — frontend component tests (GoalFeedbackCard)
 *
 * Uses real display helpers from goalFeedback.ts; stubs only the network
 * layer (getGoalFeedback / saveGoalFeedbackAssessment).
 * No Phase 8 mathematics are re-implemented in this file.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GoalFeedbackCard } from "../components/GoalFeedbackCard";
import * as goalFeedbackLib from "../lib/goalFeedback";
import type {
  GoalFeedbackResponse,
  SavedAssessment,
} from "../lib/goalFeedback";

// ── Shared fixtures ───────────────────────────────────────────────────────────

const PHASE_SUMMARY: GoalFeedbackResponse["goal_phase"] = {
  id: "phase-1",
  mode: "cut",
  started_at: "2026-01-01T00:00:00Z",
  target_change_kg_per_week: -0.50,
};

const CURRENT_EVIDENCE: GoalFeedbackResponse["evidence"]["current"] = {
  p6_status:            "usable",
  p6_confidence:        "high",
  p6_weekly_rate_kg:    -0.48,
  p6_rate_lower_kg:     null,
  p6_rate_upper_kg:     null,
  p7_status:            "usable",
  p7_confidence:        "high",
  p7_coverage_fraction: 0.86,
};

const HISTORICAL_EVIDENCE: GoalFeedbackResponse["evidence"]["historical_14d"] = {
  p6_status:            "usable",
  p6_confidence:        "medium",
  p6_weekly_rate_kg:    -0.45,
  p6_rate_lower_kg:     null,
  p6_rate_upper_kg:     null,
  p7_status:            "usable",
  p7_confidence:        "medium",
  p7_coverage_fraction: 0.75,
};

const ALGO_VERSIONS: GoalFeedbackResponse["algorithm_versions"] = {
  goal_progress:    "goal_progress_assessment_v1",
  goal_thresholds:  "goal_progress_thresholds_v1",
  energy_balance:   "observed_maintenance_energy_balance_v1",
  nutrition_quality: "maintenance_nutrition_quality_v1",
  confidence:       "observed_maintenance_confidence_v1",
};

const ON_TRACK_RESPONSE: GoalFeedbackResponse = {
  progress_state:                  "on_track",
  feedback_action:                 "keep_current_plan",
  reason_codes:                    ["rate_within_band"],
  // Canonical signed fields
  suggested_adjustment_kcal:       null,
  proposed_target_kcal:            null,
  adjustment_blocked_reason_codes: [],
  maintenance_drift_direction:     null,
  // Compatibility aliases
  advisory_calorie_adjustment_kcal: null,
  advisory_adjustment_direction:   null,
  goal_attainment_ratio:           0.96,
  goal_phase:                      PHASE_SUMMARY,
  evidence: { current: CURRENT_EVIDENCE, historical_14d: HISTORICAL_EVIDENCE },
  assessed_at:                     "2026-05-01T10:00:00.000Z",
  algorithm_versions:              ALGO_VERSIONS,
  warnings:                        [],
  limitations:                     ["This is a planning estimate."],
};

const LIKELY_PLATEAU_RESPONSE: GoalFeedbackResponse = {
  ...ON_TRACK_RESPONSE,
  progress_state:                  "likely_plateau",
  feedback_action:                 "consider_small_calorie_adjustment",
  reason_codes:                    ["plateau_persistent", "rate_near_zero_cut"],
  suggested_adjustment_kcal:       -250,
  proposed_target_kcal:            1750,
  adjustment_blocked_reason_codes: [],
  advisory_calorie_adjustment_kcal: 250,
  advisory_adjustment_direction:   "decrease",
  goal_attainment_ratio:           -0.04,
  evidence: {
    current: { ...CURRENT_EVIDENCE, p6_weekly_rate_kg: 0.02 },
    historical_14d: HISTORICAL_EVIDENCE,
  },
};

const SAVED_ASSESSMENT: SavedAssessment = {
  assessment_id:                   "assess-abc-123",
  created_at:                      "2026-05-01T10:00:00.000Z",
  progress_state:                  "on_track",
  feedback_action:                 "keep_current_plan",
  advisory_calorie_adjustment_kcal: null,
  advisory_adjustment_direction:   null,
  goal_attainment_ratio:           0.96,
};

// ── Mocks ─────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let getMock: Mock<any[], Promise<GoalFeedbackResponse>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let saveMock: Mock<any[], Promise<SavedAssessment>>;

beforeEach(() => {
  getMock  = vi.fn();
  saveMock = vi.fn();
  vi.spyOn(goalFeedbackLib, "getGoalFeedback").mockImplementation(getMock);
  vi.spyOn(goalFeedbackLib, "saveGoalFeedbackAssessment").mockImplementation(saveMock);
});

// ── Loading state ─────────────────────────────────────────────────────────────

describe("Loading state", () => {
  it("shows loading skeleton while fetching", () => {
    getMock.mockReturnValue(new Promise(() => {}));
    render(<GoalFeedbackCard />);
    expect(screen.getByTestId("goal-feedback-card-loading")).toBeInTheDocument();
  });
});

// ── Error state ───────────────────────────────────────────────────────────────

describe("Error state", () => {
  it("shows error card on fetch failure", async () => {
    getMock.mockRejectedValue(new Error("Network error"));
    render(<GoalFeedbackCard />);
    await waitFor(() => {
      expect(screen.getByTestId("goal-feedback-card-error")).toBeInTheDocument();
    });
    expect(screen.getByText(/Feedback unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/Network error/i)).toBeInTheDocument();
  });

  it("shows try-again button on error", async () => {
    getMock.mockRejectedValue(new Error("timeout"));
    render(<GoalFeedbackCard />);
    await waitFor(() => screen.getByTestId("goal-feedback-card-error"));
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});

// ── No active goal phase ──────────────────────────────────────────────────────

describe("No active goal phase", () => {
  it("shows no-phase card for no_active_goal_phase state", async () => {
    getMock.mockResolvedValue({
      ...ON_TRACK_RESPONSE,
      progress_state: "no_active_goal_phase",
      feedback_action: "start_goal_phase",
      goal_phase: null,
    });
    render(<GoalFeedbackCard />);
    await waitFor(() => {
      expect(screen.getByTestId("goal-feedback-card-no-phase")).toBeInTheDocument();
    });
  });
});

// ── Insufficient / stale data states ─────────────────────────────────────────

describe("Insufficient and stale data states", () => {
  it("shows no-data card for insufficient_data", async () => {
    getMock.mockResolvedValue({
      ...ON_TRACK_RESPONSE,
      progress_state: "insufficient_data",
      feedback_action: "collect_more_data",
    });
    render(<GoalFeedbackCard />);
    await waitFor(() => {
      expect(screen.getByTestId("goal-feedback-card-no-data")).toBeInTheDocument();
    });
    expect(screen.getByText(/Building your first assessment/i)).toBeInTheDocument();
    expect(screen.getByText(/at least 4 different days across at least 7 days/i)).toBeInTheDocument();
    expect(screen.getByText(/adjustment suggestions require at least 70% coverage/i)).toBeInTheDocument();
  });

  it("shows no-data card for stale_data", async () => {
    getMock.mockResolvedValue({
      ...ON_TRACK_RESPONSE,
      progress_state: "stale_data",
      feedback_action: "collect_more_data",
    });
    render(<GoalFeedbackCard />);
    await waitFor(() => {
      expect(screen.getByTestId("goal-feedback-card-no-data")).toBeInTheDocument();
    });
    expect(screen.getByText(/Log a current weight to continue/i)).toBeInTheDocument();
    expect(screen.getByText(/more than 14 days old/i)).toBeInTheDocument();
  });
});

// ── Full assessment card ──────────────────────────────────────────────────────

describe("Full assessment card", () => {
  it("renders the main feedback card for on_track state", async () => {
    getMock.mockResolvedValue(ON_TRACK_RESPONSE);
    render(<GoalFeedbackCard />);
    await waitFor(() => {
      expect(screen.getByTestId("goal-feedback-card")).toBeInTheDocument();
    });
  });

  it("shows the correct state headline for on_track", async () => {
    getMock.mockResolvedValue(ON_TRACK_RESPONSE);
    render(<GoalFeedbackCard />);
    await waitFor(() => screen.getByTestId("state-headline"));
    expect(screen.getByTestId("state-headline")).toHaveTextContent(/On track/i);
  });

  it("shows the feedback action chip", async () => {
    getMock.mockResolvedValue(ON_TRACK_RESPONSE);
    render(<GoalFeedbackCard />);
    await waitFor(() => screen.getByTestId("feedback-action"));
    expect(screen.getByTestId("feedback-action")).toHaveTextContent(/Continue with current plan/i);
  });

  it("shows key metrics for on_track (rate and attainment)", async () => {
    getMock.mockResolvedValue(ON_TRACK_RESPONSE);
    render(<GoalFeedbackCard />);
    await waitFor(() => screen.getByTestId("key-metrics"));
    expect(screen.getByTestId("key-metrics")).toBeInTheDocument();
  });

  it("shows save button that is initially enabled", async () => {
    getMock.mockResolvedValue(ON_TRACK_RESPONSE);
    render(<GoalFeedbackCard />);
    await waitFor(() => screen.getByTestId("save-assessment-btn"));
    expect(screen.getByTestId("save-assessment-btn")).toBeEnabled();
  });

  it("says 'Does not change your calorie target' near save button", async () => {
    getMock.mockResolvedValue(ON_TRACK_RESPONSE);
    render(<GoalFeedbackCard />);
    await waitFor(() => screen.getByTestId("save-assessment-btn"));
    expect(screen.getByText(/Does not change your calorie target/i)).toBeInTheDocument();
  });
});

// ── Advisory adjustment banner ────────────────────────────────────────────────

describe("Advisory adjustment banner", () => {
  it("shows advisory banner for likely_plateau", async () => {
    getMock.mockResolvedValue(LIKELY_PLATEAU_RESPONSE);
    render(<GoalFeedbackCard />);
    await waitFor(() => {
      expect(screen.getByTestId("advisory-adjustment-banner")).toBeInTheDocument();
    });
  });

  it("shows advisory text with direction and magnitude", async () => {
    getMock.mockResolvedValue(LIKELY_PLATEAU_RESPONSE);
    render(<GoalFeedbackCard />);
    await waitFor(() => screen.getByTestId("advisory-adjustment-text"));
    const text = screen.getByTestId("advisory-adjustment-text").textContent ?? "";
    expect(text.toLowerCase()).toMatch(/decrease|decrease intake/i);
    expect(text).toMatch(/250/);
  });

  it("shows advisory disclaimer about calorie target", async () => {
    getMock.mockResolvedValue(LIKELY_PLATEAU_RESPONSE);
    render(<GoalFeedbackCard />);
    await waitFor(() => screen.getByTestId("advisory-adjustment-banner"));
    expect(screen.getByText(/requires your explicit confirmation/i)).toBeInTheDocument();
  });

  it("does NOT show advisory banner for on_track", async () => {
    getMock.mockResolvedValue(ON_TRACK_RESPONSE);
    render(<GoalFeedbackCard />);
    await waitFor(() => screen.getByTestId("goal-feedback-card"));
    expect(screen.queryByTestId("advisory-adjustment-banner")).not.toBeInTheDocument();
  });
});

// ── Likely plateau state ──────────────────────────────────────────────────────

describe("Likely plateau state", () => {
  it("renders likely_plateau headline", async () => {
    getMock.mockResolvedValue(LIKELY_PLATEAU_RESPONSE);
    render(<GoalFeedbackCard />);
    await waitFor(() => screen.getByTestId("state-headline"));
    expect(screen.getByTestId("state-headline")).toHaveTextContent(/Plateau likely/i);
  });

  it("action chip says consider_small_calorie_adjustment", async () => {
    getMock.mockResolvedValue(LIKELY_PLATEAU_RESPONSE);
    render(<GoalFeedbackCard />);
    await waitFor(() => screen.getByTestId("feedback-action"));
    expect(screen.getByTestId("feedback-action")).toHaveTextContent(/Consider a small calorie adjustment/i);
  });
});

// ── All 11 states render without crash ────────────────────────────────────────

describe("All 11 progress states render without crash", () => {
  const allStates: Array<GoalFeedbackResponse["progress_state"]> = [
    "no_active_goal_phase",
    "insufficient_data",
    "stale_data",
    "on_track",
    "slower_than_planned",
    "faster_than_planned",
    "plateau_candidate",
    "likely_plateau",
    "opposite_direction",
    "maintenance_stable",
    "maintenance_drift",
  ];

  for (const state of allStates) {
    it(`renders without crash for state: ${state}`, async () => {
      getMock.mockResolvedValue({
        ...ON_TRACK_RESPONSE,
        progress_state: state,
        feedback_action: "keep_current_plan",
        goal_phase: state === "no_active_goal_phase" ? null : PHASE_SUMMARY,
      });
      const { container } = render(<GoalFeedbackCard />);
      await waitFor(() => {
        expect(container.firstChild).not.toBeNull();
      });
    });
  }
});

// ── Reason codes ──────────────────────────────────────────────────────────────

describe("Reason codes", () => {
  it("shows reason-codes details element when codes are present", async () => {
    getMock.mockResolvedValue(ON_TRACK_RESPONSE);
    render(<GoalFeedbackCard />);
    await waitFor(() => screen.getByTestId("reason-codes-detail"));
    expect(screen.getByTestId("reason-codes-detail")).toBeInTheDocument();
  });

  it("explains each reason code in plain language", async () => {
    getMock.mockResolvedValue(LIKELY_PLATEAU_RESPONSE);
    render(<GoalFeedbackCard />);
    await waitFor(() => screen.getByTestId("reason-codes-list"));
    const list = screen.getByTestId("reason-codes-list");
    expect(list).toHaveTextContent(/near-flat trend is present now and was also present 14 days ago/i);
    expect(list).toHaveTextContent(/cut's observed weight trend is close to flat/i);
  });
});

// ── Warnings ──────────────────────────────────────────────────────────────────

describe("Warnings", () => {
  it("shows warnings block when warnings are present", async () => {
    getMock.mockResolvedValue({ ...ON_TRACK_RESPONSE, warnings: ["Logging gap detected."] });
    render(<GoalFeedbackCard />);
    await waitFor(() => screen.getByTestId("warnings"));
    expect(screen.getByTestId("warnings")).toHaveTextContent("Logging gap detected.");
  });

  it("does NOT show warnings block when warnings are empty", async () => {
    getMock.mockResolvedValue(ON_TRACK_RESPONSE);
    render(<GoalFeedbackCard />);
    await waitFor(() => screen.getByTestId("goal-feedback-card"));
    expect(screen.queryByTestId("warnings")).not.toBeInTheDocument();
  });
});

// ── Save action ───────────────────────────────────────────────────────────────

describe("Save action", () => {
  it("calls saveGoalFeedbackAssessment with the goal_phase_id", async () => {
    getMock.mockResolvedValue(ON_TRACK_RESPONSE);
    saveMock.mockResolvedValue(SAVED_ASSESSMENT);
    render(<GoalFeedbackCard />);
    await waitFor(() => screen.getByTestId("save-assessment-btn"));

    fireEvent.click(screen.getByTestId("save-assessment-btn"));
    await waitFor(() => expect(saveMock).toHaveBeenCalledWith("phase-1"));
  });

  it("disables button after successful save", async () => {
    getMock.mockResolvedValue(ON_TRACK_RESPONSE);
    saveMock.mockResolvedValue(SAVED_ASSESSMENT);
    render(<GoalFeedbackCard />);
    await waitFor(() => screen.getByTestId("save-assessment-btn"));

    fireEvent.click(screen.getByTestId("save-assessment-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("save-assessment-btn")).toBeDisabled();
    });
  });

  it("save button shows 'Assessment saved' after successful save", async () => {
    getMock.mockResolvedValue(ON_TRACK_RESPONSE);
    saveMock.mockResolvedValue(SAVED_ASSESSMENT);
    render(<GoalFeedbackCard />);
    await waitFor(() => screen.getByTestId("save-assessment-btn"));

    fireEvent.click(screen.getByTestId("save-assessment-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("save-assessment-btn")).toHaveTextContent("Assessment saved");
    });
  });

  it("fires onAssessmentSaved callback with the assessment_id", async () => {
    getMock.mockResolvedValue(ON_TRACK_RESPONSE);
    saveMock.mockResolvedValue(SAVED_ASSESSMENT);
    const onSaved = vi.fn();
    render(<GoalFeedbackCard onAssessmentSaved={onSaved} />);
    await waitFor(() => screen.getByTestId("save-assessment-btn"));

    fireEvent.click(screen.getByTestId("save-assessment-btn"));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("assess-abc-123"));
  });

  it("only calls saveGoalFeedbackAssessment once — no side-effect calls", async () => {
    getMock.mockResolvedValue(ON_TRACK_RESPONSE);
    saveMock.mockResolvedValue(SAVED_ASSESSMENT);
    render(<GoalFeedbackCard />);
    await waitFor(() => screen.getByTestId("save-assessment-btn"));

    fireEvent.click(screen.getByTestId("save-assessment-btn"));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it("shows error card on save failure", async () => {
    getMock.mockResolvedValue(ON_TRACK_RESPONSE);
    saveMock.mockRejectedValue(new Error("Save failed"));
    render(<GoalFeedbackCard />);
    await waitFor(() => screen.getByTestId("save-assessment-btn"));

    fireEvent.click(screen.getByTestId("save-assessment-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("goal-feedback-card-error")).toBeInTheDocument();
    });
  });
});
