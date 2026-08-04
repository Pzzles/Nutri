import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnthropometryTrends } from "../components/AnthropometryTrends";
import type { AnthropometryProgressResponse } from "../lib/anthropometry";

vi.mock("../lib/anthropometry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/anthropometry")>();
  return { ...actual, getAnthropometricProgress: vi.fn(), deleteAnthropometrySession: vi.fn() };
});

import { deleteAnthropometrySession, getAnthropometricProgress } from "../lib/anthropometry";

const mockGetProgress = vi.mocked(getAnthropometricProgress);
const mockDeleteSession = vi.mocked(deleteAnthropometrySession);

const RESPONSE: AnthropometryProgressResponse = {
  series: [
    {
      site_code: "waist",
      points: [
        { session_id: "w1", site_code: "waist", measured_at: "2026-06-01T06:00:00Z", logged_date: "2026-06-01", representative_cm: 92, quality: "within_repeatability_threshold" },
        { session_id: "w2", site_code: "waist", measured_at: "2026-07-10T06:00:00Z", logged_date: "2026-07-10", representative_cm: 89.8, quality: "repeatability_warning" },
        { session_id: "w3", site_code: "waist", measured_at: "2026-08-01T06:00:00Z", logged_date: "2026-08-01", representative_cm: 88.6, quality: "within_repeatability_threshold" },
      ],
      previous_change: { start_session_id: "w2", end_session_id: "w3", change_cm: -1.2, elapsed_days: 22 },
      since_first_change: { start_session_id: "w1", end_session_id: "w3", change_cm: -3.4, elapsed_days: 61 },
    },
    {
      site_code: "abdomen_navel",
      points: [
        { session_id: "n1", site_code: "abdomen_navel", measured_at: "2026-06-15T06:00:00Z", logged_date: "2026-06-15", representative_cm: 98, quality: "within_repeatability_threshold" },
        { session_id: "n2", site_code: "abdomen_navel", measured_at: "2026-08-01T06:00:00Z", logged_date: "2026-08-01", representative_cm: 97.2, quality: "within_repeatability_threshold" },
      ],
      previous_change: { start_session_id: "n1", end_session_id: "n2", change_cm: -0.8, elapsed_days: 47 },
      since_first_change: { start_session_id: "n1", end_session_id: "n2", change_cm: -0.8, elapsed_days: 47 },
    },
  ],
  weight_comparison: {
    eligible: true,
    site_code: "waist",
    circumference: { start_session_id: "w1", end_session_id: "w3", change_cm: -3.4, direction: "decreased" },
    weight_trend: {
      start_point_measured_at: "2026-06-01T06:00:00Z",
      end_point_measured_at: "2026-08-01T06:00:00Z",
      start_kg: 80.2,
      end_kg: 80.3,
      change_kg: 0.1,
      stable_band_kg: 0.5,
      direction: "broadly_stable",
    },
    description: "Weight trend was broadly stable while waist circumference decreased.",
  },
  algorithm_versions: {
    change: "anthropometry_change_v1",
    weight_comparison: "anthropometry_weight_comparison_v1",
    weight_trend: "weight_trend_v1",
  },
  limitations: [
    "Circumference changes can reflect combinations of fat, muscle, glycogen, fluid, digestion, breathing, posture, and measurement technique.",
    "This feature does not measure body-fat percentage, muscle mass, visceral fat, or body recomposition.",
    "The weight comparison is descriptive and does not alter calorie targets or goal feedback.",
  ],
};

beforeEach(() => {
  mockGetProgress.mockReset();
  mockDeleteSession.mockReset();
  mockGetProgress.mockResolvedValue(RESPONSE);
  mockDeleteSession.mockResolvedValue({ deleted_session_id: "w3" });
});

describe("AnthropometryTrends", () => {
  it("shows latest, previous, and first-baseline changes from actual points", async () => {
    render(<AnthropometryTrends unit="cm" />);
    expect(await screen.findByRole("heading", { name: /circumference trend/i })).toBeVisible();
    expect(screen.getAllByText("88.6 cm")[0]).toBeVisible();
    expect(screen.getByText("−1.2 cm")).toBeVisible();
    expect(screen.getAllByText("−3.4 cm")[0]).toBeVisible();
    expect(screen.getByTestId("anthropometry-chart")).toHaveAccessibleName(/3 recorded points.*no smoothing or interpolated values/i);
    expect(screen.getAllByText(/finalized representative/i)).toHaveLength(3);
  });

  it("renders only the server-authored descriptive comparison and boundaries", async () => {
    render(<AnthropometryTrends unit="cm" />);
    expect(await screen.findByText(RESPONSE.weight_comparison!.description!)).toBeVisible();
    expect(screen.getByText(/canonical Phase 6 weekly-rate uncertainty range/i)).toBeVisible();
    expect(screen.getByText(/does not infer fat loss, muscle gain or body recomposition/i)).toBeVisible();
    expect(screen.getByText(/does not alter targets or goal feedback/i)).toBeVisible();
  });

  it("keeps abdomen at navel distinct and converts display values to inches", async () => {
    const user = userEvent.setup();
    render(<AnthropometryTrends unit="in" />);
    const selector = await screen.findByRole("combobox", { name: /measurement site/i });
    await user.selectOptions(selector, "abdomen_navel");
    expect(screen.getByText(/not the WHO waist measurement/i)).toBeVisible();
    expect(screen.getAllByText("38.3 in")[0]).toBeVisible();
    expect(screen.getAllByText("−0.3 in")).toHaveLength(2);
  });

  it("shows repeatability notes neutrally without removing recorded values", async () => {
    render(<AnthropometryTrends unit="cm" />);
    expect(await screen.findByText("89.8 cm")).toBeVisible();
    expect(screen.getByText(/value retained with a repeatability note/i)).toBeVisible();
  });

  it("confirms whole-session deletion, traps dismissal, and reloads history", async () => {
    const user = userEvent.setup();
    render(<AnthropometryTrends unit="cm" />);
    const triggers = await screen.findAllByRole("button", { name: /delete this session/i });
    await user.click(triggers[0]);
    const dialog = screen.getByRole("alertdialog", { name: /delete this measurement session/i });
    expect(dialog).toHaveTextContent(/including all sites and preserved raw readings/i);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(triggers[0]).toHaveFocus();
    await user.click(triggers[0]);
    await user.click(screen.getByRole("button", { name: /^Delete session$/i }));
    await waitFor(() => expect(mockDeleteSession).toHaveBeenCalledWith("w3"));
    expect(mockGetProgress).toHaveBeenCalledTimes(2);
  });

  it("renders server warning codes as cautions without hiding numeric history", async () => {
    const waist = RESPONSE.series[0];
    mockGetProgress.mockResolvedValue({
      ...RESPONSE,
      series: [{
        ...waist,
        warning_codes: ["protocol_versions_not_comparable"],
        change_summary: {
          latest: {
            session_id: "w3", measured_at: "2026-08-01T06:00:00Z", logged_date: "2026-08-01",
            representative_cm: 88.6, quality: "within_repeatability_threshold",
            protocol_version: "anthropometry_protocol_v1", representative_algorithm_version: "anthropometry_representative_v3",
          },
          previous: {
            from: {
              session_id: "w1", measured_at: "2026-06-01T06:00:00Z", logged_date: "2026-06-01",
              representative_cm: 92, quality: "within_repeatability_threshold",
              protocol_version: "anthropometry_protocol_v1", representative_algorithm_version: "anthropometry_representative_v2",
            },
            change_cm: -3.4,
            elapsed_days: 61,
            direction: "decreasing",
            context_warning_codes: ["meal_timing_differs"],
          },
          baseline: null,
          warning_codes: ["protocol_versions_not_comparable"],
          algorithm_version: "anthropometry_change_summary_v2",
          context_comparison_version: "anthropometry_context_comparison_v1",
          protocol_compatibility_version: "anthropometry_protocol_compatibility_v1",
        },
      }],
    });
    render(<AnthropometryTrends unit="cm" />);
    expect(await screen.findByText(/different protocols and are shown separately/i)).toBeVisible();
    expect(screen.getByText(/sessions were measured under different conditions/i)).toBeVisible();
    expect(screen.getAllByText("88.6 cm")[0]).toBeVisible();
  });

  it("shows v3 quality, eligibility, selected indices, version, and expanded raw readings", async () => {
    mockGetProgress.mockResolvedValue({
      ...RESPONSE,
      series: [{
        site_code: "waist",
        points: [{
          session_id: "v3-low",
          site_code: "waist",
          measured_at: "2026-08-02T06:00:00Z",
          logged_date: "2026-08-02",
          representative_cm: 81,
          quality: "high_variability",
          selected_reading_indices: [1, 2],
          selected_pair_spread_cm: 2,
          warning_codes: ["no_pair_within_repeatability_threshold"],
          eligible_for_interpretation: false,
          algorithm_version: "anthropometry_representative_v3",
          raw_readings: [
            { id: "r1", reading_index: 1, value_cm: 80 },
            { id: "r2", reading_index: 2, value_cm: 82 },
            { id: "r3", reading_index: 3, value_cm: 84.5 },
          ],
        }],
        previous_change: null,
        since_first_change: null,
      }],
      weight_comparison: null,
    });
    const user = userEvent.setup();
    render(<AnthropometryTrends unit="cm" />);
    expect(await screen.findByText(/low confidence; excluded from progress interpretation/i)).toBeVisible();
    await user.click(screen.getByText(/raw readings and calculation provenance/i));
    expect(screen.getByText("1: 80.0 cm · 2: 82.0 cm · 3: 84.5 cm")).toBeVisible();
    expect(screen.getByText("1 and 2")).toBeVisible();
    expect(screen.getByText("anthropometry_representative_v3")).toBeVisible();
    expect(screen.getByText("No")).toBeVisible();
  });

  it("shows both numeric changes without inventing a sentence for a stable-band pattern", async () => {
    mockGetProgress.mockResolvedValue({
      ...RESPONSE,
      weight_comparison: {
        eligible: false,
        site_code: "waist",
        circumference: { start_session_id: "w1", end_session_id: "w3", change_cm: -0.6, direction: "broadly_stable" },
        weight_trend: {
          start_point_measured_at: "2026-06-01T06:00:00Z",
          end_point_measured_at: "2026-08-01T06:00:00Z",
          start_kg: 100,
          end_kg: 100.4,
          change_kg: 0.4,
          stable_band_kg: 0.5,
          direction: "broadly_stable",
        },
        description: null,
        reason_codes: ["no_material_cross_signal_template"],
      },
    });
    render(<AnthropometryTrends unit="cm" />);
    expect(await screen.findByText(/no versioned descriptive sentence/i)).toBeVisible();
    expect(screen.getByText("−0.6 cm")).toBeVisible();
    expect(screen.getByText("+0.4 kg")).toBeVisible();
    expect(screen.queryByText(/while waist circumference/i)).not.toBeInTheDocument();
  });

  it("keeps an empty history empty rather than displaying zero", async () => {
    mockGetProgress.mockResolvedValue({ ...RESPONSE, series: [], weight_comparison: null });
    render(<AnthropometryTrends unit="cm" />);
    expect(await screen.findByRole("heading", { name: /no finalized measurements yet/i })).toBeVisible();
    expect(screen.getByText(/never converts them to zero/i)).toBeVisible();
    expect(screen.queryByText(/0\.0 cm/)).not.toBeInTheDocument();
  });

  it("allows retry after a read failure", async () => {
    const user = userEvent.setup();
    mockGetProgress.mockRejectedValueOnce(new Error("History service unavailable"));
    render(<AnthropometryTrends unit="cm" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("History service unavailable");
    await user.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(mockGetProgress).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("heading", { name: /circumference trend/i })).toBeVisible();
  });
});
