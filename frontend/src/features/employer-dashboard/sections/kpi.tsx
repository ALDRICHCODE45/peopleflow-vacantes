"use client";
import { useId, type ReactNode } from "react";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import { countDelta, type Delta } from "@/features/company-metrics/delta";
import { number } from "@/features/company-metrics/model";
import { CARD } from "@/features/company-metrics/sections/summary-strip";
import { cn } from "@/lib/utils";

/** Rule 6 delta pill: success / danger tint over a 10% fill (artboard 09), arrow + sign. */
const TONE: Record<Delta["tone"], string> = {
  positive: "bg-status-success/10 text-status-success",
  negative: "bg-status-danger/10 text-status-danger",
  neutral: "bg-muted text-muted-foreground",
};
// The hero is inverted (foreground canvas): tints mix toward --background so they read in both themes.
const HERO_TONE: Record<Delta["tone"], string> = {
  positive: "bg-[color-mix(in_oklab,var(--status-success)_30%,transparent)] text-[color-mix(in_oklab,var(--status-success)_45%,var(--background))]",
  negative: "bg-[color-mix(in_oklab,var(--status-danger)_30%,transparent)] text-[color-mix(in_oklab,var(--status-danger)_55%,var(--background))]",
  neutral: "bg-background/15 text-background/80",
};
const ARROW = { up: ArrowUp, down: ArrowDown, flat: ArrowRight } as const;

/**
 * «+18 vs hace 30 días»: a stock figure compares with the previous window's last day («hace N días»), a flow figure
 * with the previous window («N días anteriores»).
 */
export function DeltaLine({ current, previous, comparison, hero }: { current: number; previous: number; comparison: string; hero?: boolean }) {
  const delta = countDelta({ current, previous });
  if (!delta) return null;
  const Arrow = ARROW[delta.direction];
  const size = Math.abs(current - previous);
  const accessible = delta.direction === "flat" ? `Sin cambio ${comparison}` : `${number.format(size)} ${delta.direction === "up" ? "más" : "menos"} ${comparison}`;
  return <p className={cn("flex flex-wrap items-center gap-2 text-xs", hero ? "text-background/75" : "text-muted-foreground")}>
    <span data-tone={delta.tone} className={cn("inline-flex h-[22px] items-center gap-1 rounded-full px-2 font-medium tabular-nums", (hero ? HERO_TONE : TONE)[delta.tone])}>
      <Arrow aria-hidden="true" className="size-3" strokeWidth={2.5} />
      <span aria-hidden="true">{delta.label}</span>
      <span className="sr-only">{accessible}</span>
    </span>
    <span aria-hidden="true">{comparison}</span>
  </p>;
}

/** KPI card (rule 6): label 14/500 muted, value 32/600, one line below. */
export function KpiCard({ label, className, hero, children }: { label: string; className?: string; hero?: boolean; children: ReactNode }) {
  const id = useId();
  return <article aria-labelledby={id} className={cn(CARD, "gap-3", hero && "pf-kpi-hero bg-foreground text-background shadow-none ring-0", className)}>
    <h3 id={id} className={cn("text-sm font-medium", hero ? "text-background/75" : "text-muted-foreground")}>{label}</h3>
    {children}
  </article>;
}

export const VALUE = "text-[32px] leading-10 font-semibold tracking-tight tabular-nums";
export const HERO_VALUE = "text-[44px] leading-[52px] font-semibold tracking-tight tabular-nums";
