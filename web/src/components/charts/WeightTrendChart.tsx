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
import type { EWMAPoint } from "../../lib/weightTrend";

// Legacy prop shape — kept for any caller that hasn't migrated to EWMAPoint yet.
export interface WeightPoint {
  date: string;
  weight: number;
}

interface ChartDatum {
  ts: number;           // epoch ms — used as numeric X axis
  label: string;        // formatted date label for axis ticks
  raw: number;
  trend: number;
  is_outlier: boolean;
}

function toChartData(points: EWMAPoint[]): ChartDatum[] {
  return points.map((p) => ({
    ts:         Date.parse(p.measured_at),
    label:      new Date(p.measured_at).toLocaleDateString("en-ZA", {
                  day: "numeric", month: "short",
                }),
    raw:        p.raw_weight_kg,
    trend:      p.trend_weight_kg,
    is_outlier: p.is_outlier,
  }));
}

function legacyToEWMA(points: WeightPoint[]): EWMAPoint[] {
  return points.map((p, i) => ({
    id:              String(i),
    measured_at:     p.date + "T12:00:00Z",
    raw_weight_kg:   p.weight,
    trend_weight_kg: p.weight,
    is_outlier:      false,
  }));
}

function CustomTooltip({
  active,
  payload,
  dark,
}: {
  active?: boolean;
  payload?: readonly { payload: ChartDatum; value: number; name: string }[];
  dark: boolean;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const date = new Date(d.ts).toLocaleDateString("en-ZA", {
    day: "numeric", month: "short", year: "numeric",
  });
  return (
    <div
      style={{
        background:   dark ? "#1E1E2E" : "#fff",
        border:       `1px solid ${dark ? "#2D2D44" : "#DCDFEA"}`,
        borderRadius: 8,
        padding:      "8px 12px",
        fontSize:     12,
        color:        dark ? "#fff" : "#181823",
      }}
    >
      <p style={{ fontWeight: 600 }}>{d.raw} kg</p>
      {d.raw !== d.trend && (
        <p style={{ color: "#0094FF", marginTop: 2 }}>
          Trend: {d.trend.toFixed(1)} kg
        </p>
      )}
      {d.is_outlier && (
        <p style={{ color: "#F59E0B", marginTop: 2 }}>⚠ Flagged as outlier</p>
      )}
      <p style={{ color: dark ? "#8B92A5" : "#6B7280", marginTop: 2 }}>{date}</p>
    </div>
  );
}

// Recharts custom dot for raw measurements — regular = hollow circle, outlier = orange.
function RawDot(props: {
  cx?: number; cy?: number;
  payload?: ChartDatum;
  dark?: boolean;
}) {
  const { cx, cy, payload, dark } = props;
  if (cx === undefined || cy === undefined || !payload) return null;
  if (payload.is_outlier) {
    return <circle cx={cx} cy={cy} r={5} fill="#F59E0B" stroke={dark ? "#1E1E2E" : "#fff"} strokeWidth={1.5} />;
  }
  return <circle cx={cx} cy={cy} r={4} fill="transparent" stroke="#0094FF" strokeWidth={1.5} />;
}

interface Props {
  /** Phase 6: EWMAPoint array from get-weight-trend */
  trendPoints?: EWMAPoint[];
  /** Legacy: plain WeightPoint array (pre-Phase-6 callers) */
  data?: WeightPoint[];
}

export function WeightTrendChart({ trendPoints, data }: Props) {
  const dark = useDarkMode();
  const axisColor = dark ? "#8B92A5" : "#6B7280";

  const ewma: EWMAPoint[] =
    trendPoints ?? (data ? legacyToEWMA(data) : []);

  if (ewma.length < 2) return null;

  const chartData = toChartData(ewma);
  const allWeights = chartData.flatMap((d) => [d.raw, d.trend]);
  const minW   = Math.min(...allWeights);
  const maxW   = Math.max(...allWeights);
  const pad    = Math.max(0.5, (maxW - minW) * 0.15);
  const domain: [number, number] = [
    Math.floor((minW - pad) * 10) / 10,
    Math.ceil((maxW + pad) * 10) / 10,
  ];

  const ticks = chartData
    .filter((_, i) => i === 0 || i === chartData.length - 1 ||
      (chartData.length > 6 && i % Math.floor(chartData.length / 4) === 0))
    .map((d) => d.ts);

  return (
    <ResponsiveContainer width="100%" height={180}>
      <ComposedChart data={chartData} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
        <XAxis
          dataKey="ts"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          ticks={ticks}
          tickFormatter={(v) =>
            new Date(v).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })
          }
          tick={{ fontSize: 11, fill: axisColor }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={domain}
          tick={{ fontSize: 11, fill: axisColor }}
          axisLine={false}
          tickLine={false}
          tickCount={4}
          tickFormatter={(v) => `${v}`}
        />
        <Tooltip content={(props) => <CustomTooltip {...(props as unknown as Parameters<typeof CustomTooltip>[0])} dark={dark} />} cursor={{ stroke: dark ? "#2D2D44" : "#DCDFEA", strokeWidth: 1 }} />

        {/* Smoothed EWMA trend line */}
        <Line
          type="monotone"
          dataKey="trend"
          stroke="#0094FF"
          strokeWidth={2}
          dot={false}
          activeDot={false}
          name="Trend"
        />

        {/* Raw measurements as individual dots */}
        <Scatter
          dataKey="raw"
          shape={(props: Parameters<typeof RawDot>[0]) => <RawDot {...props} dark={dark} />}
          name="Raw"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
