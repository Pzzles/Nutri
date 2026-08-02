import { useState } from "react";
import Goals from "./Goals";
import WeightLogPage from "./WeightLog";
import { AdaptiveMaintenanceCard } from "../components/AdaptiveMaintenanceCard";
import { GoalFeedbackCard } from "../components/GoalFeedbackCard";

type Tab = "goals" | "weight" | "maintenance" | "feedback";

export default function Progress() {
  const [tab, setTab] = useState<Tab>("goals");

  return (
    <div>
      {/* Tab bar */}
      <div className="flex border-b border-border bg-surface">
        <TabButton label="Goals"       active={tab === "goals"}       onClick={() => setTab("goals")} />
        <TabButton label="Weight"      active={tab === "weight"}      onClick={() => setTab("weight")} />
        <TabButton label="Maintenance" active={tab === "maintenance"} onClick={() => setTab("maintenance")} />
        <TabButton label="Feedback"    active={tab === "feedback"}    onClick={() => setTab("feedback")} />
      </div>

      {/* Content */}
      <div className={tab === "goals" ? "" : "hidden"}>
        <Goals />
      </div>
      <div className={tab === "weight" ? "" : "hidden"}>
        <WeightLogPage />
      </div>
      <div className={tab === "maintenance" ? "p-4 max-w-xl mx-auto" : "hidden"}>
        <AdaptiveMaintenanceCard onLogWeight={() => setTab("weight")} />
      </div>
      <div className={tab === "feedback" ? "p-4 max-w-xl mx-auto" : "hidden"}>
        <GoalFeedbackCard
          onOpenGoals={() => setTab("goals")}
          onLogWeight={() => setTab("weight")}
        />
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
