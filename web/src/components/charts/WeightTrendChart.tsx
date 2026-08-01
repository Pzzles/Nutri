import {
  ComposedChart,
  Line,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useDarkMode } from "../../lib/useDarkMode";
import type { TrendPoint } from "../../lib/weightTrend";

// ── Entry types ───────────────────────────────────────────────────────────────

export interface RawLogEntry {
  id: string;
  weight_kg: number;
  measured_at: string;
  is_official: boolean;
}

// ── Chart data types ──────────────────────────────────────────────────────────

interface ChartEntry {
  ts: number;
  rawWeight?: number;
  trendWeight?: number | null;
  // raw-dot metadata (present when rawWeight is defined)
  isOfficial?: boolean;
  isFlagged?: boolean;
  rawMeasuredAt?: string;
  // trend-point metadata (present when trendWeight is defined)
  huberCapped?: boolean;
  localDate?: string;
  rawRep?: number;
}

// ── Gap-break injection ───────────────────────────────────────────────────────

const GAP_BREAK_DAYS = 3;

function buildChartData(
  rawLogs: RawLogEntry[],
  trendPoints: TrendPoint[],
  flaggedSet: Set<string>,
): ChartEntry[] {
  const map = new Map<number, ChartEntry>();

  for (const log of rawLogs) {
    const ts = new Date(log.measured_at).getTime();
    map.set(ts, {
      ts,
      rawWeight: log.weight_kg,
      isOfficial: log.is_official,
      isFlagged: flaggedSet.has(log.id),
      rawMeasuredAt: log.measured_at,
    });
  }

  for (let i = 0; i < trendPoints.length; i++) {
    const pt = trendPoints[i];
    const ts = new Date(pt.measured_at).getTime();

    // Insert gap break before this trend point when the gap is large.
    if (i > 0) {
      const prevTs = new Date(trendPoints[i - 1].measured_at).getTime();
      const gapDays = (ts - prevTs) / 86_400_000;
      if (gapDays > GAP_BREAK_DAYS) {
        const breakTs = Math.round((prevTs + ts) / 2);
        if (!map.has(breakTs)) {
          map.set(breakTs, { ts: breakTs, trendWeight: null });
        }
      }
    }

    const existing = map.get(ts) ?? { ts };
    map.set(ts, {
      ...existing,
      trendWeight: pt.trend_weight_kg,
      huberCapped: pt.huber_capped,
      localDate: pt.local_date,
      rawRep: pt.raw_weight_kg,
    });
  }

  return Array.from(map.values()).sort((a, b) => a.ts - b.ts);
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function ChartTooltip({
  active,
  payload,
  dark,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload: ChartEntry; name: string }>;
  dark: boolean;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;

  const bg = dark ? "#1E1E2E" : "#fff";
  const border = dark ? "#2D2D44" : "#DCDFEA";
  const textColor = dark ? "#fff" : "#181823";
  const mutedColor = dark ? "#8B92A5" : "#6B7280";

  const formatTs = (ts: number, opts: Intl.DateTimeFormatOptions) =>
    new Date(ts).toLocaleDateString("en-ZA", opts);

  const formatIso = (iso: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(iso).toLocaleString("en-ZA", opts);

  // Prefer trend tooltip when a trend point is present.
  if (d.trendWeight != null) {
    return (
      <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 8, padding: "8px 12px", fontSize: 12, color: textColor }}>
        <p style={{ fontWeight: 600, color: "#0094FF" }}>
          Trend: {d.trendWeight.toFixed(2)} kg
        </p>
        <p style={{ color: mutedColor, marginTop: 2 }}>
          {d.localDate ?? formatTs(d.ts, { day: "numeric", month: "short", year: "numeric" })}
        </p>
        {d.rawRep !== undefined && (
          <p style={{ color: mutedColor, marginTop: 2 }}>
            Daily representative: {d.rawRep.toFixed(1)} kg
          </p>
        )}
        {d.huberCapped && (
          <p style={{ color: "#F59E0B", marginTop: 2 }}>
            Large step smoothed
          </p>
        )}
      </div>
    );
  }

  if (d.rawWeight !== undefined && d.rawMeasuredAt) {
    return (
      <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 8, padding: "8px 12px", fontSize: 12, color: textColor }}>
        <p style={{ fontWeight: 600 }}>{d.rawWeight.toFixed(1)} kg</p>
        <p style={{ color: mutedColor, marginTop: 2 }}>
          {formatIso(d.rawMeasuredAt, { day: "numeric", month: "short", year: "numeric" })}
        </p>
        <p style={{ color: mutedColor, marginTop: 2 }}>
          {formatIso(d.rawMeasuredAt, { hour: "2-digit", minute: "2-digit" })}
        </p>
        <p style={{ marginTop: 2, color: d.isOfficial ? "#22C55E" : mutedColor }}>
          {d.isFlagged
            ? "Excluded from trend (flagged)"
            : d.isOfficial
              ? "Official reading"
              : "Additional reading"}
        </p>
      </div>
    );
  }

  return null;
}

// ── Custom raw dot ────────────────────────────────────────────────────────────

function RawDotShape(props: {
  cx?: number;
  cy?: number;
  payload?: ChartEntry;
  dark?: boolean;
}) {
  const { cx, cy, payload, dark } = props;
  if (cx === undefined || cy === undefined || !payload) return null;
  if (payload.rawWeight === undefined) return null;

  if (payload.isFlagged) {
    return (
      <circle
        cx={cx}
        cy={cy}
        r={4}
        fill="#F59E0B"
        stroke={dark ? "#1E1E2E" : "#fff"}
        strokeWidth={1.5}
        role="img"
        aria-label={`Flagged measurement: ${payload.rawWeight?.toFixed(1)} kg`}
      />
    );
  }
  if (payload.isOfficial) {
    return (
      <circle
        cx={cx}
        cy={cy}
        r={4}
        fill={dark ? "#3B82F6" : "#0094FF"}
        fillOpacity={0.8}
        stroke={dark ? "#1E1E2E" : "#fff"}
        strokeWidth={1}
        role="img"
        aria-label={`Official measurement: ${payload.rawWeight?.toFixed(1)} kg`}
      />
    );
  }
  return (
    <circle
      cx={cx}
      cy={cy}
      r={3.5}
      fill="transparent"
      stroke={dark ? "#6B7280" : "#9CA3AF"}
      strokeWidth={1.5}
      role="img"
      aria-label={`Additional measurement: ${payload.rawWeight?.toFixed(1)} kg`}
    />
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface WeightTrendChartProps {
  rawLogs: RawLogEntry[];
  trendPoints: TrendPoint[];
  flaggedIds?: string[];
}

// ── Main component ────────────────────────────────────────────────────────────

export function WeightTrendChart({
  rawLogs,
  trendPoints,
  flaggedIds = [],
}: WeightTrendChartProps) {
  const dark = useDarkMode();
  const axisColor = dark ? "#8B92A5" : "#6B7280";
  const flaggedSet = new Set(flaggedIds);

  const data = buildChartData(rawLogs, trendPoints, flaggedSet);

  if (data.length === 0) return null;

  // Y-axis domain from all real weights (exclude null gap-break entries).
  const allWeights: number[] = [];
  for (const d of data) {
    if (d.rawWeight !== undefined) allWeights.push(d.rawWeight);
    if (d.trendWeight != null) allWeights.push(d.trendWeight);
  }
  if (allWeights.length === 0) return null;

  const minW = Math.min(...allWeights);
  const maxW = Math.max(...allWeights);
  const pad = Math.max(0.5, (maxW - minW) * 0.15);
  const yMin = Math.floor((minW - pad) * 10) / 10;
  const yMax = Math.ceil((maxW + pad) * 10) / 10;

  const allTs = data.map((d) => d.ts);
  const minTs = Math.min(...allTs);
  const maxTs = Math.max(...allTs);

  // X-axis tick positions: first, last, and up to 3 evenly-spaced in between.
  const tickCount = Math.min(data.length, 5);
  const step = Math.floor(data.length / (tickCount - 1));
  const ticks = Array.from({ length: tickCount }, (_, i) =>
    i < tickCount - 1 ? data[i * step].ts : data[data.length - 1].ts,
  ).filter((v, i, arr) => arr.indexOf(v) === i);

  return (
    <div data-testid="weight-trend-chart" aria-label="Weight trend chart">
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
        >
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={[minTs, maxTs]}
            ticks={ticks}
            tickFormatter={(v: number) =>
              new Date(v).toLocaleDateString("en-ZA", {
                day: "numeric",
                month: "short",
              })
            }
            tick={{ fontSize: 11, fill: axisColor }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[yMin, yMax]}
            tick={{ fontSize: 11, fill: axisColor }}
            axisLine={false}
            tickLine={false}
            tickCount={4}
            tickFormatter={(v: number) => `${v.toFixed(1)}`}
          />
          <Tooltip
            content={(props) => (
              <ChartTooltip
                {...(props as unknown as Parameters<typeof ChartTooltip>[0])}
                dark={dark}
              />
            )}
            cursor={{ stroke: dark ? "#2D2D44" : "#DCDFEA", strokeWidth: 1 }}
          />

          {/* Smoothed trend line — gaps split by null entries */}
          <Line
            type="monotone"
            dataKey="trendWeight"
            stroke="#0094FF"
            strokeWidth={2.5}
            dot={false}
            activeDot={false}
            connectNulls={false}
            name="Trend"
          />

          {/* Raw measurement dots */}
          <Scatter
            dataKey="rawWeight"
            shape={(props: Parameters<typeof RawDotShape>[0]) => (
              <RawDotShape {...props} dark={dark} />
            )}
            name="Raw"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
