import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
  Tooltip,
} from "recharts";
import { useDarkMode } from "../../lib/useDarkMode";

export interface WeekDay {
  date: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fibre_g: number;
}

function dayLabel(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-ZA", { weekday: "short" }).slice(0, 3);
}

function CustomTooltip({ active, payload, dark }: { active?: boolean; payload?: readonly any[]; dark: boolean }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as WeekDay;
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
      <p style={{ fontWeight: 600, marginBottom: 4 }}>{new Date(d.date + "T12:00:00").toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "short" })}</p>
      <p>{d.calories} kcal</p>
      {d.protein_g > 0 && <p style={{ color: "#0094FF" }}>P {d.protein_g}g</p>}
      {d.carbs_g > 0 && <p style={{ color: "#F59E0B" }}>C {d.carbs_g}g</p>}
      {d.fat_g > 0 && <p style={{ color: "#EF4444" }}>F {d.fat_g}g</p>}
      {d.fibre_g > 0 && <p style={{ color: "#22C55E" }}>Fi {d.fibre_g}g</p>}
    </div>
  );
}

export function WeekCalorieChart({
  data,
  target,
}: {
  data: WeekDay[];
  target?: number | null;
}) {
  const dark = useDarkMode();
  const today = new Date().toISOString().slice(0, 10);
  const axisColor = dark ? "#8B92A5" : "#6B7280";
  const gridColor = dark ? "#2D2D44" : "#DCDFE A";

  return (
    <ResponsiveContainer width="100%" height={130}>
      <BarChart data={data} barCategoryGap="32%" margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
        <XAxis
          dataKey="date"
          tickFormatter={dayLabel}
          tick={{ fontSize: 11, fill: axisColor }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis hide domain={[0, target ? Math.max(target * 1.15, ...(data.map((d) => d.calories))) : "auto"]} />
        {target && (
          <ReferenceLine
            y={target}
            stroke="#0094FF"
            strokeDasharray="5 3"
            strokeOpacity={0.5}
            strokeWidth={1.5}
          />
        )}
        <Tooltip
          content={(props) => <CustomTooltip {...props} dark={dark} />}
          cursor={{ fill: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)", radius: 4 }}
        />
        <Bar dataKey="calories" radius={[4, 4, 0, 0]}>
          {data.map((d) => (
            <Cell
              key={d.date}
              fill={
                d.date === today
                  ? "#0094FF"
                  : d.calories > 0
                  ? "rgba(0, 148, 255, 0.4)"
                  : dark
                  ? "rgba(255,255,255,0.06)"
                  : "rgba(0,0,0,0.06)"
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
