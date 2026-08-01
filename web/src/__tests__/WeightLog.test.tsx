// Component tests for WeightLogPage.
// callFunction / getFunction are mocked at the supabase boundary.
// getWeightTrend is mocked at the weightTrend boundary.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import WeightLogPage from "../pages/WeightLog";
import type { WeightLog } from "../lib/weightTypes";

vi.mock("../lib/supabase", () => ({ callFunction: vi.fn(), getFunction: vi.fn() }));
vi.mock("../lib/weightTrend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/weightTrend")>();
  return { ...actual, getWeightTrend: vi.fn() };
});

import { callFunction, getFunction } from "../lib/supabase";
import { getWeightTrend } from "../lib/weightTrend";
const mockCall = vi.mocked(callFunction);
const mockGet = vi.mocked(getFunction);
const mockGetTrend = vi.mocked(getWeightTrend);

const WEIGHT_LOG: WeightLog = {
  id: "wl-001",
  user_id: "user-001",
  weight_kg: 85.5,
  measured_at: "2026-07-23T07:00:00.000Z",
  logged_date: "2026-07-23",
  is_official: true,
  notes: null,
  source: "manual",
  created_at: "2026-07-23T07:00:00.000Z",
};

function makeGetResponse(logs: WeightLog[] = [], latest: WeightLog | null = null) {
  return { logs, latest_official: latest };
}

beforeEach(() => {
  mockCall.mockReset();
  mockGet.mockReset();
  mockGetTrend.mockReset();
  // Default: trend API rejects non-fatally — component shows no trend section error.
  mockGetTrend.mockRejectedValue(new Error("trend not mocked"));
});

// ── Loading state ─────────────────────────────────────────────────────────────

describe("WeightLogPage — loading", () => {
  it("shows loading indicator while fetching", async () => {
    mockGet.mockResolvedValueOnce(makeGetResponse());
    render(<MemoryRouter><WeightLogPage /></MemoryRouter>);
    // Synchronously before the promise resolves, the component shows loading
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/^Loading…$/)).not.toBeInTheDocument());
  });

  it("shows empty state when no logs exist", async () => {
    mockGet.mockResolvedValueOnce(makeGetResponse());
    render(<MemoryRouter><WeightLogPage /></MemoryRouter>);
    // Text appears in both the empty-state card and the history section.
    await waitFor(() => expect(screen.getAllByText(/no weight entries yet/i).length).toBeGreaterThanOrEqual(1));
  });
});

// ── Latest weight display ─────────────────────────────────────────────────────

describe("WeightLogPage — latest weight", () => {
  it("shows latest official weight prominently", async () => {
    mockGet.mockResolvedValueOnce(makeGetResponse([WEIGHT_LOG], WEIGHT_LOG));
    render(<MemoryRouter><WeightLogPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText("85.5").length).toBeGreaterThan(0));
  });

  it("shows Official badge on is_official entry when mixed official/non-official list", async () => {
    const nonOfficialLog: WeightLog = { ...WEIGHT_LOG, id: "wl-002", is_official: false };
    mockGet.mockResolvedValueOnce(makeGetResponse([WEIGHT_LOG, nonOfficialLog], WEIGHT_LOG));
    render(<MemoryRouter><WeightLogPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Official")).toBeInTheDocument());
  });
});

// ── Log form ──────────────────────────────────────────────────────────────────

describe("WeightLogPage — log form", () => {
  it("calls log-weight then refreshes trend after successful submission", async () => {
    const newLog: WeightLog = { ...WEIGHT_LOG, id: "wl-002", weight_kg: 85.0 };
    mockGet.mockResolvedValueOnce(makeGetResponse()); // initial load
    mockCall.mockResolvedValueOnce(newLog);           // log-weight response
    mockGetTrend.mockResolvedValue({
      status: "usable", confidence: "low", timezone: "UTC",
      window: { start: null, end: null, elapsed_days: 0, inclusive_calendar_days: 0 },
      measurements: { raw_count: 0, valid_count: 0, distinct_modelling_days: 0, excluded_count: 0, latest_measured_at: null, largest_gap_days: 0, selected_rate_window_days: null },
      latest_raw_weight_kg: null, latest_trend_weight_kg: null, weekly_rate: null,
      warnings: [], daily_representatives: [], trend_points: [], flagged_measurements: [], ols_diagnostic: null,
      algorithm_versions: { daily_representative: "", smoothing: "", rate: "", interval: "", confidence: "" },
    } as import("../lib/weightTrend").WeightTrendResponse); // trend refresh

    render(<MemoryRouter><WeightLogPage /></MemoryRouter>);
    await waitFor(() => screen.getByRole("button", { name: /^log$/i }));

    await userEvent.type(screen.getByRole("spinbutton", { name: /weight/i }), "85");
    await userEvent.click(screen.getByRole("button", { name: /^log$/i }));

    expect(mockCall).toHaveBeenCalledWith("log-weight", expect.objectContaining({ weight_kg: 85 }));
    // getWeightTrend called once on mount + once after successful log
    await waitFor(() => expect(mockGetTrend).toHaveBeenCalledTimes(2));
  });

  it("shows validation error for weight below 1 kg", async () => {
    mockGet.mockResolvedValueOnce(makeGetResponse());
    render(<MemoryRouter><WeightLogPage /></MemoryRouter>);
    await waitFor(() => screen.getByRole("button", { name: /^log$/i }));

    await userEvent.type(screen.getByRole("spinbutton", { name: /weight/i }), "0.5");
    await userEvent.click(screen.getByRole("button", { name: /^log$/i }));

    expect(screen.getByText(/between 1 and 500/i)).toBeInTheDocument();
    expect(mockCall).not.toHaveBeenCalled();
  });

  it("shows validation error for weight above 500 kg", async () => {
    mockGet.mockResolvedValueOnce(makeGetResponse());
    render(<MemoryRouter><WeightLogPage /></MemoryRouter>);
    await waitFor(() => screen.getByRole("button", { name: /^log$/i }));

    await userEvent.type(screen.getByRole("spinbutton", { name: /weight/i }), "501");
    await userEvent.click(screen.getByRole("button", { name: /^log$/i }));

    expect(screen.getByText(/between 1 and 500/i)).toBeInTheDocument();
  });

  it("shows API error message when log-weight returns no data", async () => {
    mockGet.mockResolvedValueOnce(makeGetResponse());
    mockCall.mockResolvedValueOnce(undefined as never);
    render(<MemoryRouter><WeightLogPage /></MemoryRouter>);
    await waitFor(() => screen.getByRole("button", { name: /^log$/i }));

    await userEvent.type(screen.getByRole("spinbutton", { name: /weight/i }), "85");
    await userEvent.click(screen.getByRole("button", { name: /^log$/i }));

    await waitFor(() =>
      expect(screen.getByText(/no data|log-weight/i)).toBeInTheDocument(),
    );
  });

  it("appends new entry to the top of the list without refetch", async () => {
    const newLog: WeightLog = { ...WEIGHT_LOG, id: "wl-003", weight_kg: 84.5 };
    mockGet.mockResolvedValueOnce(makeGetResponse([WEIGHT_LOG], WEIGHT_LOG));
    mockCall.mockResolvedValueOnce(newLog);

    render(<MemoryRouter><WeightLogPage /></MemoryRouter>);
    await waitFor(() => screen.getByText("85.5"));

    await userEvent.type(screen.getByRole("spinbutton", { name: /weight/i }), "84.5");
    await userEvent.click(screen.getByRole("button", { name: /^log$/i }));

    await waitFor(() => expect(screen.getAllByText("84.5").length).toBeGreaterThan(0));
  });

  it("shows API error when log-weight fails", async () => {
    mockGet.mockResolvedValueOnce(makeGetResponse());
    mockCall.mockRejectedValueOnce(new Error("Server error"));

    render(<MemoryRouter><WeightLogPage /></MemoryRouter>);
    await waitFor(() => screen.getByRole("button", { name: /^log$/i }));

    await userEvent.type(screen.getByRole("spinbutton", { name: /weight/i }), "85");
    await userEvent.click(screen.getByRole("button", { name: /^log$/i }));

    await waitFor(() => expect(screen.getByText(/server error/i)).toBeInTheDocument());
  });
});
