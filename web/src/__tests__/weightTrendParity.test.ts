// Cross-language parity tests: Python oracle JSON vs TypeScript calculate().
//
// Each test loads a pre-generated oracle JSON from tools/weight-trend-oracle/expected/,
// feeds the same inputs to the TypeScript engine, then compares field-by-field.
//
// Prerequisites:
//   python tools/weight-trend-oracle/generate_fixture_jsons.py  (already run; files committed)
//
// Excluded from comparison (RNG-implementation-specific):
//   weekly_rate.bootstrap_lower_kg, weekly_rate.bootstrap_upper_kg
//
// Numeric tolerance: 1e-6 (oracle output is rounded to at most 8 decimal places;
//   TypeScript applies the same rounding, so differences are sub-rounding-unit).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { calculate, type RawEntry } from "@shared/weightTrend";

// ── Helpers ───────────────────────────────────────────────────────────────────

const EXPECTED_DIR = resolve(process.cwd(), "../tools/weight-trend-oracle/expected");
const TOL = 1e-6;

interface OracleFile {
  input: {
    raw_entries: Array<{
      id: string;
      measured_at: string;
      weight_kg: number;
      is_official: boolean;
      notes?: string | null;
    }>;
    now_iso: string;
    timezone: string;
  };
  expected: Record<string, unknown>;
}

function loadFixture(key: string): OracleFile {
  const path = resolve(EXPECTED_DIR, `fixture_${key}.json`);
  return JSON.parse(readFileSync(path, "utf-8")) as OracleFile;
}

function closeEnough(a: number | null, b: number | null, tol = TOL): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return Math.abs(a - b) <= tol;
}

// ── Fixture parity ────────────────────────────────────────────────────────────

const FIXTURES = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];

for (const key of FIXTURES) {
  describe(`Fixture ${key} — cross-language parity`, () => {
    const { input, expected } = loadFixture(key);
    const entries = input.raw_entries as RawEntry[];
    const result  = calculate(entries, input.now_iso, input.timezone);
    const exp     = expected as Record<string, unknown>;

    // ── Status and confidence ──────────────────────────────────────────────

    it("status matches oracle", () => {
      expect(result.status).toBe(exp.status);
    });

    it("confidence matches oracle", () => {
      expect(result.confidence).toBe(exp.confidence);
    });

    // ── Measurements block ─────────────────────────────────────────────────

    it("raw_count matches", () => {
      const m = exp.measurements as Record<string, unknown>;
      expect(result.measurements.raw_count).toBe(m.raw_count);
    });

    it("valid_count matches", () => {
      const m = exp.measurements as Record<string, unknown>;
      expect(result.measurements.valid_count).toBe(m.valid_count);
    });

    it("excluded_count matches", () => {
      const m = exp.measurements as Record<string, unknown>;
      expect(result.measurements.excluded_count).toBe(m.excluded_count);
    });

    it("distinct_modelling_days matches", () => {
      const m = exp.measurements as Record<string, unknown>;
      expect(result.measurements.distinct_modelling_days).toBe(m.distinct_modelling_days);
    });

    it("selected_rate_window_days matches", () => {
      const m = exp.measurements as Record<string, unknown>;
      expect(result.measurements.selected_rate_window_days).toBe(m.selected_rate_window_days);
    });

    it("largest_gap_days within 1e-6", () => {
      const m = exp.measurements as Record<string, unknown>;
      expect(closeEnough(result.measurements.largest_gap_days, m.largest_gap_days as number | null)).toBe(true);
    });

    it("latest_measured_at matches", () => {
      const m = exp.measurements as Record<string, unknown>;
      expect(result.measurements.latest_measured_at).toBe(m.latest_measured_at);
    });

    // ── Latest raw and trend ───────────────────────────────────────────────

    it("latest_raw_weight_kg matches", () => {
      expect(result.latest_raw_weight_kg).toBe(exp.latest_raw_weight_kg);
    });

    it("latest_trend_weight_kg within 1e-6", () => {
      expect(closeEnough(result.latest_trend_weight_kg, exp.latest_trend_weight_kg as number | null)).toBe(true);
    });

    // ── Weekly rate ────────────────────────────────────────────────────────

    it("weekly_rate null/present matches oracle", () => {
      const oracleRate = exp.weekly_rate;
      expect(result.weekly_rate === null).toBe(oracleRate === null);
    });

    if (exp.weekly_rate !== null && exp.weekly_rate !== undefined) {
      const oRate = exp.weekly_rate as Record<string, number | null>;

      it("weekly_rate.estimate_kg within 1e-6", () => {
        expect(closeEnough(result.weekly_rate!.estimate_kg, oRate.estimate_kg)).toBe(true);
      });

      it("weekly_rate.lower_kg within 1e-6 (or both null)", () => {
        expect(closeEnough(result.weekly_rate!.lower_kg, oRate.lower_kg)).toBe(true);
      });

      it("weekly_rate.upper_kg within 1e-6 (or both null)", () => {
        expect(closeEnough(result.weekly_rate!.upper_kg, oRate.upper_kg)).toBe(true);
      });
    }

    // ── Warnings ──────────────────────────────────────────────────────────

    it("warnings array matches oracle (sorted)", () => {
      const expWarnings = (exp.warnings as string[]).slice().sort();
      const actWarnings = [...result.warnings].sort();
      expect(actWarnings).toEqual(expWarnings);
    });

    // ── Flagged measurements ───────────────────────────────────────────────

    it("flagged_measurements matches oracle", () => {
      const expFlagged = (exp.flagged_measurements as string[]).slice().sort();
      const actFlagged = [...result.flagged_measurements].slice().sort();
      expect(actFlagged).toEqual(expFlagged);
    });

    // ── Daily representatives ──────────────────────────────────────────────

    it("daily_representatives count matches oracle", () => {
      const expReps = exp.daily_representatives as unknown[];
      expect(result.daily_representatives).toHaveLength(expReps.length);
    });

    it("daily_representatives local_dates match oracle", () => {
      const expReps = exp.daily_representatives as Array<Record<string, unknown>>;
      const expDates = expReps.map((r) => r.local_date as string);
      const actDates = result.daily_representatives.map((r) => r.local_date);
      expect(actDates).toEqual(expDates);
    });

    it("daily_representatives sources match oracle", () => {
      const expReps = exp.daily_representatives as Array<Record<string, unknown>>;
      for (let i = 0; i < expReps.length; i++) {
        expect(result.daily_representatives[i].source).toBe(expReps[i].source);
      }
    });

    it("daily_representatives weight_kg match oracle", () => {
      const expReps = exp.daily_representatives as Array<Record<string, unknown>>;
      for (let i = 0; i < expReps.length; i++) {
        expect(result.daily_representatives[i].weight_kg).toBe(expReps[i].weight_kg);
      }
    });

    // ── Trend points ───────────────────────────────────────────────────────

    it("trend_points count matches oracle", () => {
      const expPts = exp.trend_points as unknown[];
      expect(result.trend_points).toHaveLength(expPts.length);
    });

    it("trend_points trend_weight_kg within 1e-6", () => {
      const expPts = exp.trend_points as Array<Record<string, unknown>>;
      for (let i = 0; i < expPts.length; i++) {
        const expTrend = expPts[i].trend_weight_kg as number;
        const actTrend = result.trend_points[i].trend_weight_kg;
        expect(Math.abs(actTrend - expTrend)).toBeLessThan(TOL);
      }
    });

    it("trend_points alpha within 1e-9", () => {
      const expPts = exp.trend_points as Array<Record<string, unknown>>;
      for (let i = 0; i < expPts.length; i++) {
        const expAlpha = expPts[i].alpha as number | null;
        const actAlpha = result.trend_points[i].alpha;
        if (expAlpha === null) {
          expect(actAlpha).toBeNull();
        } else {
          expect(actAlpha).not.toBeNull();
          expect(Math.abs(actAlpha! - expAlpha)).toBeLessThan(1e-9);
        }
      }
    });

    it("trend_points huber_capped matches oracle", () => {
      const expPts = exp.trend_points as Array<Record<string, unknown>>;
      for (let i = 0; i < expPts.length; i++) {
        expect(result.trend_points[i].huber_capped).toBe(expPts[i].huber_capped);
      }
    });

    // ── OLS diagnostic ─────────────────────────────────────────────────────

    it("ols_diagnostic null/present matches oracle", () => {
      expect(result.ols_diagnostic === null).toBe(exp.ols_diagnostic === null);
    });

    if (exp.ols_diagnostic !== null && exp.ols_diagnostic !== undefined) {
      const expOls = exp.ols_diagnostic as Record<string, number>;

      it("ols_diagnostic.slope_per_day within 1e-6", () => {
        expect(Math.abs(result.ols_diagnostic!.slope_per_day - expOls.slope_per_day)).toBeLessThan(TOL);
      });

      it("ols_diagnostic.weekly_rate_kg within 1e-6", () => {
        expect(Math.abs(result.ols_diagnostic!.weekly_rate_kg - expOls.weekly_rate_kg)).toBeLessThan(TOL);
      });
    }

    // ── Window block ───────────────────────────────────────────────────────

    it("window.start matches oracle", () => {
      const expWin = exp.window as Record<string, unknown>;
      expect(result.window.start).toBe(expWin.start);
    });

    it("window.end matches oracle", () => {
      const expWin = exp.window as Record<string, unknown>;
      expect(result.window.end).toBe(expWin.end);
    });

    it("window.elapsed_days within 1e-6", () => {
      const expWin = exp.window as Record<string, unknown>;
      expect(closeEnough(result.window.elapsed_days, expWin.elapsed_days as number)).toBe(true);
    });

    it("window.inclusive_calendar_days matches oracle", () => {
      const expWin = exp.window as Record<string, unknown>;
      expect(result.window.inclusive_calendar_days).toBe(expWin.inclusive_calendar_days);
    });

    // ── Algorithm versions ─────────────────────────────────────────────────

    it("algorithm_versions.smoothing is weight_time_ewma_v3", () => {
      expect(result.algorithm_versions.smoothing).toBe("weight_time_ewma_v3");
    });

    it("algorithm_versions.interval is weight_rate_interval_sen_v1", () => {
      expect(result.algorithm_versions.interval).toBe("weight_rate_interval_sen_v1");
    });
  });
}
