/** Phase 10 Gate 5 pure fixture tests for changes and cross-signal descriptions. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ANTHROPOMETRY_CHANGE_VERSION,
  ANTHROPOMETRY_WEIGHT_COMPARISON_VERSION,
  buildAnthropometryProgress,
  buildAnthropometrySeries,
  buildWeightComparison,
  type AnthropometryProgressInputPoint,
} from "../../functions/_shared/anthropometryProgress.ts";
import type { TrendOutput } from "../../functions/_shared/weightTrend.ts";

type SiteCode = AnthropometryProgressInputPoint["site_code"];

interface FixtureSession {
  session_id: string;
  measured_at: string;
  sites: Array<{
    site_code: SiteCode;
    representative_cm: number;
  }>;
}

interface LongitudinalFixture {
  id: string;
  sessions: FixtureSession[];
  expected: Record<string, unknown>;
  expected_ordered_session_ids?: string[];
  expected_previous_change_cm?: number;
  expected_elapsed_days?: number;
}

interface ComparisonFixture {
  id: string;
  circumference: {
    site_code: "waist" | "abdomen_navel";
    start: AnthropometryProgressInputPoint;
    end: AnthropometryProgressInputPoint;
  };
  phase_6: {
    status: TrendOutput["status"];
    confidence: TrendOutput["confidence"];
    trend_points: Array<{ measured_at: string; trend_weight_kg: number }>;
  };
  expected: Record<string, unknown>;
}

interface FrozenFixtures {
  algorithm_versions: Record<string, string>;
  longitudinal_fixtures: LongitudinalFixture[];
  weight_comparison_fixtures: ComparisonFixture[];
}

const fixturePath = fileURLToPath(new URL(
  "../../../docs/testing/phase-10-anthropometry-fixtures.json",
  import.meta.url,
));
const fixtures = JSON.parse(readFileSync(fixturePath, "utf8")) as FrozenFixtures;

function point(
  sessionId: string,
  measuredAt: string,
  siteCode: SiteCode,
  representativeCm: number,
): AnthropometryProgressInputPoint {
  return {
    session_id: sessionId,
    site_code: siteCode,
    measured_at: measuredAt,
    logged_date: measuredAt.slice(0, 10),
    representative_cm: representativeCm,
    quality: "within_repeatability_threshold",
  };
}

function pointsFromSessions(sessions: FixtureSession[]): AnthropometryProgressInputPoint[] {
  return sessions.flatMap((session) => session.sites.map((site) =>
    point(
      session.session_id,
      session.measured_at,
      site.site_code,
      site.representative_cm,
    )
  ));
}

function trendFromFixture(fixture: ComparisonFixture["phase_6"]): TrendOutput {
  return {
    status: fixture.status,
    confidence: fixture.confidence,
    algorithm_versions: {
      daily_representative: "weight_daily_representative_v1",
      smoothing: "weight_time_ewma_v3",
      rate: "weight_rate_theil_sen_v1",
      interval: "weight_rate_interval_sen_v1",
      confidence: "weight_trend_confidence_v1",
    },
    timezone: "Africa/Johannesburg",
    window: { start: null, end: null, elapsed_days: 0, inclusive_calendar_days: 0 },
    measurements: {
      raw_count: fixture.trend_points.length,
      valid_count: fixture.trend_points.length,
      distinct_modelling_days: fixture.trend_points.length,
      excluded_count: 0,
      latest_measured_at: fixture.trend_points.at(-1)?.measured_at ?? null,
      largest_gap_days: 0,
      selected_rate_window_days: 28,
    },
    latest_raw_weight_kg: null,
    latest_trend_weight_kg: fixture.trend_points.at(-1)?.trend_weight_kg ?? null,
    weekly_rate: null,
    warnings: [],
    daily_representatives: [],
    trend_points: fixture.trend_points.map((entry) => ({
      local_date: entry.measured_at.slice(0, 10),
      measured_at: entry.measured_at,
      raw_weight_kg: entry.trend_weight_kg,
      trend_weight_kg: entry.trend_weight_kg,
      alpha: null,
      delta_t_days: null,
      huber_capped: false,
    })),
    flagged_measurements: [],
    ols_diagnostic: null,
  };
}

describe("anthropometry_change_v1 frozen longitudinal fixtures", () => {
  for (const fixture of fixtures.longitudinal_fixtures) {
    it(fixture.id, () => {
      const series = buildAnthropometrySeries(pointsFromSessions(fixture.sessions));
      if (fixture.id.startsWith("L1_")) {
        const waist = series.find((entry) => entry.site_code === "waist")!;
        const navel = series.find((entry) => entry.site_code === "abdomen_navel")!;
        expect(waist.points).toHaveLength(fixture.expected.waist_point_count as number);
        expect(waist.points.map((entry) => entry.measured_at))
          .toEqual(fixture.expected.waist_point_dates);
        expect(waist.previous_change?.change_cm)
          .toBe(fixture.expected.waist_previous_change_cm);
        expect(waist.since_first_change?.change_cm)
          .toBe(fixture.expected.waist_since_first_change_cm);
        expect(waist.previous_change?.elapsed_days)
          .toBe(fixture.expected.waist_elapsed_days);
        expect(navel.points).toHaveLength(fixture.expected.abdomen_navel_point_count as number);
        expect(navel.previous_change?.change_cm)
          .toBe(fixture.expected.abdomen_navel_previous_change_cm);
        expect(navel.previous_change?.elapsed_days)
          .toBe(fixture.expected.abdomen_navel_elapsed_days);
        expect(series.flatMap((entry) => entry.points)).toHaveLength(4);
      } else if (fixture.id === "L2_one_point_has_null_change") {
        expect(series[0].previous_change).toBeNull();
        expect(series[0].since_first_change).toBeNull();
      } else {
        expect(series[0].points.map((entry) => entry.session_id))
          .toEqual(fixture.expected_ordered_session_ids);
        expect(series[0].previous_change?.change_cm)
          .toBe(fixture.expected_previous_change_cm);
        expect(series[0].previous_change?.elapsed_days)
          .toBe(fixture.expected_elapsed_days);
      }
    });
  }

  it("keeps missing sites absent and never manufactures zero points", () => {
    const series = buildAnthropometrySeries([
      point("a", "2026-01-01T06:00:00Z", "waist", 90),
    ]);
    expect(series.map((entry) => entry.site_code)).toEqual(["waist"]);
    expect(series[0].points[0].representative_cm).toBe(90);
  });

  it.each([
    {
      cadence: "daily",
      dates: [
        "2026-01-01T06:00:00Z",
        "2026-01-02T06:00:00Z",
        "2026-01-03T06:00:00Z",
        "2026-01-04T06:00:00Z",
      ],
      expectedPreviousDays: 1,
      expectedSinceFirstDays: 3,
    },
    {
      cadence: "fortnightly",
      dates: [
        "2026-01-01T06:00:00Z",
        "2026-01-15T06:00:00Z",
        "2026-01-29T06:00:00Z",
      ],
      expectedPreviousDays: 14,
      expectedSinceFirstDays: 28,
    },
    {
      cadence: "monthly",
      dates: [
        "2026-01-31T06:00:00Z",
        "2026-02-28T06:00:00Z",
        "2026-03-31T06:00:00Z",
      ],
      expectedPreviousDays: 31,
      expectedSinceFirstDays: 59,
    },
    {
      cadence: "sporadic",
      dates: [
        "2026-01-02T06:00:00Z",
        "2026-01-11T06:00:00Z",
        "2026-03-25T06:00:00Z",
      ],
      expectedPreviousDays: 73,
      expectedSinceFirstDays: 82,
    },
  ])("preserves $cadence measurements as actual, unsmoothed points", ({
    cadence,
    dates,
    expectedPreviousDays,
    expectedSinceFirstDays,
  }) => {
    const input = dates.map((date, index) =>
      point(`${cadence}-${index + 1}`, date, "waist", 90 - index * 0.5)
    );
    const waist = buildAnthropometrySeries([...input].reverse())[0];

    expect(waist.points.map((entry) => entry.measured_at)).toEqual(dates);
    expect(waist.points).toHaveLength(dates.length);
    expect(waist.previous_change?.elapsed_days).toBe(expectedPreviousDays);
    expect(waist.since_first_change?.elapsed_days).toBe(expectedSinceFirstDays);
    expect(waist.since_first_change?.start_session_id).toBe(`${cadence}-1`);
    expect(waist.since_first_change?.end_session_id).toBe(`${cadence}-${dates.length}`);
  });
});

describe("anthropometry_weight_comparison_v1 frozen fixtures", () => {
  for (const fixture of fixtures.weight_comparison_fixtures) {
    it(fixture.id, () => {
      const circumferencePoints: AnthropometryProgressInputPoint[] = [
        {
          ...fixture.circumference.start,
          site_code: fixture.circumference.site_code,
          logged_date: fixture.circumference.start.measured_at.slice(0, 10),
        },
        {
          ...fixture.circumference.end,
          site_code: fixture.circumference.site_code,
          logged_date: fixture.circumference.end.measured_at.slice(0, 10),
        },
      ];
      const comparison = buildWeightComparison(
        buildAnthropometrySeries(circumferencePoints),
        trendFromFixture(fixture.phase_6),
      );

      if ("eligible" in fixture.expected) {
        expect(comparison.eligible).toBe(fixture.expected.eligible);
      }
      if (fixture.expected.selected_site_code) {
        expect(comparison.site_code).toBe(fixture.expected.selected_site_code);
      }
      if (fixture.expected.description !== undefined) {
        expect(comparison.description).toBe(fixture.expected.description);
      }
      if (fixture.expected.circumference_change_cm !== undefined) {
        expect(comparison.circumference?.change_cm)
          .toBe(fixture.expected.circumference_change_cm);
      }
      if (fixture.expected.circumference_direction !== undefined) {
        expect(comparison.circumference?.direction)
          .toBe(fixture.expected.circumference_direction);
      }
      if (fixture.expected.weight_change_kg !== undefined) {
        expect(comparison.weight_trend?.change_kg)
          .toBe(fixture.expected.weight_change_kg);
      }
      if (fixture.expected.weight_stable_band_kg !== undefined) {
        expect(comparison.weight_trend?.stable_band_kg)
          .toBe(fixture.expected.weight_stable_band_kg);
      }
      if (fixture.expected.weight_direction !== undefined) {
        expect(comparison.weight_trend?.direction)
          .toBe(fixture.expected.weight_direction);
      }
      if (fixture.expected.reason_codes) {
        expect(comparison.reason_codes).toEqual(fixture.expected.reason_codes);
      }
      if (fixture.expected.selected_start_weight_timestamp) {
        expect(comparison.weight_trend?.start_point_measured_at)
          .toBe(fixture.expected.selected_start_weight_timestamp);
        expect(comparison.weight_trend?.start_kg)
          .toBe(fixture.expected.selected_start_weight_kg);
      }
    });
  }

  it("falls back to abdomen at navel only when waist lacks eligible endpoints", () => {
    const series = buildAnthropometrySeries([
      point("w", "2026-08-01T06:00:00Z", "waist", 90),
      point("n1", "2026-07-01T06:00:00Z", "abdomen_navel", 100),
      point("n2", "2026-08-01T06:00:00Z", "abdomen_navel", 98),
    ]);
    const comparison = buildWeightComparison(series, trendFromFixture({
      status: "usable",
      confidence: "high",
      trend_points: [
        { measured_at: "2026-07-01T06:00:00Z", trend_weight_kg: 80 },
        { measured_at: "2026-08-01T06:00:00Z", trend_weight_kg: 80.1 },
      ],
    }));
    expect(comparison.site_code).toBe("abdomen_navel");
    expect(comparison.description).toContain("abdomen at navel");
  });

  it("returns all frozen versions and display-only limitations", () => {
    const result = buildAnthropometryProgress([], null);
    expect(result.algorithm_versions).toMatchObject({
      change: ANTHROPOMETRY_CHANGE_VERSION,
      weight_comparison: ANTHROPOMETRY_WEIGHT_COMPARISON_VERSION,
    });
    expect(fixtures.algorithm_versions).toMatchObject({
      change: ANTHROPOMETRY_CHANGE_VERSION,
      weight_comparison: ANTHROPOMETRY_WEIGHT_COMPARISON_VERSION,
    });
    expect(result.limitations.join(" ")).toMatch(/does not alter calorie targets/i);
    expect(result.weight_comparison).toMatchObject({
      eligible: false,
      site_code: null,
      reason_codes: ["insufficient_circumference_points"],
    });
    expect(buildAnthropometryProgress([], null, false).weight_comparison).toBeNull();
  });

  it("the production endpoint is read-only and cannot update target or plateau state", () => {
    const endpointPath = fileURLToPath(new URL(
      "../../functions/get-anthropometric-progress/index.ts",
      import.meta.url,
    ));
    const source = readFileSync(endpointPath, "utf8");
    expect(source).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(/);
    expect(source).not.toContain("get-goal-feedback");
    expect(source).not.toContain("goal_feedback_assessments");
    expect(source).not.toContain("calorie_target_snapshots");
  });
});
