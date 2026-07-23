// Component tests for GoalPhaseCard and Goals page (smoke + key interactions).
// All network calls are mocked at the callFunction boundary.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import GoalPhaseCard from "../components/GoalPhaseCard";
import Goals from "../pages/Goals";
import { GoalPhase, WeightChange } from "../lib/goalTypes";

vi.mock("../lib/supabase", () => ({ callFunction: vi.fn() }));
import { callFunction } from "../lib/supabase";
const mockCall = vi.mocked(callFunction);

// ── Fixtures ───────────────────────────────────────────────────────────────────

const ACTIVE_PHASE: GoalPhase = {
  id: "phase-001",
  user_id: "user-001",
  mode: "cut",
  status: "active",
  started_at: "2026-07-01T06:00:00Z",
  ended_at: null,
  ended_reason: null,
  starting_weight_kg: 90,
  starting_weight_source: "manual",
  target_weight_kg: 80,
  target_change_kg_per_week: -0.5,
  target_calories: 2000,
  target_protein_g: 160,
  target_carbs_g: 200,
  target_fat_g: 70,
  superseded_by: null,
  created_at: "2026-07-01T06:00:00Z",
  updated_at: "2026-07-01T06:00:00Z",
};

const WEIGHT_CHANGE: WeightChange = {
  starting_weight_kg: 90,
  latest_weight_kg: 88.5,
  change_kg: -1.5,
  days_in_phase: 22,
};

// ── GoalPhaseCard ─────────────────────────────────────────────────────────────

describe("GoalPhaseCard", () => {
  it("renders mode and started date", () => {
    render(
      <MemoryRouter>
        <GoalPhaseCard phase={ACTIVE_PHASE} weightChange={null} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Cut")).toBeInTheDocument();
    expect(screen.getByText(/1 Jul 2026/i)).toBeInTheDocument();
  });

  it("renders calorie target", () => {
    render(
      <MemoryRouter>
        <GoalPhaseCard phase={ACTIVE_PHASE} weightChange={null} />
      </MemoryRouter>,
    );
    expect(screen.getByText("2000")).toBeInTheDocument();
  });

  it("renders observed weight change", () => {
    render(
      <MemoryRouter>
        <GoalPhaseCard phase={ACTIVE_PHASE} weightChange={WEIGHT_CHANGE} />
      </MemoryRouter>,
    );
    expect(screen.getByText("88.5 kg")).toBeInTheDocument();
    expect(screen.getByText(/-1.5 kg in 22d/i)).toBeInTheDocument();
  });

  it("shows 'No weight logged yet' when latest_weight_kg is null", () => {
    const wc: WeightChange = { ...WEIGHT_CHANGE, latest_weight_kg: null, change_kg: null };
    render(
      <MemoryRouter>
        <GoalPhaseCard phase={ACTIVE_PHASE} weightChange={wc} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/no weight logged yet/i)).toBeInTheDocument();
  });

  it("renders a link to /goals", () => {
    render(
      <MemoryRouter>
        <GoalPhaseCard phase={ACTIVE_PHASE} weightChange={null} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: /manage/i })).toHaveAttribute("href", "/goals");
  });
});

// ── Goals page ────────────────────────────────────────────────────────────────

beforeEach(() => { mockCall.mockReset(); });

describe("Goals page — loading and display", () => {
  it("shows active phase after loading", async () => {
    mockCall.mockResolvedValueOnce({
      active_phase: ACTIVE_PHASE,
      phases: [ACTIVE_PHASE],
      total_count: 1,
    });

    render(
      <MemoryRouter>
        <Goals />
      </MemoryRouter>,
    );

    expect(screen.getByText(/loading/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Cut")).toBeInTheDocument();
    });
  });

  it("shows 'No active phase' message when none exists", async () => {
    mockCall.mockResolvedValueOnce({ active_phase: null, phases: [], total_count: 0 });

    render(
      <MemoryRouter>
        <Goals />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/no active phase/i)).toBeInTheDocument();
    });
  });

  it("shows phase history when inactive phases exist", async () => {
    const completed: GoalPhase = {
      ...ACTIVE_PHASE,
      id: "phase-000",
      status: "completed",
      ended_at: "2026-06-30T23:59:00Z",
    };
    mockCall.mockResolvedValueOnce({
      active_phase: null,
      phases: [completed],
      total_count: 1,
    });

    render(
      <MemoryRouter>
        <Goals />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Completed")).toBeInTheDocument();
    });
  });
});

describe("Goals page — start new phase form", () => {
  it("opens the new phase form when 'Start new phase' is clicked", async () => {
    mockCall.mockResolvedValueOnce({ active_phase: null, phases: [], total_count: 0 });

    render(
      <MemoryRouter>
        <Goals />
      </MemoryRouter>,
    );

    await waitFor(() => screen.getByRole("button", { name: /start new phase/i }));
    await userEvent.click(screen.getByRole("button", { name: /start new phase/i }));

    expect(screen.getByRole("button", { name: /start phase/i })).toBeInTheDocument();
  });

  it("shows transition selector when an active phase exists", async () => {
    mockCall.mockResolvedValueOnce({
      active_phase: ACTIVE_PHASE,
      phases: [ACTIVE_PHASE],
      total_count: 1,
    });

    render(
      <MemoryRouter>
        <Goals />
      </MemoryRouter>,
    );

    await waitFor(() => screen.getByRole("button", { name: /start new phase/i }));
    await userEvent.click(screen.getByRole("button", { name: /start new phase/i }));

    expect(screen.getByText(/you have an active phase/i)).toBeInTheDocument();
  });
});
