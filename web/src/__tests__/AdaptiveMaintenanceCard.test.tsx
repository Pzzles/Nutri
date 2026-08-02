/**
 * Phase 7 — frontend component tests (AdaptiveMaintenanceCard)
 *
 * Uses real display helpers; stubs only the network API layer.
 * No math is re-implemented here — values come from the API fixture.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AdaptiveMaintenanceCard } from "../components/AdaptiveMaintenanceCard";
import * as adaptiveLib from "../lib/adaptiveMaintenance";
import type {
  AdaptiveMaintenanceResponse,
  SavedSnapshot,
} from "../lib/adaptiveMaintenance";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USABLE_RESPONSE: AdaptiveMaintenanceResponse = {
  status: "usable",
  confidence: "high",
  timezone: "Africa/Johannesburg",
  goal_phase: { id: "phase-1", mode: "cut", started_at: "2024-01-01T00:00:00Z" },
  analysis_window: {
    start: "2024-01-15",
    end: "2024-02-11",
    calendar_days: 28,
    selected_weight_window_days: 28,
  },
  nutrition: {
    eligible_days: 24,
    probably_complete_days: 0,
    incomplete_days: 2,
    not_logged_days: 2,
    coverage_fraction: 0.857,
    average_intake_kcal: 2000,
  },
  weight_trend: {
    weekly_rate_kg: -0.5,
    lower_kg: -0.6,
    upper_kg: -0.4,
    confidence: "high",
  },
  maintenance: {
    equation_estimate_kcal: 2400,
    manual_override_kcal: null,
    effective_phase_value_kcal: 2400,
    effective_phase_source: "equation_estimate",
    observed_estimate_kcal: 2550,
    lower_kcal: 2440,
    upper_kcal: 2660,
    observed_minus_equation_kcal: 150,
    observed_minus_effective_kcal: 150,
  },
  algorithm_versions: {
    weight_trend: {},
    energy_balance: "observed_maintenance_energy_balance_v1",
    nutrition_quality: "maintenance_nutrition_quality_v1",
    confidence: "observed_maintenance_confidence_v1",
  },
  warnings: [],
  limitations: ["This is a planning estimate."],
};

const PROVISIONAL_RESPONSE: AdaptiveMaintenanceResponse = {
  ...USABLE_RESPONSE,
  status: "provisional",
  confidence: "low",
  nutrition: { ...USABLE_RESPONSE.nutrition!, eligible_days: 16, coverage_fraction: 0.57 },
};

const SAVED_SNAPSHOT: SavedSnapshot = {
  snapshot_id: "snap-abc-123",
  created_at: "2024-02-11T10:00:00Z",
  observed_maintenance_kcal: 2550,
  confidence: "high",
  status: "usable",
};

// ── Setup ─────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let getMock: Mock<any[], Promise<AdaptiveMaintenanceResponse>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let saveMock: Mock<any[], Promise<SavedSnapshot>>;

beforeEach(() => {
  getMock  = vi.fn();
  saveMock = vi.fn();
  vi.spyOn(adaptiveLib, "getAdaptiveMaintenance").mockImplementation(getMock);
  vi.spyOn(adaptiveLib, "saveMaintenanceEstimate").mockImplementation(saveMock);
});

// ── Loading state ─────────────────────────────────────────────────────────────

describe("Loading state", () => {
  it("shows loading skeleton while fetching", async () => {
    getMock.mockReturnValue(new Promise(() => {})); // never resolves
    render(<AdaptiveMaintenanceCard />);
    expect(screen.getByTestId("maintenance-card-loading")).toBeInTheDocument();
  });
});

// ── Error state ───────────────────────────────────────────────────────────────

describe("Error state", () => {
  it("shows error card on fetch failure", async () => {
    getMock.mockRejectedValue(new Error("Network error"));
    render(<AdaptiveMaintenanceCard />);
    await waitFor(() => {
      expect(screen.getByTestId("maintenance-card-error")).toBeInTheDocument();
    });
    expect(screen.getByText(/Estimate unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/Network error/i)).toBeInTheDocument();
  });

  it("shows try-again button on error", async () => {
    getMock.mockRejectedValue(new Error("timeout"));
    render(<AdaptiveMaintenanceCard />);
    await waitFor(() => screen.getByTestId("maintenance-card-error"));
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});

// ── No active goal phase ──────────────────────────────────────────────────────

describe("No active goal phase", () => {
  it("shows no-phase card", async () => {
    getMock.mockResolvedValue({ status: "no_active_goal_phase" } satisfies AdaptiveMaintenanceResponse);
    render(<AdaptiveMaintenanceCard />);
    await waitFor(() => {
      expect(screen.getByTestId("maintenance-card-no-phase")).toBeInTheDocument();
    });
  });
});

// ── Weight gap states ─────────────────────────────────────────────────────────

describe("Weight gap states", () => {
  it("shows weight-gap card for insufficient_weight_data", async () => {
    getMock.mockResolvedValue({
      status: "insufficient_weight_data",
      message: "Weigh yourself more regularly.",
    } satisfies AdaptiveMaintenanceResponse);
    render(<AdaptiveMaintenanceCard />);
    await waitFor(() => {
      expect(screen.getByTestId("maintenance-card-weight-gap")).toBeInTheDocument();
    });
    expect(screen.getByText(/how many calories would keep your weight stable/i)).toBeInTheDocument();
    expect(screen.getByText(/Building your weight trend/i)).toBeInTheDocument();
    expect(screen.getByText(/at least 4 different days across at least 7 days/i)).toBeInTheDocument();
  });

  it("shows weight-gap card for stale_weight_data", async () => {
    getMock.mockResolvedValue({
      status: "stale_weight_data",
    } satisfies AdaptiveMaintenanceResponse);
    render(<AdaptiveMaintenanceCard />);
    await waitFor(() => {
      expect(screen.getByTestId("maintenance-card-weight-gap")).toBeInTheDocument();
    });
    expect(screen.getByText(/Log a current weight to continue/i)).toBeInTheDocument();
    expect(screen.getByText(/more than 14 days old/i)).toBeInTheDocument();
  });
});

// ── Insufficient nutrition ────────────────────────────────────────────────────

describe("Insufficient nutrition states", () => {
  it("shows insufficient-nutrition card", async () => {
    getMock.mockResolvedValue({
      status: "insufficient_nutrition_days",
      nutrition: {
        eligible_days: 8,
        probably_complete_days: 0,
        incomplete_days: 5,
        not_logged_days: 15,
        coverage_fraction: 0.29,
        average_intake_kcal: 1900,
      },
      analysis_window: {
        start: "2024-01-15",
        end: "2024-02-11",
        calendar_days: 28,
        selected_weight_window_days: 28,
      },
    } satisfies AdaptiveMaintenanceResponse);
    render(<AdaptiveMaintenanceCard />);
    await waitFor(() => {
      expect(screen.getByTestId("maintenance-card-insufficient-nutrition")).toBeInTheDocument();
    });
  });
});

// ── Usable estimate ───────────────────────────────────────────────────────────

describe("Usable estimate", () => {
  it("renders the main maintenance card", async () => {
    getMock.mockResolvedValue(USABLE_RESPONSE);
    render(<AdaptiveMaintenanceCard />);
    await waitFor(() => {
      expect(screen.getByTestId("maintenance-card")).toBeInTheDocument();
    });
  });

  it("shows observed estimate value (~2550 kcal/day)", async () => {
    getMock.mockResolvedValue(USABLE_RESPONSE);
    render(<AdaptiveMaintenanceCard />);
    await waitFor(() => screen.getByTestId("observed-estimate"));
    // toLocaleString uses locale-specific separators; match the numeric value
    expect(screen.getByTestId("observed-estimate")).toHaveTextContent(/2.?550 kcal\/day/);
  });

  it("shows the maintenance range (2440–2660 kcal/day)", async () => {
    getMock.mockResolvedValue(USABLE_RESPONSE);
    render(<AdaptiveMaintenanceCard />);
    await waitFor(() => screen.getByTestId("maintenance-range"));
    expect(screen.getByTestId("maintenance-range")).toHaveTextContent(/2.?440/);
    expect(screen.getByTestId("maintenance-range")).toHaveTextContent(/2.?660/);
  });

  it("shows comparison values block with equation estimate", async () => {
    getMock.mockResolvedValue(USABLE_RESPONSE);
    render(<AdaptiveMaintenanceCard />);
    await waitFor(() => screen.getByTestId("comparison-values"));
    expect(screen.getByTestId("comparison-values")).toHaveTextContent(/2.?400 kcal\/day/);
  });

  it("shows evidence summary with 24 eligible days", async () => {
    getMock.mockResolvedValue(USABLE_RESPONSE);
    render(<AdaptiveMaintenanceCard />);
    await waitFor(() => screen.getByTestId("evidence-summary"));
    expect(screen.getByTestId("evidence-summary")).toHaveTextContent("24");
  });

  it("shows save button", async () => {
    getMock.mockResolvedValue(USABLE_RESPONSE);
    render(<AdaptiveMaintenanceCard />);
    await waitFor(() => screen.getByTestId("save-snapshot-btn"));
    expect(screen.getByTestId("save-snapshot-btn")).toBeEnabled();
  });

  it("save button says 'Does not change your calorie target'", async () => {
    getMock.mockResolvedValue(USABLE_RESPONSE);
    render(<AdaptiveMaintenanceCard />);
    await waitFor(() => screen.getByTestId("save-snapshot-btn"));
    expect(screen.getByText(/Does not change your calorie target/i)).toBeInTheDocument();
  });
});

// ── Provisional estimate ──────────────────────────────────────────────────────

describe("Provisional estimate", () => {
  it("renders provisional banner", async () => {
    getMock.mockResolvedValue(PROVISIONAL_RESPONSE);
    render(<AdaptiveMaintenanceCard />);
    await waitFor(() => screen.getByTestId("maintenance-card"));
    expect(screen.getByText(/Provisional estimate/i)).toBeInTheDocument();
  });
});

// ── Save action ───────────────────────────────────────────────────────────────

describe("Save action", () => {
  it("calls saveMaintenanceEstimate with the goal_phase_id", async () => {
    getMock.mockResolvedValue(USABLE_RESPONSE);
    saveMock.mockResolvedValue(SAVED_SNAPSHOT);
    render(<AdaptiveMaintenanceCard />);
    await waitFor(() => screen.getByTestId("save-snapshot-btn"));

    fireEvent.click(screen.getByTestId("save-snapshot-btn"));
    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledWith("phase-1");
    });
  });

  it("disables the button after successful save", async () => {
    getMock.mockResolvedValue(USABLE_RESPONSE);
    saveMock.mockResolvedValue(SAVED_SNAPSHOT);
    render(<AdaptiveMaintenanceCard />);
    await waitFor(() => screen.getByTestId("save-snapshot-btn"));

    fireEvent.click(screen.getByTestId("save-snapshot-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("save-snapshot-btn")).toBeDisabled();
    });
  });

  it("save button shows 'Estimate saved' after successful save", async () => {
    getMock.mockResolvedValue(USABLE_RESPONSE);
    saveMock.mockResolvedValue(SAVED_SNAPSHOT);
    render(<AdaptiveMaintenanceCard />);
    await waitFor(() => screen.getByTestId("save-snapshot-btn"));

    fireEvent.click(screen.getByTestId("save-snapshot-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("save-snapshot-btn")).toHaveTextContent("Estimate saved");
    });
  });

  it("does NOT mutate calorie target — saveMaintenanceEstimate is the only call made", async () => {
    getMock.mockResolvedValue(USABLE_RESPONSE);
    saveMock.mockResolvedValue(SAVED_SNAPSHOT);
    const onSaved = vi.fn();
    render(<AdaptiveMaintenanceCard onSnapshotSaved={onSaved} />);
    await waitFor(() => screen.getByTestId("save-snapshot-btn"));

    fireEvent.click(screen.getByTestId("save-snapshot-btn"));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));

    // Only one call is made (no goal-phase update, no calorie-target update)
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith("snap-abc-123");
  });

  it("shows error on save failure", async () => {
    getMock.mockResolvedValue(USABLE_RESPONSE);
    saveMock.mockRejectedValue(new Error("Save failed"));
    render(<AdaptiveMaintenanceCard />);
    await waitFor(() => screen.getByTestId("save-snapshot-btn"));

    fireEvent.click(screen.getByTestId("save-snapshot-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("maintenance-card-error")).toBeInTheDocument();
    });
  });
});

// ── Warnings ──────────────────────────────────────────────────────────────────

describe("Warnings", () => {
  it("shows warnings block when warnings are present", async () => {
    getMock.mockResolvedValue({
      ...USABLE_RESPONSE,
      warnings: ["material: activity level changed during this window"],
    });
    render(<AdaptiveMaintenanceCard />);
    await waitFor(() => screen.getByTestId("warnings"));
    expect(screen.getByTestId("warnings")).toHaveTextContent("activity level changed");
  });

  it("does NOT show warnings block when warnings are empty", async () => {
    getMock.mockResolvedValue(USABLE_RESPONSE);
    render(<AdaptiveMaintenanceCard />);
    await waitFor(() => screen.getByTestId("maintenance-card"));
    expect(screen.queryByTestId("warnings")).not.toBeInTheDocument();
  });
});

// ── Probably-complete days prompt ─────────────────────────────────────────────

describe("Probably-complete days prompt", () => {
  it("shows prompt when probably_complete_days > 0", async () => {
    getMock.mockResolvedValue({
      ...USABLE_RESPONSE,
      nutrition: { ...USABLE_RESPONSE.nutrition!, probably_complete_days: 3 },
    });
    render(<AdaptiveMaintenanceCard />);
    await waitFor(() => screen.getByTestId("maintenance-card"));
    expect(screen.getByText(/3 day\(s\) have meals logged but are not marked complete/i)).toBeInTheDocument();
  });

  it("does NOT show prompt when probably_complete_days = 0", async () => {
    getMock.mockResolvedValue(USABLE_RESPONSE);
    render(<AdaptiveMaintenanceCard />);
    await waitFor(() => screen.getByTestId("maintenance-card"));
    expect(screen.queryByText(/have meals logged but are not marked complete/i)).not.toBeInTheDocument();
  });
});

// ── Expandable how-calculated section ────────────────────────────────────────

describe("How this was calculated section", () => {
  it("how-calculated details element is present", async () => {
    getMock.mockResolvedValue(USABLE_RESPONSE);
    render(<AdaptiveMaintenanceCard />);
    await waitFor(() => screen.getByTestId("how-calculated"));
    const details = screen.getByTestId("how-calculated");
    expect(details.tagName.toLowerCase()).toBe("details");
  });
});
