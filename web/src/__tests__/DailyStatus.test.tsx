// Component tests for DailyStatusControl.
// Tests the toggle behaviour and network call patterns; does not test CSS classes.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DailyStatusControl from "../components/DailyStatusControl";

vi.mock("../lib/supabase", () => ({ callFunction: vi.fn() }));
import { callFunction } from "../lib/supabase";
const mockCall = vi.mocked(callFunction);

const DATE = "2026-07-23";

beforeEach(() => {
  mockCall.mockReset();
});

function makeStatusResponse(status: "unknown" | "partial" | "complete") {
  return { status, marked_complete_at: status === "complete" ? new Date().toISOString() : null, reopened_at: null };
}

// ── Rendering ──────────────────────────────────────────────────────────────────

describe("DailyStatusControl — rendering", () => {
  it("shows 'Mark log complete' for unknown status", () => {
    render(<DailyStatusControl date={DATE} status="unknown" />);
    expect(screen.getByRole("button", { name: /mark log complete/i })).toBeInTheDocument();
  });

  it("shows 'Re-open log' for complete status", () => {
    render(<DailyStatusControl date={DATE} status="complete" />);
    expect(screen.getByRole("button", { name: /re-open log/i })).toBeInTheDocument();
  });

  it("shows completion tick when status is complete", () => {
    render(<DailyStatusControl date={DATE} status="complete" />);
    expect(screen.getByLabelText(/day marked complete/i)).toBeInTheDocument();
  });

  it("does not show tick when status is unknown", () => {
    render(<DailyStatusControl date={DATE} status="unknown" />);
    expect(screen.queryByLabelText(/day marked complete/i)).not.toBeInTheDocument();
  });
});

// ── Interaction: mark complete ──────────────────────────────────────────────────

describe("DailyStatusControl — mark complete", () => {
  it("calls set-daily-log-status with status=complete when toggled from unknown", async () => {
    mockCall.mockResolvedValueOnce(makeStatusResponse("complete"));
    render(<DailyStatusControl date={DATE} status="unknown" />);

    await userEvent.click(screen.getByRole("button", { name: /mark log complete/i }));

    expect(mockCall).toHaveBeenCalledWith("set-daily-log-status", { date: DATE, status: "complete" });
  });

  it("shows Re-open button after marking complete", async () => {
    mockCall.mockResolvedValueOnce(makeStatusResponse("complete"));
    render(<DailyStatusControl date={DATE} status="unknown" />);

    await userEvent.click(screen.getByRole("button", { name: /mark log complete/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /re-open log/i })).toBeInTheDocument();
    });
  });
});

// ── Interaction: reopen ────────────────────────────────────────────────────────

describe("DailyStatusControl — reopen", () => {
  it("calls set-daily-log-status with status=partial when re-opened", async () => {
    mockCall.mockResolvedValueOnce(makeStatusResponse("partial"));
    render(<DailyStatusControl date={DATE} status="complete" />);

    await userEvent.click(screen.getByRole("button", { name: /re-open log/i }));

    expect(mockCall).toHaveBeenCalledWith("set-daily-log-status", { date: DATE, status: "partial" });
  });

  it("invokes onStatusChange callback with the updated status", async () => {
    const updated = makeStatusResponse("partial");
    mockCall.mockResolvedValueOnce(updated);
    const onStatusChange = vi.fn();

    render(<DailyStatusControl date={DATE} status="complete" onStatusChange={onStatusChange} />);

    await userEvent.click(screen.getByRole("button", { name: /re-open log/i }));

    await waitFor(() => {
      expect(onStatusChange).toHaveBeenCalledWith(updated);
    });
  });
});

// ── Error state ────────────────────────────────────────────────────────────────

describe("DailyStatusControl — error handling", () => {
  it("shows error message when the API call fails", async () => {
    mockCall.mockRejectedValueOnce(new Error("Network error"));
    render(<DailyStatusControl date={DATE} status="unknown" />);

    await userEvent.click(screen.getByRole("button", { name: /mark log complete/i }));

    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });
  });

  it("re-enables the button after an error", async () => {
    mockCall.mockRejectedValueOnce(new Error("timeout"));
    render(<DailyStatusControl date={DATE} status="unknown" />);

    await userEvent.click(screen.getByRole("button", { name: /mark log complete/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /mark log complete/i })).not.toBeDisabled();
    });
  });
});
