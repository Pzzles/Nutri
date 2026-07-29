import { PieChart, Pie, Cell } from "recharts";

const MACRO_COLORS = {
  Protein: "#0094FF",
  Carbs: "#F59E0B",
  Fat: "#EF4444",
};

export function MacroRingChart({
  protein,
  carbs,
  fat,
  calories,
}: {
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
}) {
  const proteinKcal = protein * 4;
  const carbsKcal = carbs * 4;
  const fatKcal = fat * 9;
  const total = proteinKcal + carbsKcal + fatKcal;

  const slices =
    total > 0
      ? [
          { name: "Protein", value: proteinKcal },
          { name: "Carbs", value: carbsKcal },
          { name: "Fat", value: fatKcal },
        ]
      : [{ name: "Empty", value: 1 }];

  return (
    <div className="relative flex-shrink-0" style={{ width: 92, height: 92 }}>
      <PieChart width={92} height={92}>
        <Pie
          data={slices}
          cx={42}
          cy={42}
          innerRadius={28}
          outerRadius={43}
          dataKey="value"
          strokeWidth={0}
          startAngle={90}
          endAngle={-270}
        >
          {total > 0 ? (
            slices.map((s) => (
              <Cell key={s.name} fill={MACRO_COLORS[s.name as keyof typeof MACRO_COLORS]} />
            ))
          ) : (
            <Cell fill="rgba(139,146,165,0.25)" />
          )}
        </Pie>
      </PieChart>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-sm font-bold text-ink">{calories}</span>
        <span className="text-[9px] text-muted">kcal</span>
      </div>
    </div>
  );
}
