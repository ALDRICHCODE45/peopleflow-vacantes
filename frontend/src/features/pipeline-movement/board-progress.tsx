import type { ReactNode } from "react";
import { Progress } from "@/components/ui/progress";

/** Both summaries reserve identical label/value/bar/detail rows, including missing details. */
export function BoardProgress({ label, value, progress, progressLabel, children }: { label: string; value: ReactNode; progress: number | null; progressLabel: string; children?: ReactNode }) {
  return <div aria-label={label} className="pf-board-coverage flex w-44 min-w-0 flex-col gap-2 text-xs">
    <p data-slot="metric-label" className="text-muted-foreground">{label}</p>
    <p data-slot="metric-value" className="font-semibold tabular-nums">{value}</p>
    {progress !== null ? <Progress aria-label={progressLabel} value={progress} /> : <div aria-hidden="true" className="h-1" />}
    <div data-slot="metric-detail" className="min-h-4 text-[11px] text-muted-foreground">{children}</div>
  </div>;
}
