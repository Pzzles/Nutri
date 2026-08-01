// Shared types for the weight-logging feature.
// Trend response types live in weightTrend.ts — import from there.

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
