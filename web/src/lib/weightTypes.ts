import type { TrendConfidence, TrendWarning, EWMAPoint } from "./weightTrend";

export interface WeightLog {
  id: string;
  user_id: string;
  weight_kg: number;
  measured_at: string;
  logged_date: string;
  is_official: boolean;
  notes: string | null;
  source: string | null;
  created_at: string;
}

export interface GetWeightLogsResponse {
  logs: WeightLog[];
  latest_official: WeightLog | null;
}

export interface WeightTrendResult {
  algorithm_version: string;
  ewma_version: string;
  window_start: string | null;
  window_end: string | null;
  measurement_count: number;
  coverage_days: number;
  latest_raw_weight_kg: number | null;
  latest_trend_weight_kg: number | null;
  weekly_rate_kg: number | null;
  r_squared: number | null;
  confidence: TrendConfidence;
  warnings: TrendWarning[];
  trend_points: EWMAPoint[];
  outlier_ids: string[];
}
