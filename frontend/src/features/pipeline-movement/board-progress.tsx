import type { ReactNode } from "react";
import { Progress } from "@/components/ui/progress";

/**
 * One quiet progress item of the board's progress line (S9): «Cobertura 1 de 2 plazas cubiertas · detalle» and a 72px bar.
 * Coverage and delivery share this anatomy (label, value, detail, bar); a missing detail renders an empty, hidden slot.
 * On phones the item stacks: label and value, the detail, then the full-width bar.
 */
export function BoardProgress({ label, value, progress, progressLabel, children }: { label: string; value: ReactNode; progress: number | null; progressLabel: string; children?: ReactNode }) {
  return <div aria-label={label} className="pf-board-coverage flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs max-sm:grid max-sm:content-start max-sm:gap-1">
    <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5"><span data-slot="metric-label" className="text-muted-foreground">{label}</span><span data-slot="metric-value" className="font-semibold tabular-nums text-foreground">{value}</span></p>
    <div data-slot="metric-detail" className="min-w-0 text-[11px] text-muted-foreground empty:hidden">{children}</div>
    {progress !== null && <Progress aria-label={progressLabel} value={progress} className="w-[72px] max-sm:order-last max-sm:w-full" />}
  </div>;
}
