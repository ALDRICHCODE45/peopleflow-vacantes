"use client";
import type { ReactNode } from "react";
import { InfoPopover } from "@/features/psychometrics/help/info-popover";
import { cn } from "@/lib/utils";
import { DEFINITIONS, type DefinitionKey } from "./definitions";
import { formatRate, NO_SAMPLE, number, type Rate } from "./model";

/** The ⓘ of every number (S5): one popover open at a time through the page's HelpProvider. */
export function DefinitionHelp({ metric }: { metric: DefinitionKey }) {
  const definition = DEFINITIONS[metric];
  return <InfoPopover title={definition.title} description={definition.description} footer={definition.footer} accessibleName={`Ayuda: ${definition.title}`} />;
}

export type Tone = "success" | "review" | "danger" | "muted" | "primary" | "info";
const TONE: Record<Tone, string> = {
  success: "bg-status-success", review: "bg-status-review", danger: "bg-status-danger",
  muted: "bg-muted-foreground/40", primary: "bg-primary", info: "bg-status-info",
};
export type Segment = { label: string; value: number; tone: Tone };

/** A proportion drawn as a segmented bar (rules §10.6); the label carries the numbers, the color is never alone. */
export function SegmentedBar({ segments, label }: { segments: Segment[]; label: string }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  return <div role="img" aria-label={label} className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
    {total > 0 && segments.filter(segment => segment.value > 0).map(segment =>
      <span key={segment.label} className={cn("h-full", TONE[segment.tone])} style={{ width: `${(segment.value / total) * 100}%` }} />)}
  </div>;
}
export const segmentsLabel = (title: string, segments: Segment[]) => `${title}: ${segments.map(segment => `${number.format(segment.value)} ${segment.label.toLowerCase()}`).join(", ")}`;

export function Legend({ segments, extra }: { segments: Segment[]; extra?: (segment: Segment) => ReactNode }) {
  return <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
    {segments.map(segment => <li key={segment.label} className="flex min-w-0 items-center gap-2">
      <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", TONE[segment.tone])} />
      <span className="min-w-0 truncate text-muted-foreground">{segment.label}</span>
      <b className="ml-auto font-medium tabular-nums">{number.format(segment.value)}{extra?.(segment)}</b>
    </li>)}
  </ul>;
}

/** One labelled number with its definition. `value` is already formatted, so null never becomes «0». */
export function Stat({ label, metric, value, detail, className }: { label: string; metric: DefinitionKey; value: string; detail?: ReactNode; className?: string }) {
  const missing = value === NO_SAMPLE;
  return <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
    <div className="flex items-center gap-1 text-xs text-muted-foreground">{label}<span className="-my-3"><DefinitionHelp metric={metric} /></span></div>
    <div className={cn("font-heading text-2xl font-semibold tabular-nums", missing && "text-base font-medium text-muted-foreground")}>{value}</div>
    {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
  </div>;
}

/** A rate reads «67%» with «20 de 30» beside it, or «Sin datos suficientes». */
export function RateStat({ label, metric, rate, noun }: { label: string; metric: DefinitionKey; rate: Rate; noun?: string }) {
  const formatted = formatRate(rate);
  return <Stat label={label} metric={metric} value={formatted.value} detail={formatted.detail && `${formatted.detail}${noun ? ` ${noun}` : ""}`} />;
}
