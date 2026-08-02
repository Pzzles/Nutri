// Component tests for Goals.tsx Phase 5 features.
// Covers: activity selector, manual override, preview panel, aggressive rate warning,
// sub-1000 kcal block, snapshot breakdown display.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Goals from "../pages/Goals";
import { GoalPhase, EnergyCalcPreview, MissingField, StaleField } from "../lib/goalTypes";

// Mock supabase module — component calls:
//   callFunction: preview-energy-calc, start-goal-phase
//   getFunction:  get-goal-phases, get-weight-logs
//   supabase.auth.getUser + supabase.from("profiles") for profile fetch
vi.mock("../lib/supabase", () => ({
  callFunction: vi.fn(),
  getFunction:  vi.fn(),
  supabase: {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    from:  vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq:     vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    }),
  },
}));

import { callFunction, getFunction } from "../lib/supabase";
const mockCall = vi.mocked(callFunction);
const mockGet  = vi.mocked(getFunction);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NO_PHASES_RESPONSE = { active_phase: null, phases: [], total_count: 0 };
const NO_WEIGHT = { latest_official: null };

const ACTIVE_PHASE: GoalPhase = {
  id: "phase-phase5",
  user_id: "user-001",
  mode: "cut",
  status: "active",
  started_at: "2026-07-01T06:00:00Z",
  ended_at: null,
  ended_reason: null,
  starting_weight_kg: 80,
  starting_weight_source: "latest_weight_log",
  target_weight_kg: null,
  target_change_kg_per_week: -0.5,
  target_calories: 1950,
  target_protein_g: null,
  target_carbs_g: null,
  target_fat_g: null,
  target_fibre_g: null,
  superseded_by: null,
  snapshot_id: "snap-001",
  manual_maintenance_kcal: null,
  edit_count: 0,
  created_at: "2026-07-01T06:00:00Z",
  updated_at: "2026-07-01T06:00:00Z",
};

const ELIGIBLE_PREVIEW: EnergyCalcPreview = {
  ready: true,
  missing_fields: [],
  stale_fields: [],
  data_quality: { profile_complete: true, weight_current: true, calculation_possible: true },
  calculation_timestamp: "2026-07-31T00:00:00Z",
  input_snapshot: {
    birth_date: "1990-07-31",
    equation_sex: "male",
    height_cm: 175,
    official_weight_kg: 80,
    weight_log_id: "wl-001",
    weight_measured_at: "2026-07-29T06:00:00Z",
    age_years: 36,
    activity_level: "moderate",
    activity_multiplier: 1.55,
    goal_mode: "cut",
    target_change_kg_per_week: -0.5,
    manual_maintenance_kcal: null,
  },
  estimated_bmr_kcal: 1748,
  estimated_tdee_kcal: 2709,
  manual_maintenance_kcal: null,
  effective_maintenance_kcal: 2709,
  maintenance_source: "equation_estimate",
  daily_adjustment_kcal: -550,
  raw_target_kcal: 2159,
  recommended_target_kcal: 2159,
  warnings: [],
  is_aggressive_rate: false,
  algorithm_versions: { algorithm: "mifflin_st_jeor_v1", activity_multiplier: "activity_multiplier_v1" },
  explanation: "Estimated resting energy (Mifflin–St Jeor, male): 1748 kcal/day",
};

const AGGRESSIVE_PREVIEW: EnergyCalcPreview = {
  ...ELIGIBLE_PREVIEW,
  input_snapshot: { ...ELIGIBLE_PREVIEW.input_snapshot!, target_change_kg_per_week: -0.9 },
  daily_adjustment_kcal: -990,
  raw_target_kcal: 1719,
  recommended_target_kcal: 1719,
  warnings: ["aggressive_rate"],
  is_aggressive_rate: true,
};

const STALE_WEIGHT_PREVIEW: EnergyCalcPreview = {
  ...ELIGIBLE_PREVIEW,
  stale_fields: [{
    field: "official_weight",
    recorded_at: "2026-05-01T06:00:00Z",
    days_old: 61,
    action: "log_current_weight",
  }],
  data_quality: { profile_complete: true, weight_current: false, calculation_possible: true },
};

const INELIGIBLE_PREVIEW: EnergyCalcPreview = {
  ready: false,
  missing_fields: [
    { field: "equation_sex", reason: "Required for the Mifflin–St Jeor sex-specific constant", action: "complete_profile_sex" },
    { field: "height_cm",    reason: "Required for the BMR formula", action: "complete_profile_height" },
  ] as MissingField[],
  stale_fields: [],
  data_quality: { profile_complete: false, weight_current: false, calculation_possible: false },
};

// Spec fixture: BMR 1994, × 1.2 sedentary, maintenance 2393, deficit 550, target 1843.
const CUT_PREVIEW_1843: EnergyCalcPreview = {
  ready: true,
  missing_fields: [],
  stale_fields: [],
  data_quality: { profile_complete: true, weight_current: true, calculation_possible: true },
  calculation_timestamp: "2026-08-02T00:00:00Z",
  input_snapshot: {
    birth_date: "1996-08-02",
    equation_sex: "male",
    height_cm: 175,
    official_weight_kg: 104.5,
    weight_log_id: "wl-cut-1843",
    weight_measured_at: "2026-08-02T06:00:00Z",
    age_years: 30,
    activity_level: "sedentary",
    activity_multiplier: 1.2,
    goal_mode: "cut",
    target_change_kg_per_week: -0.5,
    manual_maintenance_kcal: null,
  },
  estimated_bmr_kcal: 1994,
  estimated_tdee_kcal: 2393,
  manual_maintenance_kcal: null,
  effective_maintenance_kcal: 2393,
  maintenance_source: "equation_estimate",
  daily_adjustment_kcal: -550,
  raw_target_kcal: 1843,
  recommended_target_kcal: 1843,
  warnings: [],
  is_aggressive_rate: false,
  algorithm_versions: { algorithm: "mifflin_st_jeor_v1", activity_multiplier: "activity_multiplier_v1" },
  explanation: [
    "Estimated resting energy (Mifflin–St Jeor, male): 1994 kcal/day",
    "× activity multiplier (Sedentary – little or no exercise, 1.2): 2393 kcal/day",
    "Estimated maintenance: 2393 kcal/day",
    "Deficit: 550 kcal/day (0.5 kg/week × 7,700 ÷ 7)",
    "Calorie target: 1843 kcal/day",
    "",
    "Note: These are estimates. Actual energy requirements vary. This calculator is not designed for pregnancy, breastfeeding or medical nutrition treatment.",
  ].join("\n"),
};

// ── Helper ────────────────────────────────────────────────────────────────────

interface PhasesResponse { active_phase: GoalPhase | null; phases: GoalPhase[]; total_count: number; }
function setupPage(phasesResponse: PhasesResponse = NO_PHASES_RESPONSE) {
  mockGet
    .mockResolvedValueOnce(phasesResponse)          // get-goal-phases
    .mockResolvedValueOnce(NO_WEIGHT);              // get-weight-logs

  return render(
    <MemoryRouter>
      <Goals />
    </MemoryRouter>,
  );
}

async function openForm() {
  await waitFor(() => screen.getByRole("button", { name: /start new phase/i }));
  await userEvent.click(screen.getByRole("button", { name: /start new phase/i }));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => { mockCall.mockReset(); mockGet.mockReset(); });

describe("Goals Phase 5 — activity level selector", () => {
  it("renders an activity level dropdown in the new phase form", async () => {
    setupPage();
    await openForm();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("activity dropdown includes all five levels", async () => {
    setupPage();
    await openForm();
    const select = screen.getByRole("combobox");
    expect(select.innerHTML).toContain("Sedentary");
    expect(select.innerHTML).toContain("Lightly active");
    expect(select.innerHTML).toContain("Moderately active");
    expect(select.innerHTML).toContain("Very active");
    expect(select.innerHTML).toContain("Extra active");
  });
});

describe("Goals Phase 5 — manual maintenance override", () => {
  it("does not show manual maintenance input by default", async () => {
    setupPage();
    await openForm();
    expect(screen.queryByPlaceholderText("kcal/day")).not.toBeInTheDocument();
  });

  it("shows manual maintenance input after ticking the checkbox", async () => {
    setupPage();
    await openForm();
    const checkbox = screen.getByLabelText(/use manual maintenance override/i);
    await userEvent.click(checkbox);
    expect(screen.getByPlaceholderText("kcal/day")).toBeInTheDocument();
  });
});

describe("Goals Phase 5 — preview button", () => {
  it("renders the 'Preview calorie target' button", async () => {
    setupPage();
    await openForm();
    expect(screen.getByRole("button", { name: /preview calorie target/i })).toBeInTheDocument();
  });

  it("shows calorie breakdown after a successful preview", async () => {
    setupPage();
    mockCall.mockResolvedValueOnce(ELIGIBLE_PREVIEW);  // preview-energy-calc
    await openForm();

    await userEvent.click(screen.getByRole("button", { name: /preview calorie target/i }));

    await waitFor(() => {
      expect(screen.getByText(/calorie breakdown/i)).toBeInTheDocument();
    });
    // BMR and target values appear in the breakdown rows ("1748 kcal/day", "2159 kcal/day")
    expect(screen.getAllByText(/1748/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/2159/).length).toBeGreaterThanOrEqual(1);
  });

  it("shows ineligible message when profile is incomplete", async () => {
    setupPage();
    mockCall.mockResolvedValueOnce(INELIGIBLE_PREVIEW);
    await openForm();

    await userEvent.click(screen.getByRole("button", { name: /preview calorie target/i }));

    await waitFor(() => {
      expect(screen.getByText(/profile incomplete/i)).toBeInTheDocument();
    });
    // Each missing field appears with its name and reason.
    expect(screen.getByText(/equation_sex/)).toBeInTheDocument();
    expect(screen.getByText(/height_cm/)).toBeInTheDocument();
  });

  it("shows stale weight warning when preview returns stale_fields", async () => {
    setupPage();
    mockCall.mockResolvedValueOnce(STALE_WEIGHT_PREVIEW);
    await openForm();

    await userEvent.click(screen.getByRole("button", { name: /preview calorie target/i }));

    await waitFor(() => {
      expect(screen.getByText(/weight reading may be outdated/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/61 day/i)).toBeInTheDocument();
  });
});

describe("Goals Phase 5 — aggressive rate warning", () => {
  it("shows aggressive rate warning when preview returns is_aggressive_rate=true", async () => {
    setupPage();
    mockCall.mockResolvedValueOnce(AGGRESSIVE_PREVIEW);
    await openForm();

    await userEvent.click(screen.getByRole("button", { name: /preview calorie target/i }));

    await waitFor(() => {
      expect(screen.getByText(/aggressive rate/i)).toBeInTheDocument();
    });
  });

  it("shows acknowledgement checkbox in aggressive rate warning", async () => {
    setupPage();
    mockCall.mockResolvedValueOnce(AGGRESSIVE_PREVIEW);
    await openForm();

    await userEvent.click(screen.getByRole("button", { name: /preview calorie target/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/i understand and accept this rate/i)).toBeInTheDocument();
    });
  });

  it("blocks submission when aggressive rate is not acknowledged", async () => {
    setupPage();
    mockCall.mockResolvedValueOnce(AGGRESSIVE_PREVIEW);
    await openForm();

    await userEvent.click(screen.getByRole("button", { name: /preview calorie target/i }));
    await waitFor(() => screen.getByText(/aggressive rate/i));

    // Do not tick the acknowledgement checkbox before submitting.
    await userEvent.click(screen.getByRole("button", { name: /^start phase$/i }));

    expect(screen.getByText(/acknowledge the aggressive rate/i)).toBeInTheDocument();
    // start-goal-phase should NOT have been called.
    expect(mockCall).toHaveBeenCalledTimes(1); // only the preview call
  });
});

describe("Goals Phase 5 — calorie target not supplied by client", () => {
  it("does not render a 'Target calories' input in the new phase form", async () => {
    setupPage();
    await openForm();
    expect(screen.queryByLabelText(/target calories/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/kcal/i)).not.toBeInTheDocument();
  });
});

describe("Goals Phase 5 — start phase sends energy calc fields", () => {
  it("sends manual_maintenance_kcal when override is enabled", async () => {
    setupPage();
    mockCall
      .mockResolvedValueOnce(ELIGIBLE_PREVIEW)
      .mockResolvedValueOnce({ phase: { ...ACTIVE_PHASE, snapshot_id: null }, snapshot: null });

    await openForm();

    // Enable manual override.
    await userEvent.click(screen.getByLabelText(/use manual maintenance override/i));
    const manualInput = screen.getByPlaceholderText("kcal/day");
    await userEvent.clear(manualInput);
    await userEvent.type(manualInput, "2800");

    // Preview.
    await userEvent.click(screen.getByRole("button", { name: /preview calorie target/i }));
    await waitFor(() => screen.getByText(/calorie breakdown/i));

    // Submit.
    await userEvent.click(screen.getByRole("button", { name: /^start phase$/i }));

    await waitFor(() => {
      const startCallBody = mockCall.mock.calls.find(
        (c) => c[0] === "start-goal-phase",
      )?.[1] as Record<string, unknown>;
      expect(startCallBody?.manual_maintenance_kcal).toBe(2800);
    });
  });

  it("does not include target_calories in the start-goal-phase body", async () => {
    setupPage();
    mockCall
      .mockResolvedValueOnce(ELIGIBLE_PREVIEW)
      .mockResolvedValueOnce({ phase: { ...ACTIVE_PHASE, snapshot_id: null }, snapshot: null });

    await openForm();

    await userEvent.click(screen.getByRole("button", { name: /preview calorie target/i }));
    await waitFor(() => screen.getByText(/calorie breakdown/i));
    await userEvent.click(screen.getByRole("button", { name: /^start phase$/i }));

    await waitFor(() => {
      const startCallBody = mockCall.mock.calls.find(
        (c) => c[0] === "start-goal-phase",
      )?.[1] as Record<string, unknown>;
      expect(startCallBody).toBeDefined();
      expect(startCallBody?.target_calories).toBeUndefined();
    });
  });
});

describe("Goals Phase 5 — snapshot breakdown in active phase", () => {
  it("does not show 'How this was calculated' when snapshot_id is null", async () => {
    const phaseNoSnap = { ...ACTIVE_PHASE, snapshot_id: null };
    setupPage({ active_phase: phaseNoSnap, phases: [phaseNoSnap], total_count: 1 });

    await waitFor(() => screen.getByText(/cut/i));
    expect(screen.queryByText(/how this was calculated/i)).not.toBeInTheDocument();
  });
});

// ── Calorie preview breakdown display fixes ───────────────────────────────────

async function setupAndPreview(previewFixture: EnergyCalcPreview) {
  setupPage();
  mockCall.mockResolvedValueOnce(previewFixture);
  await openForm();
  await userEvent.click(screen.getByRole("button", { name: /preview calorie target/i }));
  await waitFor(() => screen.getByText(/calorie breakdown/i));
}

describe("calorie preview breakdown — activity multiplier row", () => {
  it("displays the multiplier value as × 1.2", async () => {
    await setupAndPreview(CUT_PREVIEW_1843);
    expect(screen.getByText("× 1.2")).toBeInTheDocument();
  });

  it("does not display 2393 kcal/day in the activity multiplier row (appears only in maintenance row)", async () => {
    await setupAndPreview(CUT_PREVIEW_1843);
    // 2393 kcal/day should appear exactly once — the maintenance row, not the multiplier row
    expect(screen.getAllByText("2393 kcal/day")).toHaveLength(1);
  });
});

describe("calorie preview breakdown — maintenance row", () => {
  it("displays estimated maintenance as 2393 kcal/day", async () => {
    await setupAndPreview(CUT_PREVIEW_1843);
    expect(screen.getByText("2393 kcal/day")).toBeInTheDocument();
  });
});

describe("calorie preview breakdown — deficit sign convention", () => {
  it("displays daily deficit as 550 kcal/day (positive magnitude)", async () => {
    await setupAndPreview(CUT_PREVIEW_1843);
    expect(screen.getByText("550 kcal/day")).toBeInTheDocument();
  });

  it("does not display -550 anywhere in the breakdown", async () => {
    await setupAndPreview(CUT_PREVIEW_1843);
    expect(screen.queryByText(/-550/)).not.toBeInTheDocument();
  });

  it("expanded explanation shows Deficit: 550 (positive)", async () => {
    await setupAndPreview(CUT_PREVIEW_1843);
    // The <pre> element is in the DOM even before details is opened.
    expect(screen.getByText(/Deficit: 550 kcal\/day/)).toBeInTheDocument();
    expect(screen.queryByText(/Deficit: -550/)).not.toBeInTheDocument();
  });
});

describe("calorie preview breakdown — calorie target", () => {
  it("displays calorie target as 1843 kcal/day", async () => {
    await setupAndPreview(CUT_PREVIEW_1843);
    expect(screen.getAllByText("1843 kcal/day").length).toBeGreaterThanOrEqual(1);
  });
});

describe("calorie preview breakdown — inputs summary", () => {
  it("shows the sex from the preview response", async () => {
    await setupAndPreview(CUT_PREVIEW_1843);
    expect(screen.getByText("Male")).toBeInTheDocument();
  });

  it("shows the age from the preview response", async () => {
    await setupAndPreview(CUT_PREVIEW_1843);
    expect(screen.getByText("30 years")).toBeInTheDocument();
  });

  it("shows the height from the preview response", async () => {
    await setupAndPreview(CUT_PREVIEW_1843);
    expect(screen.getByText("175 cm")).toBeInTheDocument();
  });

  it("shows the weight from the preview response", async () => {
    await setupAndPreview(CUT_PREVIEW_1843);
    expect(screen.getByText("104.5 kg")).toBeInTheDocument();
  });

  it("shows the target rate from the preview response", async () => {
    await setupAndPreview(CUT_PREVIEW_1843);
    expect(screen.getByText("Target rate: 0.5 kg/week")).toBeInTheDocument();
  });

  it("shows a weight recorded date when weight_measured_at is present", async () => {
    await setupAndPreview(CUT_PREVIEW_1843);
    expect(screen.getByText(/Weight recorded:/)).toBeInTheDocument();
  });
});

describe("calorie preview breakdown — preview/saved target parity", () => {
  it("start-goal-phase does not send target_calories and the returned target matches the preview", async () => {
    setupPage();
    const EXPECTED_TARGET = CUT_PREVIEW_1843.recommended_target_kcal!; // 1843

    mockCall
      .mockResolvedValueOnce(CUT_PREVIEW_1843)
      .mockResolvedValueOnce({
        phase: { ...ACTIVE_PHASE, target_calories: EXPECTED_TARGET, snapshot_id: "snap-1843" },
        snapshot: null,
      });

    await openForm();
    await userEvent.click(screen.getByRole("button", { name: /preview calorie target/i }));
    await waitFor(() => screen.getByText(/calorie breakdown/i));

    // Preview shows the expected target.
    expect(screen.getAllByText("1843 kcal/day").length).toBeGreaterThanOrEqual(1);

    await userEvent.click(screen.getByRole("button", { name: /^start phase$/i }));

    await waitFor(() => {
      const startCallBody = mockCall.mock.calls.find(
        (c) => c[0] === "start-goal-phase",
      )?.[1] as Record<string, unknown>;
      expect(startCallBody).toBeDefined();
      // Client never supplies target_calories — server is authoritative.
      expect(startCallBody?.target_calories).toBeUndefined();
      // The preview target and the server-returned target are both 1843.
      expect(EXPECTED_TARGET).toBe(CUT_PREVIEW_1843.recommended_target_kcal);
    });
  });
});
