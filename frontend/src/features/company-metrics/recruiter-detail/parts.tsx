"use client";
import { useId, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Drilldown } from "../drilldown";
import { number } from "../model";
import { CARD } from "../sections/summary-strip";

/** A figure's drill-down link (window and «back» to this page already applied); null for a 0. */
export type Drill = (target: Drilldown, count: number) => string | null;
/** The person the page is about: id for the queries, full name for labels, first name for the definitions. */
export type Who = { id: string; name: string; first: string };

/** «Ver la 1 entrega», «Ver las 6 entregas», «Ver el 1 placement», «Ver los 9 placements» (rule 16 accessible names). */
export function see(count: number, gender: "f" | "m", singular: string, pluralNoun: string) {
  const article = gender === "f" ? (count === 1 ? "la" : "las") : (count === 1 ? "el" : "los");
  return `Ver ${article} ${number.format(count)} ${count === 1 ? singular : pluralNoun}`;
}

export const CARD_TITLE = "text-[15px] leading-[22px] font-semibold";
export const CAPTION = "mt-1 text-xs text-muted-foreground";
/** A figure inside muted text reads in the foreground (artboard `.cap .fig`, `.kpi-line .fig`). */
export const INLINE_FIGURE = "font-medium text-foreground tabular-nums";

/** One card with one job (rule 4): its title (15/600) and at most one scope caption. */
export function MetricCard({ title, caption, className, children }: { title: string; caption?: ReactNode; className?: string; children: ReactNode }) {
  const id = useId();
  return <article aria-labelledby={id} className={cn(CARD, className)}>
    <div><h3 id={id} className={CARD_TITLE}>{title}</h3>{caption && <p className={CAPTION}>{caption}</p>}</div>
    {children}
  </article>;
}

/** Rule 6: label 14/500 muted, value 32/600, one line below. */
export function KpiCard({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return <article aria-labelledby={id} className={cn(CARD, "gap-3 max-md:p-4 lg:col-span-3")}>
    <h3 id={id} className="text-sm font-medium text-muted-foreground">{label}</h3>
    {children}
  </article>;
}
export const KPI_VALUE = "text-[32px] leading-10 font-semibold tracking-tight tabular-nums max-md:text-[28px] max-md:leading-9";
export const KPI_MISSING = "text-base leading-10 font-medium text-muted-foreground";
export const KPI_LINE = "flex flex-wrap items-center gap-1 text-xs text-muted-foreground";

/** Label and value rows separated by `divide-y` only (rule 4). */
export function Rows({ rows, className }: { rows: { label: string; value: ReactNode }[]; className?: string }) {
  return <ul className={cn("divide-y", className)}>
    {rows.map(row => <li key={row.label} className="flex min-h-10 items-center justify-between gap-4"><span>{row.label}</span><b className="font-medium tabular-nums">{row.value}</b></li>)}
  </ul>;
}

/**
 * Horizontal bars for a split with no list behind it (plain text, L49): the largest part in the accent, the rest muted
 * (rule 8). Widths are shares of `total`.
 */
export function SplitBars({ rows, total }: { rows: { label: string; value: number }[]; total: number }) {
  const top = Math.max(0, ...rows.map(row => row.value));
  return <ul className="flex flex-col gap-4">
    {rows.map(row => <li key={row.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2">
      <span className="font-medium">{row.label}</span>
      <span className="text-right font-semibold tabular-nums">{number.format(row.value)}</span>
      <span aria-hidden="true" className="col-span-2 h-2.5 overflow-hidden rounded-full bg-muted">
        <i className="block h-full rounded-full" style={{
          width: `${total > 0 ? (row.value / total) * 100 : 0}%`,
          background: row.value > 0 && row.value === top ? "var(--primary)" : "color-mix(in oklab, var(--muted-foreground) 40%, var(--card))",
        }} />
      </span>
    </li>)}
  </ul>;
}

/** The definitions of one «Cómo se calcula» popover (rule 7): terms and their reading, with an optional footer. */
export function HelpList({ items, footer }: { items: [string, string][]; footer?: string }) {
  return <>
    <dl className="flex flex-col gap-3">
      {items.map(([term, text]) => <div key={term}><dt className="font-medium text-foreground">{term}</dt><dd className="mt-1">{text}</dd></div>)}
    </dl>
    {footer && <p className="text-xs">{footer}</p>}
  </>;
}

/** Rule 15: a card skeleton with its title, caption and body blocks. */
export function CardSkeleton({ className, children }: { className?: string; children?: ReactNode }) {
  return <div className={cn(CARD, className)}>
    <div className="flex flex-col gap-2"><Skeleton className="h-5 w-44" /><Skeleton className="h-4 w-36" /></div>
    {children}
  </div>;
}
