import { ItemConfidence } from "../lib/types";

const STYLES: Record<ItemConfidence, string> = {
  high: "bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400",
  medium: "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  low: "bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-400",
};

const DOT: Record<ItemConfidence, string> = {
  high: "#22C55E",
  medium: "#F59E0B",
  low: "#EF4444",
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
        style={{ backgroundColor: DOT[level] }}
      />
      {LABELS[level]}
    </span>
  );
}
