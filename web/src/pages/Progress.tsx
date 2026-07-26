import { useState } from "react";
import Goals from "./Goals";
import WeightLogPage from "./WeightLog";

type Tab = "goals" | "weight";

export default function Progress() {
  const [tab, setTab] = useState<Tab>("goals");

  return (
    <div>
      {/* Tab bar */}
      <div className="flex border-b border-border bg-surface">
        <TabButton label="Goals" active={tab === "goals"} onClick={() => setTab("goals")} />
        <TabButton label="Weight" active={tab === "weight"} onClick={() => setTab("weight")} />
      </div>

      {/* Content */}
      <div className={tab === "goals" ? "" : "hidden"}>
        <Goals />
      </div>
      <div className={tab === "weight" ? "" : "hidden"}>
        <WeightLogPage />
      </div>
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-5 py-3 text-sm font-medium transition-colors ${
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}
