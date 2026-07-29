import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceDot,
} from "recharts";
import { useDarkMode } from "../../lib/useDarkMode";

export interface WeightPoint {
  date: string;
  weight: number;
}

function CustomTooltip({ active, payload, dark }: { active?: boolean; payload?: readonly any[]; dark: boolean }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as WeightPoint;
  return (
    <div
      style={{
        background: dark ? "#1E1E2E" : "#fff",
        border: `1px solid ${dark ? "#2D2D44" : "#DCDFE A"}`,
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 12,
        color: dark ? "#fff" : "#181823",
      }}
    >
      <p style={{ fontWeight: 600 }}>{d.weight} kg</p>
      <p style={{ color: dark ? "#8B92A5" : "#6B7280", marginTop: 2 }}>
        {new Date(d.date + "T12:00:00").toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
      </p>
    </div>
  );
}

export function WeightTrendChart({ data }: { data: WeightPoint[] }) {
  const dark = useDarkMode();
  const axisColor = dark ? "#8B92A5" : "#6B7280";

  if (data.length < 2) return null;

  const weights = data.map((d) => d.weight);
  const minW = Math.min(...weights);
  const maxW = Math.max(...weights);
  const padding = Math.max(0.5, (maxW - minW) * 0.15);
  const domain: [number, number] = [
    Math.floor((minW - padding) * 10) / 10,
    Math.ceil((maxW + padding) * 10) / 10,
  ];

  const latest = data[data.length - 1];

  return (
    <ResponsiveContainer width="100%" height={160}>
      <AreaChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id="weightGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0094FF" stopOpacity={dark ? 0.3 : 0.2} />
            <stop offset="100%" stopColor="#0094FF" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="date"
          tickFormatter={(v) =>
            new Date(v + "T12:00:00").toLocaleDateString("en-ZA", { day: "numeric", month: "short" })
          }
          tick={{ fontSize: 11, fill: axisColor }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={domain}
          tick={{ fontSize: 11, fill: axisColor }}
          axisLine={false}
          tickLine={false}
          tickCount={4}
          tickFormatter={(v) => `${v}`}
        />
        <Tooltip
          content={(props) => <CustomTooltip {...props} dark={dark} />}
          cursor={{ stroke: dark ? "#2D2D44" : "#DCDFE A", strokeWidth: 1 }}
        />
        <Area
          type="monotone"
          dataKey="weight"
          stroke="#0094FF"
          strokeWidth={2}
          fill="url(#weightGrad)"
          dot={false}
          activeDot={{ r: 4, fill: "#0094FF", strokeWidth: 0 }}
        />
        <ReferenceDot
          x={latest.date}
          y={latest.weight}
          r={4}
          fill="#0094FF"
          strokeWidth={0}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
