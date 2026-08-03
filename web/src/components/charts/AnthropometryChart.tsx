import {
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  formatMeasurement,
  siteDefinition,
  type AnthropometryProgressPoint,
  type AnthropometrySiteCode,
  type MeasurementUnit,
} from "../../lib/anthropometry";
import { useDarkMode } from "../../lib/useDarkMode";

interface ChartPoint {
  timestamp: number;
  value: number;
  source: AnthropometryProgressPoint;
}

function ChartTooltip({
  active,
  payload,
  unit,
  dark,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload: ChartPoint }>;
  unit: MeasurementUnit;
  dark: boolean;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-sm"
      style={{
        background: dark ? "#1E1E2E" : "#fff",
        borderColor: dark ? "#2D2D44" : "#DCDFEA",
        color: dark ? "#fff" : "#181823",
      }}
    >
      <p className="font-semibold">{formatMeasurement(point.source.representative_cm, unit)}</p>
      <p className="mt-1 opacity-70">
        {new Date(point.source.measured_at).toLocaleDateString("en-ZA", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}
      </p>
      {point.source.quality === "repeatability_warning" && (
        <p className="mt-1 text-amber-600 dark:text-amber-300">Repeatability note</p>
      )}
      {point.source.quality === "pair_agree_with_isolated_reading" && (
        <p className="mt-1 text-amber-600 dark:text-amber-300">Isolated reading excluded</p>
      )}
      {point.source.quality === "high_variability" && (
        <p className="mt-1 text-amber-600 dark:text-amber-300">Low confidence; interpretation ineligible</p>
      )}
    </div>
  );
}

export function AnthropometryChart({
  siteCode,
  points,
  unit,
}: {
  siteCode: AnthropometrySiteCode;
  points: AnthropometryProgressPoint[];
  unit: MeasurementUnit;
}) {
  const dark = useDarkMode();
  if (points.length === 0) return null;
  const data: ChartPoint[] = points.map((source) => ({
    timestamp: Date.parse(source.measured_at),
    value: unit === "cm" ? source.representative_cm : source.representative_cm / 2.54,
    source,
  }));
  const values = data.map((point) => point.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const padding = Math.max(unit === "cm" ? 0.5 : 0.2, (maxValue - minValue) * 0.15);
  const timestamps = data.map((point) => point.timestamp);
  const minTimestamp = Math.min(...timestamps);
  const maxTimestamp = Math.max(...timestamps);
  const datePadding = minTimestamp === maxTimestamp ? 86_400_000 : 0;
  const axisColor = dark ? "#8B92A5" : "#6B7280";
  const label = `${siteDefinition(siteCode).label} circumference chart with ${points.length} recorded ${points.length === 1 ? "point" : "points"}. No smoothing or interpolated values.`;

  return (
    <div role="img" aria-label={label} data-testid="anthropometry-chart">
      <div aria-hidden="true">
        <ResponsiveContainer width="100%" height={220}>
          <ScatterChart margin={{ top: 12, right: 10, bottom: 4, left: -12 }}>
            <XAxis
              type="number"
              dataKey="timestamp"
              scale="time"
              domain={[minTimestamp - datePadding, maxTimestamp + datePadding]}
              tickFormatter={(value: number) => new Date(value).toLocaleDateString("en-ZA", {
                day: "numeric",
                month: "short",
              })}
              tick={{ fontSize: 11, fill: axisColor }}
              axisLine={false}
              tickLine={false}
              tickCount={Math.min(points.length + 1, 5)}
            />
            <YAxis
              type="number"
              dataKey="value"
              domain={[minValue - padding, maxValue + padding]}
              tickFormatter={(value: number) => value.toFixed(1)}
              tick={{ fontSize: 11, fill: axisColor }}
              axisLine={false}
              tickLine={false}
              tickCount={4}
              unit={` ${unit}`}
            />
            <Tooltip
              content={(props) => (
                <ChartTooltip
                  {...(props as unknown as Parameters<typeof ChartTooltip>[0])}
                  unit={unit}
                  dark={dark}
                />
              )}
              cursor={{ stroke: dark ? "#2D2D44" : "#DCDFEA", strokeWidth: 1 }}
            />
            <Scatter data={data} dataKey="value" fill="#0094FF" name="Recorded circumference" />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
