import { ItemConfidence } from "../lib/types";

const STYLES: Record<ItemConfidence, string> = {
  high: "bg-primary-light text-primary-dark",
  medium: "bg-amber-50 text-confidence-medium dark:bg-amber-950/60 dark:text-amber-300",
  low: "bg-red-50 text-confidence-low dark:bg-red-950/60 dark:text-red-300",
};

const LABELS: Record<ItemConfidence, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

export default function ConfidenceBadge({ level }: { level: ItemConfidence }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[level]}`}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: level === "high" ? "#2F6F4E" : level === "medium" ? "#B8860B" : "#B3441E" }}
      />
      {LABELS[level]}
    </span>
  );
}
