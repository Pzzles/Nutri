import { useState } from "react";
import Goals from "./Goals";
import WeightLogPage from "./WeightLog";
import { AdaptiveMaintenanceCard } from "../components/AdaptiveMaintenanceCard";
import { GoalFeedbackCard } from "../components/GoalFeedbackCard";
import Measurements from "./Measurements";

type Tab = "goals" | "weight" | "measurements" | "maintenance" | "feedback";

export default function Progress() {
  const [tab, setTab] = useState<Tab>("goals");

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const currentIndex = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (currentIndex < 0) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
      ? tabs.length - 1
      : event.key === "ArrowRight"
      ? (currentIndex + 1) % tabs.length
      : (currentIndex - 1 + tabs.length) % tabs.length;
    tabs[nextIndex].focus();
  }

  return (
    <div>
      {/* Tab bar */}
      <div className="flex overflow-x-auto border-b border-border bg-surface" role="tablist" aria-label="Progress sections" onKeyDown={handleTabKeyDown}>
        <TabButton label="Goals"       active={tab === "goals"}       onClick={() => setTab("goals")} />
        <TabButton label="Weight"      active={tab === "weight"}      onClick={() => setTab("weight")} />
        <TabButton label="Measurements" active={tab === "measurements"} onClick={() => setTab("measurements")} />
        <TabButton label="Maintenance" active={tab === "maintenance"} onClick={() => setTab("maintenance")} />
        <TabButton label="Feedback"    active={tab === "feedback"}    onClick={() => setTab("feedback")} />
      </div>

      {/* Content */}
      <div id="progress-panel-goals" role="tabpanel" aria-labelledby="progress-tab-goals" className={tab === "goals" ? "" : "hidden"}>
        <Goals />
      </div>
      <div id="progress-panel-weight" role="tabpanel" aria-labelledby="progress-tab-weight" className={tab === "weight" ? "" : "hidden"}>
        <WeightLogPage />
      </div>
      <div id="progress-panel-measurements" role="tabpanel" aria-labelledby="progress-tab-measurements" className={tab === "measurements" ? "" : "hidden"}>
        <Measurements />
      </div>
      <div id="progress-panel-maintenance" role="tabpanel" aria-labelledby="progress-tab-maintenance" className={tab === "maintenance" ? "p-4 max-w-xl mx-auto" : "hidden"}>
        <AdaptiveMaintenanceCard onLogWeight={() => setTab("weight")} />
      </div>
      <div id="progress-panel-feedback" role="tabpanel" aria-labelledby="progress-tab-feedback" className={tab === "feedback" ? "p-4 max-w-xl mx-auto" : "hidden"}>
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
  const tabId = `progress-tab-${label.toLowerCase()}`;
  const panelId = `progress-panel-${label.toLowerCase()}`;
  return (
    <button
      type="button"
      id={tabId}
      role="tab"
      aria-selected={active}
      aria-controls={panelId}
      onClick={onClick}
      className={`-mb-px min-h-12 shrink-0 border-b-2 px-4 py-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:px-5 ${
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}
