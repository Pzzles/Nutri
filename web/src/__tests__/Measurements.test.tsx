import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Measurements from "../pages/Measurements";
import type {
  AnthropometrySaveResponse,
  AnthropometrySiteCode,
} from "../lib/anthropometry";

vi.mock("../lib/anthropometry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/anthropometry")>();
  return {
    ...actual,
    saveAnthropometryDraft: vi.fn(),
    finalizeAnthropometrySession: vi.fn(),
    deleteAnthropometrySession: vi.fn(),
    getAnthropometricProgress: vi.fn(),
  };
});

import {
  deleteAnthropometrySession,
  finalizeAnthropometrySession,
  getAnthropometricProgress,
  saveAnthropometryDraft,
} from "../lib/anthropometry";

const mockSaveDraft = vi.mocked(saveAnthropometryDraft);
const mockFinalize = vi.mocked(finalizeAnthropometrySession);
const mockDelete = vi.mocked(deleteAnthropometrySession);
const mockGetProgress = vi.mocked(getAnthropometricProgress);

function response(
  status: "draft" | "finalized" = "draft",
  sites: AnthropometrySaveResponse["sites"] = [],
): AnthropometrySaveResponse {
  return {
    session: {
      id: "session-001",
      status,
      measured_at: "2026-08-02T08:00:00.000Z",
      notes: null,
      finalized_at: status === "finalized" ? "2026-08-02T08:10:00.000Z" : null,
    },
    sites,
    replayed: false,
    algorithm_versions: {
      data_contract: "anthropometry_data_contract_v2",
      protocol: "anthropometry_protocol_v1",
      representative: status === "finalized" ? "anthropometry_representative_v1" : null,
      repeatability_thresholds:
        status === "finalized" ? "anthropometry_repeatability_thresholds_v1" : null,
    },
  };
}

beforeEach(() => {
  mockSaveDraft.mockReset();
  mockFinalize.mockReset();
  mockDelete.mockReset();
  mockGetProgress.mockReset();
  mockSaveDraft.mockResolvedValue(response());
  mockFinalize.mockResolvedValue(response("finalized", [{
    site_code: "waist",
    readings_cm: [80, 80.8],
    representative_cm: 80.4,
    method: "mean_of_two",
    reading_count: 2,
    initial_pair_difference_cm: 0.8,
    all_readings_range_cm: 0.8,
    quality: "within_repeatability_threshold",
    quality_flags: [],
  }]));
  mockDelete.mockResolvedValue({ deleted_session_id: "session-001" });
  mockGetProgress.mockResolvedValue({
    series: [],
    weight_comparison: null,
    algorithm_versions: {
      change: "anthropometry_change_v1",
      weight_comparison: "anthropometry_weight_comparison_v1",
      weight_trend: "weight_trend_v1",
    },
    limitations: [],
  });
});

async function beginWithSites(codes: AnthropometrySiteCode[]) {
  const user = userEvent.setup();
  render(<Measurements />);
  await user.click(screen.getByRole("button", { name: "Clear" }));
  for (const code of codes) {
    const labels: Record<AnthropometrySiteCode, RegExp> = {
      chest: /^Chest\b/i,
      waist: /^Waist \(WHO midpoint\)/i,
      abdomen_navel: /^Abdomen at navel\b/i,
      hips: /^Hips\b/i,
      left_upper_arm_relaxed: /^Left relaxed upper arm\b/i,
      right_upper_arm_relaxed: /^Right relaxed upper arm\b/i,
      left_mid_thigh: /^Left mid-thigh\b/i,
      right_mid_thigh: /^Right mid-thigh\b/i,
      neck: /^Neck/i,
    };
    await user.click(screen.getByRole("checkbox", { name: labels[code] }));
  }
  await user.click(screen.getByRole("checkbox", { name: /reviewed the preparation/i }));
  await user.click(screen.getByRole("button", { name: new RegExp(`Begin with ${codes.length}`) }));
  await waitFor(() => expect(mockSaveDraft).toHaveBeenCalledTimes(1));
  return user;
}

async function enterReading(user: ReturnType<typeof userEvent.setup>, value: string) {
  const input = screen.getByRole("spinbutton", { name: /Reading \d in/i });
  await user.clear(input);
  await user.type(input, value);
  await user.click(screen.getByRole("button", { name: /save reading and continue/i }));
}

describe("measurement setup", () => {
  it("shows all frozen sites, keeps neck off by default, and separates waist from navel", () => {
    render(<Measurements />);
    expect(screen.getByRole("checkbox", { name: /^Neck/i })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /^Chest\b/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /^Waist \(WHO midpoint\)/i })).toBeChecked();
    expect(screen.getByText(/waist and abdomen at navel are different sites/i)).toBeVisible();
    expect(screen.getByText(/not treated as a clinical waist measurement/i)).toBeVisible();
  });

  it("requires at least one selected site and preparation acknowledgement", async () => {
    const user = userEvent.setup();
    render(<Measurements />);
    await user.click(screen.getByRole("button", { name: "Clear" }));
    await user.click(screen.getByRole("button", { name: /Begin with 0 sites/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/select at least one/i);
    expect(mockSaveDraft).not.toHaveBeenCalled();
  });

  it("loads history only when the history and trends tab is opened", async () => {
    const user = userEvent.setup();
    render(<Measurements />);
    expect(mockGetProgress).not.toHaveBeenCalled();
    await user.click(screen.getByRole("tab", { name: /history & trends/i }));
    expect(await screen.findByRole("heading", { name: /no finalized measurements yet/i })).toBeVisible();
    expect(mockGetProgress).toHaveBeenCalledTimes(1);
  });
});

describe("circuit workflow", () => {
  it("takes first readings for all sites before starting second readings", async () => {
    const user = await beginWithSites(["waist", "hips"]);
    expect(screen.getByRole("heading", { name: "Waist (WHO midpoint)" })).toBeVisible();
    expect(screen.getByText("First circuit")).toBeVisible();

    await enterReading(user, "80.0");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Hips" })).toBeVisible());
    expect(screen.getByText("First circuit")).toBeVisible();

    await enterReading(user, "100.0");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Waist (WHO midpoint)" })).toBeVisible());
    expect(screen.getByText("Second circuit")).toBeVisible();

    await enterReading(user, "80.8");
    await enterReading(user, "100.4");
    await waitFor(() => expect(screen.getByRole("heading", { name: /check your raw readings/i })).toBeVisible());
    expect(mockSaveDraft).toHaveBeenLastCalledWith(expect.objectContaining({
      session_id: "session-001",
      sites: [
        { site_code: "waist", readings_cm: [80, 80.8] },
        { site_code: "hips", readings_cm: [100, 100.4] },
      ],
    }));
  });

  it("requests one neutral resolution reading when the first pair differs by over 1.0 cm", async () => {
    const user = await beginWithSites(["waist"]);
    await enterReading(user, "80.0");
    await enterReading(user, "81.1");
    await waitFor(() => expect(screen.getByText("Resolution circuit")).toBeVisible());
    expect(screen.getByRole("status")).toHaveTextContent(/tape position, posture, breathing/i);
    expect(screen.getByRole("status")).toHaveTextContent(/median of all three/i);
    await enterReading(user, "80.5");
    await waitFor(() => expect(screen.getByRole("heading", { name: /check your raw readings/i })).toBeVisible());
    expect(screen.getByText(/third reading used/i)).toBeVisible();
  });

  it("does not request a third reading at the exact 1.0 cm boundary", async () => {
    const user = await beginWithSites(["waist"]);
    await enterReading(user, "80.0");
    await enterReading(user, "81.0");
    await waitFor(() => expect(screen.getByRole("heading", { name: /check your raw readings/i })).toBeVisible());
    expect(screen.queryByText("Resolution circuit")).not.toBeInTheDocument();
  });

  it("autofocuses the reading field and supports Enter to advance", async () => {
    const user = await beginWithSites(["waist", "hips"]);
    const input = screen.getByRole("spinbutton", { name: /Reading 1 in centimetres/i });
    await waitFor(() => expect(input).toHaveFocus());
    await user.type(input, "80{Enter}");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Hips" })).toBeVisible());
  });

  it("keeps the entered value and announces an API save failure", async () => {
    const user = await beginWithSites(["waist"]);
    mockSaveDraft.mockRejectedValueOnce(new Error("Network unavailable"));
    const input = screen.getByRole("spinbutton", { name: /Reading 1 in centimetres/i });
    await user.type(input, "80");
    await user.click(screen.getByRole("button", { name: /save reading/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Network unavailable"));
    expect(input).toHaveValue(80);
  });
});

describe("units, finalization and deletion", () => {
  it("converts inch entries to canonical centimetres before saving", async () => {
    const user = userEvent.setup();
    render(<Measurements />);
    await user.click(screen.getByRole("button", { name: "Clear" }));
    await user.click(screen.getByRole("checkbox", { name: /^Waist \(WHO midpoint\)/i }));
    await user.click(screen.getByRole("checkbox", { name: /reviewed the preparation/i }));
    await user.click(screen.getByRole("button", { name: "inches" }));
    await user.click(screen.getByRole("button", { name: /Begin with 1 site/i }));
    const input = screen.getByRole("spinbutton", { name: /Reading 1 in inches/i });
    await user.type(input, "31.50");
    expect(screen.getByText(/stored as 80.0 cm/i)).toBeVisible();
    await user.click(screen.getByRole("button", { name: /save reading and continue/i }));
    expect(mockSaveDraft).toHaveBeenLastCalledWith(expect.objectContaining({
      sites: [{ site_code: "waist", readings_cm: [80] }],
    }));
  });

  it("finalizes through the dedicated endpoint and renders server representatives", async () => {
    const user = await beginWithSites(["waist"]);
    await enterReading(user, "80.0");
    await enterReading(user, "80.8");
    await user.type(screen.getByRole("textbox", { name: /Notes/i }), "Morning, before breakfast");
    await user.click(screen.getByRole("button", { name: /Finalize session/i }));
    await waitFor(() => expect(mockFinalize).toHaveBeenCalledTimes(1));
    expect(mockFinalize).toHaveBeenCalledWith(expect.objectContaining({
      session_id: "session-001",
      notes: "Morning, before breakfast",
      idempotency_key: expect.any(String),
      sites: [{ site_code: "waist", readings_cm: [80, 80.8] }],
    }));
    expect(screen.getByRole("heading", { name: /session finalized/i })).toBeVisible();
    expect(screen.getByText("80.4 cm")).toBeVisible();
    expect(screen.getByText(/cannot be edited or reopened/i)).toBeVisible();
  });

  it("requires confirmation before deleting a saved draft", async () => {
    const user = await beginWithSites(["waist"]);
    const discardTrigger = screen.getByRole("button", { name: /Discard draft/i });
    await user.click(discardTrigger);
    let dialog = screen.getByRole("alertdialog", { name: /discard this draft/i });
    expect(dialog).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(discardTrigger).toHaveFocus();
    await user.click(discardTrigger);
    dialog = screen.getByRole("alertdialog", { name: /discard this draft/i });
    await user.click(within(dialog).getByRole("button", { name: /^Discard draft$/i }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("session-001"));
    expect(screen.getByRole("heading", { name: /guided measurement session/i })).toBeVisible();
  });
});
