// Frontend weight trend API client, canonical types, and display helpers.
//
// All types here mirror the v3 API contract (weight_time_ewma_v3).
// Do NOT import @shared/weightTrend, calculate(), or any backend maths here.
// The browser calls GET /functions/v1/get-weight-trend and displays what it receives.

import { supabase } from "./supabase";

// ── v3 API response types ────────────────────────────────────────────────────

export type TrendStatus =
  | "insufficient_measurements"
  | "insufficient_coverage"
  | "provisional"
  | "usable"
  | "stale";

export type TrendConfidence = "low" | "medium" | "high";

export interface AlgorithmVersions {
  daily_representative: string;
  smoothing: string;
  rate: string;
  interval: string;
  confidence: string;
}

export interface WeightTrendWindow {
  start: string | null;
  end: string | null;
  elapsed_days: number;
  inclusive_calendar_days: number;
}

export interface TrendMeasurements {
  raw_count: number;
  valid_count: number;
  distinct_modelling_days: number;
  excluded_count: number;
  latest_measured_at: string | null;
  largest_gap_days: number;
  selected_rate_window_days: number | null;
}

/**
 * Weekly rate estimate with estimated uncertainty range.
 * lower_kg and upper_kg are a plausibility range derived from Theil-Sen +
 * Sen/Kendall. They are NOT a guaranteed 95% confidence interval — the true
 * rate may fall outside them, especially with sparse or inconsistent data.
 */
export interface WeeklyRate {
  estimate_kg: number;
  lower_kg: number | null;
  upper_kg: number | null;
  bootstrap_lower_kg: number | null;
  bootstrap_upper_kg: number | null;
}

export interface DailyRep {
  local_date: string;
  measured_at: string;
  weight_kg: number;
  source: "official" | "median" | "latest_official_of_multiple";
  warnings: string[];
  source_measurement_ids: string[];
}

export interface TrendPoint {
  local_date: string;
  measured_at: string;
  raw_weight_kg: number;
  trend_weight_kg: number;
  alpha: number | null;
  delta_t_days: number | null;
  huber_capped: boolean;
}

export interface OlsDiagnostic {
  slope_per_day: number;
  weekly_rate_kg: number;
  r_squared: number;
}

export interface WeightTrendResponse {
  status: TrendStatus;
  algorithm_versions: AlgorithmVersions;
  timezone: string;
  window: WeightTrendWindow;
  measurements: TrendMeasurements;
  latest_raw_weight_kg: number | null;
  latest_trend_weight_kg: number | null;
  weekly_rate: WeeklyRate | null;
  confidence: TrendConfidence;
  warnings: string[];
  daily_representatives: DailyRep[];
  trend_points: TrendPoint[];
  flagged_measurements: string[];
  ols_diagnostic: OlsDiagnostic | null;
}

// ── Typed error ──────────────────────────────────────────────────────────────

export type TrendErrorCode =
  | "UNAUTHENTICATED"
  | "INVALID_PROFILE_TIMEZONE"
  | "NETWORK_ERROR"
  | "BACKEND_ERROR"
  | "MALFORMED_RESPONSE";

export class TrendError extends Error {
  constructor(
    public readonly code: TrendErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TrendError";
  }
}

// ── API client ───────────────────────────────────────────────────────────────

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? "") as string;

export async function getWeightTrend(opts?: {
  displayWindowDays?: 7 | 14 | 28 | 56 | 84;
  signal?: AbortSignal;
}): Promise<WeightTrendResponse> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new TrendError("UNAUTHENTICATED", "Not authenticated");

  const qs = opts?.displayWindowDays
    ? `?display_window_days=${opts.displayWindowDays}`
    : "";

  let resp: Response;
  try {
    resp = await fetch(`${SUPABASE_URL}/functions/v1/get-weight-trend${qs}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: opts?.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    throw new TrendError("NETWORK_ERROR", "Network request failed");
  }

  let json: unknown;
  try {
    json = await resp.json();
  } catch {
    throw new TrendError("MALFORMED_RESPONSE", "Response was not valid JSON");
  }

  if (!isEnvelope(json)) {
    throw new TrendError("MALFORMED_RESPONSE", "Unexpected response shape");
  }

  if (!json.success) {
    const errorObj = json.error as Record<string, unknown> | undefined;
    const code = errorObj?.code as string | undefined;
    if (code === "UNAUTHENTICATED") {
      throw new TrendError("UNAUTHENTICATED", "Session expired");
    }
    if (code === "INVALID_PROFILE_TIMEZONE") {
      throw new TrendError(
        "INVALID_PROFILE_TIMEZONE",
        "Your profile has an unrecognised timezone. Please update it in Account settings.",
      );
    }
    const msg = (errorObj?.message as string | undefined) ?? "Trend unavailable";
    throw new TrendError("BACKEND_ERROR", msg);
  }

  if (!isWeightTrendResponse(json.data)) {
    throw new TrendError(
      "MALFORMED_RESPONSE",
      "Response data did not match the expected shape",
    );
  }

  return json.data;
}

function isEnvelope(
  v: unknown,
): v is { success: boolean; data?: unknown; error?: unknown } {
  return typeof v === "object" && v !== null && "success" in v;
}

function isWeightTrendResponse(v: unknown): v is WeightTrendResponse {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.status === "string" &&
    typeof r.confidence === "string" &&
    Array.isArray(r.trend_points) &&
    Array.isArray(r.warnings) &&
    typeof r.measurements === "object" &&
    r.measurements !== null
  );
}

// ── Display helpers ──────────────────────────────────────────────────────────

export function formatWeight(kg: number | null | undefined, decimals = 1): string {
  if (kg == null) return "—";
  return `${kg.toFixed(decimals)} kg`;
}

/** Formats a weekly rate with Unicode minus for negative, + for positive. */
export function formatRate(estimate: number): string {
  const sign = estimate < 0 ? "−" : estimate > 0 ? "+" : "";
  return `${sign}${Math.abs(estimate).toFixed(2)} kg/week`;
}

export function formatRateDirection(estimate: number): string {
  if (estimate < -0.02) return "decreasing";
  if (estimate > 0.02) return "increasing";
  return "approximately stable";
}

export function formatConfidence(c: TrendConfidence): string {
  return c === "high" ? "High" : c === "medium" ? "Medium" : "Low";
}

/**
 * Returns the estimated uncertainty range as a string, or null when either
 * bound is unavailable. Example: "−0.82 to −0.61 kg/week"
 */
export function formatRateRange(
  lower: number | null,
  upper: number | null,
): string | null {
  if (lower === null || upper === null) return null;
  const fmt = (v: number) =>
    `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(2)}`;
  return `${fmt(lower)} to ${fmt(upper)} kg/week`;
}

export function formatRecency(latestMeasuredAt: string | null): string {
  if (!latestMeasuredAt) return "unknown";
  const diffDays = Math.floor(
    (Date.now() - new Date(latestMeasuredAt).getTime()) / 86_400_000,
  );
  if (diffDays < 0) return "today";
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "1 day ago";
  return `${diffDays} days ago`;
}

export function mapWarningToMessage(code: string): string | null {
  switch (code) {
    case "multiple_official_entries":
      return "Multiple official entries were recorded on the same day; one was selected for trend modelling.";
    case "stale_data":
      return "The latest measurement is over two weeks old. The trend may not reflect your current weight.";
    case "large_gap":
      return "There is a significant gap between measurements. The rate estimate may be less reliable.";
    case "insufficient_measurements":
      return "More distinct measurement days are needed before a weekly rate can be estimated.";
    case "insufficient_coverage":
      return "Measurements do not yet cover enough calendar time for a reliable rate estimate.";
    default:
      return null;
  }
}
