import { useState } from "react";
import LogMeal from "./LogMeal";
import SearchFood from "./SearchFood";

type Tab = "log" | "search";

export default function Log() {
  const [tab, setTab] = useState<Tab>("log");

  return (
    <div>
      {/* Tab bar */}
      <div className="flex border-b border-border bg-surface">
        <TabButton label="Log meal" active={tab === "log"} onClick={() => setTab("log")} />
        <TabButton label="Search food" active={tab === "search"} onClick={() => setTab("search")} />
      </div>

      {/* Content — keep both mounted so LogMeal state survives a tab switch */}
      <div className={tab === "log" ? "" : "hidden"}>
        <LogMeal />
      </div>
      <div className={tab === "search" ? "" : "hidden"}>
        <SearchFood />
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
