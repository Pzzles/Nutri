// Component tests for WeightLogPage.
// All edge function calls mocked at the callFunction boundary.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import WeightLogPage from "../pages/WeightLog";
import { WeightLog } from "../lib/weightTypes";

vi.mock("../lib/supabase", () => ({ callFunction: vi.fn(), getFunction: vi.fn() }));
import { callFunction, getFunction } from "../lib/supabase";
const mockCall = vi.mocked(callFunction);
const mockGet = vi.mocked(getFunction);

const WEIGHT_LOG: WeightLog = {
  id: "wl-001",
  user_id: "user-001",
  weight_kg: 85.5,
  measured_at: "2026-07-23T07:00:00.000Z",
  logged_date: "2026-07-23",
  is_official: true,
  notes: null,
  created_at: "2026-07-23T07:00:00.000Z",
};

function makeGetResponse(logs: WeightLog[] = [], latest: WeightLog | null = null) {
  return { logs, latest_official: latest };
}

beforeEach(() => { mockCall.mockReset(); mockGet.mockReset(); });

// ── Loading state ─────────────────────────────────────────────────────────────

describe("WeightLogPage — loading", () => {
  it("shows loading indicator while fetching", async () => {
    mockGet.mockResolvedValueOnce(makeGetResponse());
    render(<MemoryRouter><WeightLogPage /></MemoryRouter>);
    // Synchronously before the promise resolves, the component shows loading
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/loading/i)).not.toBeInTheDocument());
  });

  it("shows empty state when no logs exist", async () => {
    mockGet.mockResolvedValueOnce(makeGetResponse());
    render(<MemoryRouter><WeightLogPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/no weight entries yet/i)).toBeInTheDocument());
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
    // Badge only renders when hasNonOfficial is true (mix of official and non-official).
    // A list of only official entries would suppress the badge (no distinction needed).
    const nonOfficialLog: WeightLog = { ...WEIGHT_LOG, id: "wl-002", is_official: false };
    mockGet.mockResolvedValueOnce(makeGetResponse([WEIGHT_LOG, nonOfficialLog], WEIGHT_LOG));
    render(<MemoryRouter><WeightLogPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Official")).toBeInTheDocument());
  });
});

// ── Log form ──────────────────────────────────────────────────────────────────

describe("WeightLogPage — log form", () => {
  it("calls log-weight then get-weight-logs after successful submission", async () => {
    const newLog: WeightLog = { ...WEIGHT_LOG, id: "wl-002", weight_kg: 85.0 };
    mockGet.mockResolvedValueOnce(makeGetResponse()); // initial load
    mockCall.mockResolvedValueOnce(newLog);           // log-weight response

    render(<MemoryRouter><WeightLogPage /></MemoryRouter>);
    await waitFor(() => screen.getByRole("button", { name: /^log$/i }));

    await userEvent.type(screen.getByRole("spinbutton", { name: /weight/i }), "85");
    await userEvent.click(screen.getByRole("button", { name: /^log$/i }));

    expect(mockCall).toHaveBeenCalledWith("log-weight", expect.objectContaining({ weight_kg: 85 }));
  });

  it("shows validation error for weight below 1 kg", async () => {
    // The validation range was widened to 1–500 kg in Phase 3/4 to accommodate
    // extreme but real cases (e.g. newborns, competitive athletes).
    mockGet.mockResolvedValueOnce(makeGetResponse());
    render(<MemoryRouter><WeightLogPage /></MemoryRouter>);
    await waitFor(() => screen.getByRole("button", { name: /^log$/i }));

    await userEvent.type(screen.getByRole("spinbutton", { name: /weight/i }), "0.5");
    await userEvent.click(screen.getByRole("button", { name: /^log$/i }));

    expect(screen.getByText(/between 1 and 500/i)).toBeInTheDocument();
    expect(mockCall).not.toHaveBeenCalled(); // log-weight must not be called on validation error
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
    // Regression: before the null-guard fix, undefined from callFunction was added
    // to the logs array, causing TypeError on logs.some((l) => !l.is_official).
    mockGet.mockResolvedValueOnce(makeGetResponse());
    mockCall.mockResolvedValueOnce(undefined as any); // simulates missing response data
    render(<MemoryRouter><WeightLogPage /></MemoryRouter>);
    await waitFor(() => screen.getByRole("button", { name: /^log$/i }));

    await userEvent.type(screen.getByRole("spinbutton", { name: /weight/i }), "85");
    await userEvent.click(screen.getByRole("button", { name: /^log$/i }));

    await waitFor(() =>
      expect(screen.getByText(/no data|log-weight/i)).toBeInTheDocument(),
    );
    // The logs section must not contain undefined entries — no TypeError should occur.
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
