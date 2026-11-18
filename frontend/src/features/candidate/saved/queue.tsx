"use client";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Bookmark, Building2, CalendarDays, ChevronRight, House, Laptop, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { vacancyApplicationHref } from "@/features/jobs/application/application-draft";
import { PublicCompanyAvatar } from "@/features/jobs/components/PublicCompanyAvatar";
import { previewSalaryParts } from "@/features/jobs/create/form/preview-salary";
import { formatPublishedDate, workModeLabel } from "@/features/jobs/formatters";
import type { SavedJobItem } from "@/features/saved-vacancies/model";
import { applicationHref } from "@/features/saved-vacancies/workspace/application-href";
import type { ApplicationBadge } from "./application-status";
import { publishedAgo, savedAgo, shortSalary, type Reason } from "./ranking";
import motion from "./saved.module.css";

export type Entry = { item: SavedJobItem; rank: number | null; reasons: Reason[]; status?: ApplicationBadge };
export type RemoveControl = { pending: boolean; describedBy?: string; onRemove: () => void };
export const PREVIEW_ID = "saved-preview";
export const CARD = "relative isolate flex min-w-0 flex-col rounded-[min(var(--radius-4xl),24px)] bg-card text-sm text-card-foreground shadow-sm ring-1 ring-foreground/5 dark:ring-foreground/10";
const MODE_ICON = { onsite: Building2, hybrid: House, remote: Laptop } as const;
/* Rank · logo · text · (salary or status, wide only) · chevron. */
const COLUMNS = {
  narrow: { queued: "grid-cols-[20px_48px_minmax(0,1fr)_16px] sm:grid-cols-[28px_48px_minmax(0,1fr)_16px]", applied: "grid-cols-[48px_minmax(0,1fr)_16px]" },
  wide: { queued: "grid-cols-[28px_48px_minmax(0,1fr)_auto_16px]", applied: "grid-cols-[48px_minmax(0,1fr)_auto_16px]" },
} as const;
/* The inbox status paint, re-tuned for the dark preview surface. */
const ON_DARK: Record<ApplicationBadge["variant"], string> = {
  info: "border-[oklch(0.78_0.12_245)]/40 bg-[oklch(0.78_0.12_245)]/10 text-[oklch(0.78_0.12_245)]",
  review: "border-(--hero-accent)/50 bg-(--hero-accent)/22 text-background",
  neutral: "border-background/25 bg-background/10 text-background/80",
};
const applied = (item: SavedJobItem) => item.application && `Te postulaste el ${formatPublishedDate(item.application.applied_at)}`;
const place = (item: SavedJobItem) => [item.job.company.name, item.job.location_label, workModeLabel(item.job.work_mode)].filter(Boolean).join(" · ");

/** One queue row: the whole row is the selection button; actions live in the preview or the inline detail. */
export function QueueRow({ entry, selected, narrow, now, remove, onSelect, onKeyDown }: { entry: Entry; selected: boolean; narrow: boolean; now: number; remove: RemoveControl; onSelect: () => void; onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void }) {
  const { item, rank, status } = entry;
  const salary = shortSalary(item.job);
  const detailId = `saved-detail-${item.job_id}`;
  return <li data-pf-saved-vacancy={item.job_id} className={cn("relative min-w-0 rounded-xl", narrow && selected && "bg-primary/6")}>
    <button type="button" data-pf-saved-select data-pf-saved-focus onClick={onSelect} onKeyDown={onKeyDown}
      aria-current={!narrow && selected ? "true" : undefined} aria-expanded={narrow ? selected : undefined} aria-controls={narrow ? (selected ? detailId : undefined) : PREVIEW_ID}
      className={cn("relative grid w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-3 text-left outline-none transition-colors duration-150 hover:bg-muted/70 focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none sm:gap-3.5 sm:px-3",
        rank === null ? "min-h-16" : "min-h-19", COLUMNS[narrow ? "narrow" : "wide"][rank === null ? "applied" : "queued"],
        !narrow && selected && "bg-primary/7 before:absolute before:inset-y-3.5 before:left-0 before:w-[3px] before:rounded-full before:bg-primary before:content-['']")}>
      {rank !== null && <span aria-hidden="true" className={cn("text-center text-xl leading-6 font-semibold tabular-nums", selected ? "text-primary-text" : "text-muted-foreground/60")}>{rank}</span>}
      <PublicCompanyAvatar company={item.job.company} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="line-clamp-2 text-[15px] leading-[22px] font-semibold break-words">{item.job.title}</span>
        <span className="text-xs leading-4 break-words text-muted-foreground">{place(item)}{item.application && ` · ${applied(item)}`}</span>
        <Chips entry={entry} narrow={narrow} />
      </span>
      {!narrow && (rank === null ? <span className="justify-self-end">{status && <Badge variant={status.variant} dot>{status.label}</Badge>}</span>
        : <span data-pf-saved-salary className="flex flex-col items-end text-right"><b className="text-[15px] leading-[22px] font-semibold whitespace-nowrap tabular-nums">{salary?.amount ?? "—"}</b><small className="text-xs leading-4 text-muted-foreground">{salary?.note ?? "sin salario"}</small></span>)}
      <ChevronRight aria-hidden="true" className={cn("size-4 transition-transform duration-150 motion-reduce:transition-none", selected ? "text-primary-text" : "text-muted-foreground", narrow && selected && "rotate-90")} />
    </button>
    {narrow && selected && <div id={detailId} className="flex flex-col gap-3.5 px-2.5 pt-1 pb-4 sm:px-3"><Details entry={entry} now={now} remove={remove} tone="light" /></div>}
  </li>;
}

function Chips({ entry, narrow }: { entry: Entry; narrow: boolean }) {
  const { item, rank, reasons, status } = entry;
  const salary = shortSalary(item.job);
  const chips: ReactNode[] = rank === null ? [] : reasons.map(reason => <span key={reason.text} data-pf-saved-reason
    className={cn("inline-block max-w-full truncate rounded-full px-2 py-[3px] text-xs leading-4 font-medium", reason.lead ? "bg-primary/9 text-primary-text" : "bg-muted text-muted-foreground")}>{reason.text}</span>);
  // Below the preview breakpoint the right-hand salary column folds into a chip, and the status badge joins the chips.
  if (narrow && rank !== null && salary) chips.push(<span key="salary" className="inline-block max-w-full truncate rounded-full px-2 py-[3px] text-xs leading-4 font-medium tabular-nums ring-1 ring-border ring-inset">{salary.amount} {salary.note}</span>);
  if (narrow && rank === null && status) chips.push(<Badge key="status" variant={status.variant} dot>{status.label}</Badge>);
  return chips.length > 0 ? <span className="mt-1.5 flex min-w-0 flex-wrap gap-1.5">{chips}</span> : null;
}

function Facts({ item, now, dark }: { item: SavedJobItem; now: number; dark: boolean }) {
  const Mode = MODE_ICON[item.job.work_mode];
  const facts = [[MapPin, "Ubicación", item.job.location_label ?? "Sin ubicación publicada"], [Mode, "Modalidad", workModeLabel(item.job.work_mode)],
    [CalendarDays, "Publicada", publishedAgo(item.job.published_at, now)], [Bookmark, "Guardada", capitalize(savedAgo(item.saved_at, now))]] as const;
  return <dl className="grid grid-cols-2 gap-x-4 gap-y-3">{facts.map(([Icon, term, value]) => <div key={term} className="min-w-0">
    <dt className={cn("flex items-center gap-1.5 text-xs leading-4", dark ? "text-background/65" : "text-muted-foreground")}><Icon aria-hidden="true" className={cn("size-3.5", dark && "text-(--hero-accent)")} />{term}</dt>
    <dd className="mt-0.5 font-medium [overflow-wrap:anywhere]">{value}</dd>
  </div>)}</dl>;
}
const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** Salary, facts and actions: the same content in the dark preview (desktop) and the expanded row (narrow). */
function Details({ entry, now, remove, tone }: { entry: Entry; now: number; remove: RemoveControl; tone: "dark" | "light" }) {
  const { item, rank } = entry;
  const dark = tone === "dark";
  const salary = previewSalaryParts(item.job);
  const primary = item.application ? { href: applicationHref(item.application.id), label: "Ver postulación" }
    : item.job.source === "vacancy" ? { href: vacancyApplicationHref(item.job_id), label: "Postularme" } : null;
  const size = dark ? "min-h-11" : "min-h-11 w-full";
  return <>
    <div className="flex flex-col gap-0.5">
      {dark && <span className="text-xs leading-4 text-background/65">Salario</span>}
      <b className={cn("font-semibold tabular-nums", dark ? "text-3xl leading-[38px] tracking-tight" : "text-xl leading-7")}>{salary ? `${salary.amount} ${salary.currency}` : "Salario no publicado"}</b>
      <small className={cn("text-xs", dark ? "text-background/65" : "text-muted-foreground")}>{salary ? salary.cadence ?? "Periodicidad y neto/bruto no especificados" : "La empresa no lo publicó"}</small>
    </div>
    <Facts item={item} now={now} dark={dark} />
    {dark && rank !== null && <ul aria-label="Por qué está en este lugar" className="flex flex-wrap gap-1.5">{entry.reasons.map(reason =>
      <li key={reason.text} className={cn("inline-flex min-h-6 items-center rounded-full px-2.5 text-xs font-medium", reason.lead ? "bg-(--hero-accent)/26" : "bg-background/10")}>{reason.text}</li>)}</ul>}
    <div className="flex flex-col gap-2">
      {primary && <Link href={primary.href} className={cn(buttonVariants(), size, dark && "bg-background text-foreground hover:bg-background/88")}>{primary.label}<ArrowRight aria-hidden="true" data-icon="inline-end" /></Link>}
      <div className="flex gap-2 *:flex-1">
        <Link href={`/vacantes/${item.job_id}`} className={cn(buttonVariants({ variant: "outline" }), "min-h-11", dark && "border-background/25 bg-transparent text-background hover:bg-background/10 hover:text-background")}>Ver vacante</Link>
        <Button type="button" variant="ghost" className={cn("min-h-11", dark && "text-background/70 hover:bg-background/10 hover:text-background")} disabled={remove.pending} aria-busy={remove.pending} aria-describedby={remove.describedBy}
          aria-label={`Quitar ${item.job.title} de guardadas`} onClick={remove.onRemove}>{remove.pending ? <Spinner aria-hidden="true" data-icon="inline-start" /> : <Bookmark aria-hidden="true" data-icon="inline-start" className="fill-current" />}Quitar</Button>
      </div>
    </div>
  </>;
}

/** Sticky dark preview of the selected row (desktop). The element persists across selections, so it never re-enters. */
export function VacancyPreview({ entry, now, remove }: { entry: Entry; now: number; remove: RemoveControl }) {
  const { item, rank, status } = entry;
  return <aside id={PREVIEW_ID} aria-labelledby="saved-preview-title" data-pf-saved-enter style={{ "--d": 1 } as CSSProperties}
    className={cn(CARD, "pf-kpi-hero sticky top-4 gap-5 overflow-hidden bg-foreground p-7 text-background shadow-none ring-0", motion.hero, motion.rise)}>
    <p className="flex items-center gap-2 text-xs leading-4 font-semibold tracking-wider text-(--hero-accent) uppercase before:size-1.5 before:rounded-full before:bg-current before:content-['']">{rank === null ? "Ya te postulaste" : `Número ${rank} para postularte`}</p>
    <div className="flex min-w-0 items-center gap-3.5"><PublicCompanyAvatar company={item.job.company} detail />
      <div className="min-w-0"><p className="text-background/65">{item.job.company.name}</p><h3 id="saved-preview-title" className="text-[22px] leading-7 font-semibold tracking-tight text-balance break-words">{item.job.title}</h3></div>
    </div>
    {rank === null && <p className="flex flex-wrap items-center gap-2.5 text-xs text-background/65">{status && <Badge variant={status.variant} dot className={ON_DARK[status.variant]}>{status.label}</Badge>}{applied(item)}</p>}
    <Details entry={entry} now={now} remove={remove} tone="dark" />
  </aside>;
}

/** «Ya no disponibles» row: no selection, its own Quitar. */
export function ClosedRow({ item, remove }: { item: SavedJobItem; remove: RemoveControl }) {
  return <li data-pf-saved-vacancy={item.job_id} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-3">
    <span className="grayscale"><PublicCompanyAvatar company={item.job.company} /></span>
    <div className="min-w-0"><p className="line-clamp-2 font-medium break-words text-muted-foreground">{item.job.title}</p>
      <p className="text-xs leading-4 text-muted-foreground">{item.job.company.name}{item.closed_at && ` · Cerró el ${formatPublishedDate(item.closed_at)}`}</p></div>
    <Button type="button" variant="ghost" data-pf-saved-focus className="min-h-10" disabled={remove.pending} aria-busy={remove.pending} aria-describedby={remove.describedBy} aria-label={`Quitar ${item.job.title} de guardadas`} onClick={remove.onRemove}>{remove.pending ? <Spinner aria-hidden="true" /> : "Quitar"}</Button>
  </li>;
}

/** Skeleton mirroring the loaded layout: summary, a three-row queue and the preview panel; skeletons never animate in. */
export function LoadingSavedJobs() {
  return <section aria-busy="true" aria-label="Vacantes guardadas" className="grid gap-6">
    <span role="status" className="sr-only">Cargando vacantes guardadas</span>
    <div aria-hidden="true" className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className={cn(CARD, "gap-1 px-3 pt-5 pb-2")}>
        <Skeleton className="mx-3 mb-3 h-6 w-48" />
        {[0, 1, 2].map(key => <div key={key} data-pf-saved-loading-row className="grid min-h-19 grid-cols-[20px_48px_minmax(0,1fr)] items-center gap-3 px-3 sm:grid-cols-[28px_48px_minmax(0,1fr)_84px]">
          <Skeleton className="h-5 w-4" /><Skeleton className="size-12 rounded-xl" />
          <div className="grid gap-2"><Skeleton className="h-3.5 w-3/5" /><Skeleton className="h-3 w-2/5" /></div>
          <Skeleton className="hidden h-5 w-20 sm:block" />
        </div>)}
      </div>
      <div data-pf-saved-loading-preview className={cn(CARD, "hidden gap-5 p-7 xl:flex")}>
        <Skeleton className="h-4 w-40" /><div className="flex items-center gap-3.5"><Skeleton className="size-16 rounded-2xl" /><div className="grid flex-1 gap-2"><Skeleton className="h-3.5 w-1/3" /><Skeleton className="h-6 w-4/5" /></div></div>
        <Skeleton className="h-9 w-3/4" /><div className="grid grid-cols-2 gap-3">{[0, 1, 2, 3].map(key => <Skeleton key={key} className="h-9" />)}</div><Skeleton className="h-11" />
      </div>
    </div>
  </section>;
}

/** Empty state: inviting, not an error; what belongs here and two ways out. */
export function EmptySaved() {
  const mini = (className: string) => <div className={cn("absolute top-1/2 left-1/2 flex w-[170px] flex-col gap-2.5 rounded-[14px] bg-card p-3 shadow-[0_10px_24px_-10px_color-mix(in_srgb,var(--foreground)_22%,transparent),0_0_0_1px_var(--border)] sm:w-[220px] sm:p-3.5", className)}>
    <div className="flex items-center gap-2.5"><span className="size-8 shrink-0 rounded-[9px] bg-primary/12" /><span className="flex flex-1 flex-col gap-1.5"><span className="h-2 w-4/5 rounded-full bg-muted" /><span className="h-2 w-1/2 rounded-full bg-muted" /></span><Bookmark className="size-4 fill-current text-primary-text" /></div>
    <span className="h-[18px] w-22 rounded-full bg-primary/12" />
  </div>;
  return <section aria-labelledby="saved-empty-title" data-pf-saved-enter className={cn(CARD, "grid items-center gap-5 overflow-hidden px-5 py-6 sm:gap-8 sm:p-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)] xl:px-12 xl:py-10", motion.empty, motion.rise)}>
    <div className="flex max-w-[520px] flex-col gap-3">
      <p className="flex items-center gap-2 text-xs leading-4 font-semibold tracking-wider text-primary-text uppercase before:size-1.5 before:rounded-full before:bg-primary before:content-['']">Tu lista para decidir</p>
      <h3 id="saved-empty-title" className="text-xl leading-7 font-semibold tracking-tight text-balance sm:text-2xl sm:leading-8">Todavía no guardas vacantes</h3>
      <p className="text-sm leading-[22px] text-muted-foreground sm:text-[15px] sm:leading-6">Cuando una te llame la atención, toca el marcador y aparecerá aquí con su salario, ubicación y modalidad a la vista. Así comparas con calma y te postulas cuando quieras.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Link href="/vacantes" className={cn(buttonVariants(), "min-h-11 max-sm:flex-[1_1_100%]")}>Explorar vacantes<ArrowRight aria-hidden="true" data-icon="inline-end" /></Link>
        <Link href="/candidato/postulaciones" className={cn(buttonVariants({ variant: "outline" }), "min-h-11 max-sm:flex-[1_1_100%]")}>Ver mis postulaciones</Link>
      </div>
    </div>
    <div aria-hidden="true" className="relative -order-1 h-[150px] min-w-0 sm:h-[180px] xl:order-none xl:h-[220px]">{mini(motion.mini1)}{mini(motion.mini2)}{mini(motion.mini3)}</div>
  </section>;
}
