// Tests for the weight-trend frontend: API client types, component rendering,
// and status/state behaviour.
//
// Mocking the API is acceptable for isolated component tests (spec § 19).
// Do NOT mock the calculation mathematics — the backend owns them.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import WeightLogPage from "../pages/WeightLog";
import type { WeightTrendResponse, TrendPoint, WeeklyRate } from "../lib/weightTrend";
import type { WeightLog } from "../lib/weightTypes";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("../lib/weightTrend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/weightTrend")>();
  return {
    ...actual,               // keep real formatters
    getWeightTrend: vi.fn(), // override only the API call
  };
});

vi.mock("../lib/supabase", () => ({
  callFunction: vi.fn(),
  getFunction: vi.fn(),
}));

import { getWeightTrend } from "../lib/weightTrend";
import { callFunction, getFunction } from "../lib/supabase";
const mockGetTrend = vi.mocked(getWeightTrend);
const mockCall = vi.mocked(callFunction);
const mockGet = vi.mocked(getFunction);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const WEIGHT_LOG: WeightLog = {
  id: "wl-001",
  user_id: "u-001",
  weight_kg: 102.6,
  measured_at: "2026-07-31T05:00:00Z",
  logged_date: "2026-07-31",
  is_official: true,
  notes: null,
  source: null,
  created_at: "2026-07-31T05:00:00Z",
};

function makeTrendPoint(overrides: Partial<TrendPoint> = {}): TrendPoint {
  return {
    local_date: "2026-07-31",
    measured_at: "2026-07-31T05:00:00Z",
    raw_weight_kg: 102.6,
    trend_weight_kg: 103.55,
    alpha: 0.35,
    delta_t_days: 1.0,
    huber_capped: false,
    ...overrides,
  };
}

const RATE_USABLE: WeeklyRate = {
  estimate_kg: -0.700426,
  lower_kg: -0.816667,
  upper_kg: -0.6125,
  bootstrap_lower_kg: null,
  bootstrap_upper_kg: null,
};

function makeUsableResponse(overrides: Partial<WeightTrendResponse> = {}): WeightTrendResponse {
  return {
    status: "usable",
    algorithm_versions: {
      daily_representative: "weight_daily_representative_v1",
      smoothing: "weight_time_ewma_v3",
      rate: "weight_rate_theil_sen_v1",
      interval: "weight_rate_interval_sen_v1",
      confidence: "weight_trend_confidence_v1",
    },
    timezone: "Africa/Johannesburg",
    window: {
      start: "2026-07-04T05:00:00Z",
      end: "2026-07-31T05:00:00Z",
      elapsed_days: 27.0,
      inclusive_calendar_days: 28,
    },
    measurements: {
      raw_count: 26,
      valid_count: 26,
      distinct_modelling_days: 24,
      excluded_count: 0,
      latest_measured_at: "2026-07-31T05:00:00Z",
      largest_gap_days: 2.0,
      selected_rate_window_days: 28,
    },
    latest_raw_weight_kg: 102.6,
    latest_trend_weight_kg: 103.545921,
    weekly_rate: RATE_USABLE,
    confidence: "high",
    warnings: [],
    daily_representatives: [],
    trend_points: [makeTrendPoint()],
    flagged_measurements: [],
    ols_diagnostic: null,
    ...overrides,
  };
}

function makeLogsResponse(logs: WeightLog[] = [WEIGHT_LOG], latest: WeightLog | null = WEIGHT_LOG) {
  return { logs, latest_official: latest };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <WeightLogPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  // Default logs response — one entry
  mockGet.mockResolvedValue(makeLogsResponse());
});

// ── Contract shape test (frozen fixture A) ────────────────────────────────────

describe("WeightTrendResponse contract shape", () => {
  it("fixture A matches expected type shape", () => {
    const resp = makeUsableResponse();

    // Required top-level fields
    expect(typeof resp.status).toBe("string");
    expect(typeof resp.confidence).toBe("string");
    expect(typeof resp.timezone).toBe("string");
    expect(Array.isArray(resp.trend_points)).toBe(true);
    expect(Array.isArray(resp.warnings)).toBe(true);
    expect(Array.isArray(resp.daily_representatives)).toBe(true);
    expect(Array.isArray(resp.flagged_measurements)).toBe(true);

    // measurements sub-object
    const m = resp.measurements;
    expect(typeof m.raw_count).toBe("number");
    expect(typeof m.distinct_modelling_days).toBe("number");
    expect(typeof m.largest_gap_days).toBe("number");

    // weekly_rate sub-object
    const rate = resp.weekly_rate!;
    expect(typeof rate.estimate_kg).toBe("number");
    // lower_kg and upper_kg are plausibility range, not 95% CI
    expect(rate.lower_kg).not.toBeNull();
    expect(rate.upper_kg).not.toBeNull();

    // algorithm_versions
    const av = resp.algorithm_versions;
    expect(av.smoothing).toBe("weight_time_ewma_v3");
    expect(av.rate).toBe("weight_rate_theil_sen_v1");
  });

  it("fixture A frozen values: latest_raw=102.6, trend~103.55, rate~-0.70", () => {
    const resp = makeUsableResponse();
    expect(resp.latest_raw_weight_kg).toBe(102.6);
    expect(resp.latest_trend_weight_kg).toBeCloseTo(103.545921, 3);
    expect(resp.weekly_rate!.estimate_kg).toBeCloseTo(-0.700426, 3);
    expect(resp.weekly_rate!.lower_kg).toBeCloseTo(-0.816667, 3);
    expect(resp.weekly_rate!.upper_kg).toBeCloseTo(-0.6125, 3);
  });
});

// ── API loading state ─────────────────────────────────────────────────────────

describe("API loading state", () => {
  it("shows loading skeleton while trend is pending", async () => {
    mockGetTrend.mockReturnValue(new Promise(() => {})); // never resolves
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("trend-loading-skeleton")).toBeInTheDocument(),
    );
  });

  it("removes skeleton when trend resolves", async () => {
    mockGetTrend.mockResolvedValue(makeUsableResponse());
    renderPage();
    await waitFor(() =>
      expect(screen.queryByTestId("trend-loading-skeleton")).not.toBeInTheDocument(),
    );
  });
});

// ── Successful usable response ────────────────────────────────────────────────

describe("usable trend response", () => {
  beforeEach(() => {
    // Use 2 trend points so the chart condition (>= 2) is satisfied.
    mockGetTrend.mockResolvedValue(makeUsableResponse({
      trend_points: [
        makeTrendPoint({ measured_at: "2026-07-30T07:00:00Z", local_date: "2026-07-30" }),
        makeTrendPoint({ measured_at: "2026-07-31T07:00:00Z", local_date: "2026-07-31" }),
      ],
    }));
  });

  it("shows latest raw weight", async () => {
    renderPage();
    // 102.6 appears in header, sr-only, TrendSummary, and history list.
    await waitFor(() =>
      expect(screen.getAllByText(/102\.6/).length).toBeGreaterThanOrEqual(1),
    );
  });

  it("shows trend weight", async () => {
    renderPage();
    // 103.5 appears in TrendSummary and sr-only — use getAllByText.
    await waitFor(() =>
      expect(screen.getAllByText(/103\.5/).length).toBeGreaterThanOrEqual(1),
    );
  });

  it("shows estimated change as −0.70 kg/week", async () => {
    renderPage();
    // Rate appears in TrendSummary and sr-only — use getAllByText.
    await waitFor(() =>
      expect(screen.getAllByText(/−0\.70 kg\/week/).length).toBeGreaterThanOrEqual(1),
    );
  });

  it("shows estimated uncertainty range", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/−0\.82 to −0\.61 kg\/week/)).toBeInTheDocument(),
    );
  });

  it("shows High confidence badge", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/High confidence/i)).toBeInTheDocument(),
    );
  });

  it("shows the chart", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("weight-trend-chart")).toBeInTheDocument(),
    );
  });

  it("does NOT show status message for usable status", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText(/More data needed|Provisional|Stale/i)).not.toBeInTheDocument(),
    );
  });
});

// ── Empty history ─────────────────────────────────────────────────────────────

describe("empty weight history", () => {
  beforeEach(() => {
    mockGet.mockResolvedValue({ logs: [], latest_official: null });
    mockGetTrend.mockResolvedValue(
      makeUsableResponse({ status: "insufficient_measurements", weekly_rate: null }),
    );
  });

  it("shows empty state message", async () => {
    renderPage();
    // "No weight entries yet" appears in the empty card AND the history section.
    await waitFor(() =>
      expect(screen.getAllByText(/No weight entries yet/i).length).toBeGreaterThanOrEqual(1),
    );
  });

  it("does NOT show a broken chart", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.queryByTestId("weight-trend-chart")).not.toBeInTheDocument(),
    );
  });

  it("does NOT show a weekly rate", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText(/kg\/week/i)).not.toBeInTheDocument(),
    );
  });
});

// ── Status: insufficient_measurements ────────────────────────────────────────

describe("insufficient_measurements status", () => {
  beforeEach(() => {
    mockGetTrend.mockResolvedValue(
      makeUsableResponse({
        status: "insufficient_measurements",
        weekly_rate: null,
        confidence: "low",
      }),
    );
  });

  it("shows an explanatory message without demanding daily weighing", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/More distinct measurement days/i)).toBeInTheDocument(),
    );
    // Must NOT frame it as a failure requiring daily weighing
    expect(screen.queryByText(/missed.*daily weigh-in/i)).not.toBeInTheDocument();
  });

  it("does not show a weekly rate", async () => {
    renderPage();
    await waitFor(() => screen.getByText(/More distinct measurement days/i));
    expect(screen.queryByText(/kg\/week/i)).not.toBeInTheDocument();
  });
});

// ── Status: insufficient_coverage ────────────────────────────────────────────

describe("insufficient_coverage status", () => {
  it("explains coverage is building up", async () => {
    mockGetTrend.mockResolvedValue(
      makeUsableResponse({ status: "insufficient_coverage", weekly_rate: null }),
    );
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/enough calendar time/i)).toBeInTheDocument(),
    );
  });
});

// ── Status: provisional ───────────────────────────────────────────────────────

describe("provisional status", () => {
  it("shows provisional label", async () => {
    mockGetTrend.mockResolvedValue(
      makeUsableResponse({ status: "provisional", confidence: "low" }),
    );
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/Provisional estimate/i)).toBeInTheDocument(),
    );
  });
});

// ── Status: stale ─────────────────────────────────────────────────────────────

describe("stale status", () => {
  it("shows stale explanation", async () => {
    mockGetTrend.mockResolvedValue(
      makeUsableResponse({ status: "stale", confidence: "low" }),
    );
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/Stale data/i)).toBeInTheDocument(),
    );
  });

  it("keeps historical data visible", async () => {
    mockGetTrend.mockResolvedValue(
      makeUsableResponse({ status: "stale", latest_raw_weight_kg: 102.6 }),
    );
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/Stale data/i)).toBeInTheDocument(),
    );
    // trend weight appears in TrendSummary and sr-only — use getAllByText.
    expect(screen.getAllByText(/103\.5/).length).toBeGreaterThanOrEqual(1);
  });
});

// ── 56-day rate window explanation ────────────────────────────────────────────

describe("56-day adaptive rate window", () => {
  it("shows the extended window explanation", async () => {
    mockGetTrend.mockResolvedValue(
      makeUsableResponse({
        measurements: {
          raw_count: 8,
          valid_count: 8,
          distinct_modelling_days: 8,
          excluded_count: 0,
          latest_measured_at: "2026-07-31T05:00:00Z",
          largest_gap_days: 6.0,
          selected_rate_window_days: 56,
        },
      }),
    );
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/56 days because fewer measurements/i)).toBeInTheDocument(),
    );
  });
});

// ── 84-day sparse rate window explanation ─────────────────────────────────────

describe("84-day sparse rate window", () => {
  it("explains 84-day window without framing it as failure", async () => {
    mockGetTrend.mockResolvedValue(
      makeUsableResponse({
        measurements: {
          raw_count: 12,
          valid_count: 12,
          distinct_modelling_days: 12,
          excluded_count: 0,
          latest_measured_at: "2026-07-31T05:00:00Z",
          largest_gap_days: 7.0,
          selected_rate_window_days: 84,
        },
      }),
    );
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/84 days because fewer measurements/i)).toBeInTheDocument(),
    );
    // Must not be labelled as failure
    expect(screen.queryByText(/failed|error|problem/i)).not.toBeInTheDocument();
  });
});

// ── Confidence levels ─────────────────────────────────────────────────────────

describe("confidence levels", () => {
  it.each([
    ["high", /High confidence/i],
    ["medium", /Medium confidence/i],
    ["low", /Low confidence/i],
  ] as const)("%s confidence shows badge", async (confidence, pattern) => {
    mockGetTrend.mockResolvedValue(makeUsableResponse({ confidence }));
    renderPage();
    await waitFor(() => expect(screen.getByText(pattern)).toBeInTheDocument());
  });
});

// ── Rate direction ────────────────────────────────────────────────────────────

describe("weekly rate direction", () => {
  it("shows decreasing for negative rate", async () => {
    mockGetTrend.mockResolvedValue(
      makeUsableResponse({ weekly_rate: { ...RATE_USABLE, estimate_kg: -0.70 } }),
    );
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/decreasing/i)).toBeInTheDocument(),
    );
  });

  it("shows increasing for positive rate", async () => {
    mockGetTrend.mockResolvedValue(
      makeUsableResponse({
        weekly_rate: { estimate_kg: 0.35, lower_kg: 0.1, upper_kg: 0.6, bootstrap_lower_kg: null, bootstrap_upper_kg: null },
      }),
    );
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/increasing/i)).toBeInTheDocument(),
    );
    // Rate appears in TrendSummary and sr-only — use getAllByText.
    expect(screen.getAllByText(/\+0\.35 kg\/week/).length).toBeGreaterThanOrEqual(1);
  });

  it("shows null rate (no kg/week text)", async () => {
    mockGetTrend.mockResolvedValue(
      makeUsableResponse({ status: "insufficient_measurements", weekly_rate: null }),
    );
    renderPage();
    await waitFor(() => screen.getByText(/More data needed/i));
    expect(screen.queryByText(/kg\/week/i)).not.toBeInTheDocument();
  });
});

// ── Uncertainty range wording ─────────────────────────────────────────────────

describe("estimated uncertainty range", () => {
  it("shows 'Estimated range' not '95% confidence interval'", async () => {
    mockGetTrend.mockResolvedValue(makeUsableResponse());
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/Estimated range/i)).toBeInTheDocument(),
    );
    // HowCalculated says "NOT a guaranteed 95% confidence interval" — anchor
    // the check to avoid matching that explanatory prose.
    expect(screen.queryByText(/^95% confidence interval$/i)).not.toBeInTheDocument();
  });

  it("range is absent when lower/upper are null", async () => {
    mockGetTrend.mockResolvedValue(
      makeUsableResponse({
        weekly_rate: { estimate_kg: -0.5, lower_kg: null, upper_kg: null, bootstrap_lower_kg: null, bootstrap_upper_kg: null },
      }),
    );
    renderPage();
    // Rate appears in TrendSummary and sr-only — use getAllByText.
    await waitFor(() => expect(screen.getAllByText(/−0\.50 kg\/week/).length).toBeGreaterThanOrEqual(1));
    expect(screen.queryByText(/Estimated range/i)).not.toBeInTheDocument();
  });
});

// ── Invalid timezone error ────────────────────────────────────────────────────

describe("invalid profile timezone error", () => {
  it("shows timezone configuration message", async () => {
    const { TrendError } = await import("../lib/weightTrend");
    mockGetTrend.mockRejectedValue(
      new TrendError("INVALID_PROFILE_TIMEZONE", "Your profile has an unrecognised timezone."),
    );
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/Timezone configuration issue/i)).toBeInTheDocument(),
    );
  });
});

// ── Retryable backend error ───────────────────────────────────────────────────

describe("retryable backend error", () => {
  it("shows retry action and re-fetches on click", async () => {
    const { TrendError } = await import("../lib/weightTrend");
    mockGetTrend
      .mockRejectedValueOnce(new TrendError("BACKEND_ERROR", "Server error"))
      .mockResolvedValueOnce(makeUsableResponse());

    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/Trend unavailable/i)).toBeInTheDocument(),
    );

    const retryBtn = screen.getByRole("button", { name: /try again/i });
    fireEvent.click(retryBtn);

    await waitFor(() =>
      expect(screen.queryByText(/Trend unavailable/i)).not.toBeInTheDocument(),
    );
  });
});

// ── Raw and trend series are separate ────────────────────────────────────────

describe("raw and trend series", () => {
  it("chart renders with multiple raw logs and trend points", async () => {
    const logs: WeightLog[] = [
      { ...WEIGHT_LOG, id: "wl-1", measured_at: "2026-07-30T07:00:00Z" },
      { ...WEIGHT_LOG, id: "wl-2", measured_at: "2026-07-31T07:00:00Z" },
    ];
    mockGet.mockResolvedValue({ logs, latest_official: logs[1] });
    mockGetTrend.mockResolvedValue(makeUsableResponse({
      trend_points: [
        makeTrendPoint({ measured_at: "2026-07-30T07:00:00Z", local_date: "2026-07-30" }),
        makeTrendPoint({ measured_at: "2026-07-31T07:00:00Z", local_date: "2026-07-31" }),
      ],
    }));
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("weight-trend-chart")).toBeInTheDocument(),
    );
  });
});

// ── Same-day raw dots preserved ───────────────────────────────────────────────

describe("same-day raw dots preserved", () => {
  it("shows chart when day has official and non-official reading", async () => {
    const logs: WeightLog[] = [
      { ...WEIGHT_LOG, id: "wl-1", measured_at: "2026-07-31T07:00:00Z", is_official: true },
      { ...WEIGHT_LOG, id: "wl-2", measured_at: "2026-07-31T19:00:00Z", is_official: false, weight_kg: 104.1 },
    ];
    mockGet.mockResolvedValue({ logs, latest_official: logs[0] });
    mockGetTrend.mockResolvedValue(makeUsableResponse({
      trend_points: [
        makeTrendPoint({ measured_at: "2026-07-31T07:00:00Z" }),
      ],
    }));
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("weight-trend-chart")).toBeInTheDocument(),
    );
  });
});

// ── No client-side calculation fallback ──────────────────────────────────────

describe("no client-side calculation fallback", () => {
  it("does not calculate a trend locally when API fails", async () => {
    const { TrendError } = await import("../lib/weightTrend");
    mockGetTrend.mockRejectedValue(
      new TrendError("BACKEND_ERROR", "Service unavailable"),
    );
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/Trend unavailable/i)).toBeInTheDocument(),
    );
    // TrendSummary not rendered — it has data-testid="trend-summary".
    expect(screen.queryByTestId("trend-summary")).not.toBeInTheDocument();
  });
});

// ── Refresh after logging a weight ───────────────────────────────────────────

describe("refresh after logging a weight", () => {
  it("calls getWeightTrend again after a successful log submission", async () => {
    const newLog: WeightLog = { ...WEIGHT_LOG, id: "wl-new", weight_kg: 101.5 };
    mockGetTrend.mockResolvedValue(makeUsableResponse());
    mockCall.mockResolvedValue(newLog);

    const { getByRole } = renderPage();
    await waitFor(() => getByRole("button", { name: /^log$/i }));

    // Submit a new weight
    fireEvent.change(getByRole("spinbutton", { name: /weight/i }), {
      target: { value: "101.5" },
    });
    fireEvent.click(getByRole("button", { name: /^log$/i }));

    // getWeightTrend should be called again (once on mount + once after log)
    await waitFor(() =>
      expect(mockGetTrend).toHaveBeenCalledTimes(2),
    );
  });
});

// ── Response contract mismatch ────────────────────────────────────────────────

describe("response contract mismatch", () => {
  it("shows safe error state on malformed response", async () => {
    const { TrendError } = await import("../lib/weightTrend");
    mockGetTrend.mockRejectedValue(
      new TrendError("MALFORMED_RESPONSE", "Response data did not match the expected shape"),
    );
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/Trend unavailable/i)).toBeInTheDocument(),
    );
  });
});
