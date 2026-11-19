import { useId, useSyncExternalStore, type CSSProperties } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ArrowUpRight, ChevronRight, Clock3, Mail, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { PublicCompanyAvatar } from "@/features/jobs/components/PublicCompanyAvatar";
import { AssessmentBlock, actionableAssessment } from "@/features/psychometrics/workspace/assessments";
import type { AccountAssessment } from "@/features/psychometrics/model";
import { applicationBadge } from "@/features/candidate/saved/application-status";
import { CARD } from "@/features/candidate/saved/queue";
import motion from "@/features/candidate/saved/saved.module.css";
import type { ApplicationsPage } from "./model";

export type Application = ApplicationsPage["items"][number];
const date = new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "UTC" });
const relative = new Intl.RelativeTimeFormat("es-MX", { numeric: "always" });
/** The list carries no company logo: the shared tile shows the company initials. */
const logo = (item: Application) => ({ ...item.company, logo_url: null });
/** One status mapping everywhere (design/system.md, Espacio del candidato → 6). */
function Status({ item }: { item: Application }) {
  const { label, variant } = applicationBadge(item);
  return <Badge variant={variant} dot>{label}</Badge>;
}
/** Whole 24 h periods since the application; the same day reads «hoy», never «hace 0 días». */
export function appliedAgo(value: string, now: number) {
  const days = Math.max(0, Math.floor((now - Date.parse(value)) / 86400000));
  return days === 0 ? "hoy" : relative.format(-days, "day");
}

/** The applications panel breakpoint (lg): below it the detail opens full screen instead of beside the list. */
const COMPACT = "(max-width: 1023px)";
const media = () => typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(COMPACT) : null;
function subscribe(onChange: () => void) {
  const list = media();
  list?.addEventListener?.("change", onChange);
  return () => list?.removeEventListener?.("change", onChange);
}
export function useCompact(): boolean {
  return useSyncExternalStore(subscribe, () => media()?.matches ?? false, () => false);
}

const CHIP = "inline-flex max-w-full min-w-0 items-center gap-1 truncate rounded-full px-2 py-[3px] text-xs leading-4 font-medium";
/**
 * One row (saved-vacancies anatomy): logo · title, meta and chips · status · chevron. The title link keeps the vacancy
 * href for no-JS and modified clicks and stretches over the row; an ordinary activation selects the record.
 */
export function ApplicationRow({ item, assessment, selected, compact = false, unread = false, onSelect, now }: { item: Application; assessment?: AccountAssessment; selected: boolean; compact?: boolean; unread?: boolean; onSelect: (target: HTMLElement) => void; now: number }) {
  const actionable = assessment && actionableAssessment(assessment, now);
  const active = selected && !compact;
  const chips = compact || item.message !== null || actionable;
  return <div data-pf-application-row data-selected={selected} onClick={event => onSelect(event.currentTarget.querySelector("a")!)}
    className={cn("relative grid min-w-0 cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-3 transition-colors duration-150 hover:bg-muted/70 has-[a:focus-visible]:ring-3 has-[a:focus-visible]:ring-ring/40 motion-reduce:transition-none sm:gap-3.5 sm:px-3",
      compact ? "grid-cols-[48px_minmax(0,1fr)_16px]" : "grid-cols-[48px_minmax(0,1fr)_auto_16px]", chips ? "min-h-19" : "min-h-16",
      active && "bg-primary/7 before:absolute before:inset-y-3.5 before:left-0 before:w-[3px] before:rounded-full before:bg-primary before:content-['']")}>
    <PublicCompanyAvatar company={logo(item)} />
    <span className="flex min-w-0 flex-col gap-0.5">
      <Link href={`/vacantes/${item.vacancy.id}`} aria-current={active ? "true" : undefined} aria-haspopup={compact ? "dialog" : undefined} aria-controls={compact ? undefined : "application-detail"}
        className="line-clamp-2 text-[15px] leading-[22px] font-semibold break-words outline-none after:absolute after:inset-0 after:rounded-xl"
        onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) event.preventDefault(); else event.stopPropagation(); }}>{item.vacancy.title}</Link>
      <span className="text-xs leading-4 break-words text-muted-foreground">{item.company.name} · Postulada {appliedAgo(item.applied_at, now)}</span>
      {chips && <span className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
        {compact && <Status item={item} />}
        {item.message !== null && <span data-pf-application-message-chip className={cn(CHIP, unread ? "bg-primary/9 text-primary-text" : "bg-muted text-muted-foreground")}><Mail aria-hidden="true" className="size-3 shrink-0" />{unread ? "Mensaje nuevo" : "Mensaje de la empresa"}</span>}
        {actionable && <Button variant="outline" className="relative min-h-10" onClick={event => { event.stopPropagation(); onSelect(event.currentTarget); }}>{assessment.status === "in_progress" ? `Evaluación · ${assessment.answered_count} de ${assessment.total_count}` : "Evaluación pendiente"}</Button>}
      </span>}
    </span>
    {!compact && <span className="justify-self-end"><Status item={item} /></span>}
    <ChevronRight aria-hidden="true" className={cn("size-4", active ? "text-primary-text" : "text-muted-foreground")} />
  </div>;
}

type Level = "h3" | "h4";
function Activity({ item, assessment, level: Heading }: { item: Application; assessment?: AccountAssessment; level: Level }) {
  const id = useId();
  // The account contract has no moved_at, updated_at, started_at or closed_at.
  const events = [
    { label: "Postulaste", at: item.applied_at },
    ...(assessment ? [{ label: "Recibiste una evaluación", at: assessment.created_at }] : []),
    ...(assessment?.status === "finished" && assessment.finished_at ? [{ label: "Terminaste la evaluación", at: assessment.finished_at }] : []),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return <section aria-labelledby={id} className="flex flex-col gap-3">
    <Heading id={id} className="flex items-center gap-2 text-sm font-semibold"><Clock3 aria-hidden="true" className="size-4 text-primary-text" />Actividad del proceso</Heading>
    <dl className="ml-[3px] flex flex-col gap-3.5 border-l border-border pl-[18px]">{events.map((event, index) => <div key={event.label} className={cn("relative flex flex-col gap-0.5 before:absolute before:top-1.5 before:-left-[22px] before:size-2 before:rounded-full before:content-['']", index === 0 ? "before:bg-primary-text" : "before:bg-border")}>
      <dt className="font-medium">{event.label}</dt><dd className="text-xs text-muted-foreground"><time dateTime={event.at}>{date.format(new Date(event.at))}</time></dd>
    </div>)}</dl>
  </section>;
}
function DetailBody({ item, assessment, level: Heading }: { item: Application; assessment?: AccountAssessment; level: Level }) {
  const id = useId();
  return <>
    <p className="flex flex-wrap items-center gap-x-2.5 gap-y-2 text-xs text-muted-foreground"><Status item={item} />Postulada el {date.format(new Date(item.applied_at))}</p>
    {assessment && <AssessmentBlock item={assessment} />}
    <Activity item={item} assessment={assessment} level={Heading} />
    {/* Open applications: the status chip already says it; only closures add information. */}
    {(item.status === "closed" || item.vacancy.state === "closed") && <p className="text-muted-foreground">{item.status === "closed" ? "El proceso de tu postulación finalizó." : "La empresa cerró esta vacante y finalizó el proceso."}</p>}
    {item.status === "closed" && item.message !== null && <section data-pf-application-message aria-labelledby={id} className="flex flex-col gap-3"><Heading id={id} className="flex items-center gap-2 text-sm font-semibold"><MessageSquare aria-hidden="true" className="size-4 text-primary-text" />Mensaje de la empresa</Heading><p className="text-sm leading-[22px] whitespace-pre-wrap break-words text-pretty">{item.message}</p></section>}
  </>;
}
function VacancyLink({ item }: { item: Application }) {
  return item.vacancy.id ? <Link href={`/vacantes/${item.vacancy.id}`} className={cn(buttonVariants({ variant: "outline" }), "min-h-11 w-full")}>Ver vacante<ArrowUpRight aria-hidden="true" data-icon="inline-end" /></Link> : <Button variant="outline" className="min-h-11 w-full" disabled>Vacante histórica sin enlace</Button>;
}
/** Light detail card beside the list (lg and up), or the existing full-screen record below lg (R6). No dark surface. */
export function ApplicationDetail({ item, assessment, mobileOpen, onClose, returnFocus }: { item: Application; assessment?: AccountAssessment; mobileOpen: boolean; onClose: () => void; returnFocus: React.RefObject<HTMLElement | null> }) {
  return mobileOpen ? <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    {/* Controlled, no Trigger: either row or chip opens this full-screen mobile record (R6).
        Dialog owns focus trapping/inert background; no nested cards in the modal. */}
    <DialogContent id="application-detail" showCloseButton={false} finalFocus={returnFocus} className="inset-0 flex h-dvh max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0 sm:max-w-none">
      <div className="shrink-0 px-2 pt-2"><Button variant="ghost" className="min-h-10" onClick={onClose}><ArrowLeft aria-hidden="true" />Volver a mis postulaciones</Button></div>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pt-3 pb-6">
        <div className="flex min-w-0 items-center gap-3.5"><PublicCompanyAvatar company={logo(item)} detail />
          <div className="flex min-w-0 flex-col gap-0.5"><DialogDescription>{item.company.name}</DialogDescription><DialogTitle className="text-xl leading-7 font-semibold tracking-tight text-balance break-words">{item.vacancy.title}</DialogTitle></div>
        </div>
        <DetailBody item={item} assessment={assessment} level="h3" />
      </div>
      <DialogFooter className="m-0 shrink-0 border-t border-border bg-background px-4 pt-3 pb-4"><VacancyLink item={item} /></DialogFooter>
    </DialogContent>
  </Dialog> : <aside id="application-detail" aria-label="Detalle de postulación" style={{ "--d": 1 } as CSSProperties} className={cn(CARD, "sticky top-4 hidden gap-5 p-7 lg:flex", motion.rise)}>
    <div className="flex min-w-0 items-center gap-3.5"><PublicCompanyAvatar company={logo(item)} detail />
      <div className="min-w-0"><p className="text-muted-foreground">{item.company.name}</p><h3 className="text-[22px] leading-7 font-semibold tracking-tight text-balance break-words">{item.vacancy.title}</h3></div>
    </div>
    <DetailBody item={item} assessment={assessment} level="h4" />
    <VacancyLink item={item} />
  </aside>;
}

/** The counts line while the list loads: never a real count shown as 0. */
export function SummarySkeleton() {
  return <Skeleton data-pf-applications-loading-summary aria-hidden="true" className="h-3.5 w-64 max-w-[70vw]" />;
}
/** Skeleton with the loaded footprint: the section card with four rows, and the detail card from lg. Never animates in. */
export function ApplicationsSkeleton() {
  return <section aria-busy="true" aria-label="Postulaciones" className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]"><span role="status" className="sr-only">Cargando postulaciones</span>
    <div aria-hidden="true" className={cn(CARD, "gap-1 px-1.5 pt-4 pb-1.5 sm:px-3 sm:pt-5 sm:pb-2")}>
      <Skeleton className="mx-2.5 mb-3 h-6 w-48 sm:mx-3" />
      {[0, 1, 2, 3].map(key => <div key={key} data-pf-applications-loading-row className="grid min-h-16 grid-cols-[48px_minmax(0,1fr)] items-center gap-2.5 px-2.5 sm:grid-cols-[48px_minmax(0,1fr)_84px] sm:gap-3.5 sm:px-3">
        <Skeleton className="size-12 rounded-xl" /><div className="grid gap-2"><Skeleton className="h-3.5 w-3/5" /><Skeleton className="h-3 w-2/5" /></div><Skeleton className="hidden h-5 w-20 sm:block" />
      </div>)}
    </div>
    <div aria-hidden="true" className={cn(CARD, "hidden gap-5 p-7 lg:flex")}>
      <div className="flex items-center gap-3.5"><Skeleton className="size-16 rounded-2xl" /><div className="grid flex-1 gap-2"><Skeleton className="h-3.5 w-2/5" /><Skeleton className="h-6 w-4/5" /></div></div>
      <Skeleton className="h-5 w-3/5" /><Skeleton className="h-24" /><Skeleton className="h-11" />
    </div>
  </section>;
}

/** First use (no applications at all): the tinted card shared with Guardadas, with two ways forward. */
export function FirstApplication() {
  const mini = (className: string, pill: string) => <div className={cn("absolute top-1/2 left-1/2 flex w-[170px] flex-col gap-2.5 rounded-[14px] bg-card p-3 shadow-[0_10px_24px_-10px_color-mix(in_srgb,var(--foreground)_22%,transparent),0_0_0_1px_var(--border)] sm:w-[220px] sm:p-3.5", className)}>
    <div className="flex items-center gap-2.5"><span className="size-8 shrink-0 rounded-[9px] bg-primary/12" /><span className="flex flex-1 flex-col gap-1.5"><span className="h-2 w-4/5 rounded-full bg-muted" /><span className="h-2 w-1/2 rounded-full bg-muted" /></span></div>
    <span className={cn("h-[18px] w-22 rounded-full", pill)} />
  </div>;
  return <section aria-labelledby="applications-empty-title" className={cn(CARD, "grid items-center gap-5 overflow-hidden px-5 py-6 sm:gap-8 sm:p-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)] xl:px-12 xl:py-10", motion.empty, motion.rise)}>
    <div className="flex max-w-[520px] flex-col gap-3">
      <p className="flex items-center gap-2 text-xs leading-4 font-semibold tracking-wider text-primary-text uppercase before:size-1.5 before:rounded-full before:bg-primary before:content-['']">Tu seguimiento</p>
      <h3 id="applications-empty-title" className="text-xl leading-7 font-semibold tracking-tight text-balance sm:text-2xl sm:leading-8">Todavía no te postulas a ninguna vacante</h3>
      <p className="text-sm leading-[22px] text-muted-foreground sm:text-[15px] sm:leading-6">Cuando envíes tu primera postulación, aquí verás su estado, la actividad del proceso y los mensajes de la empresa.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Link href="/vacantes" className={cn(buttonVariants(), "min-h-11 max-sm:flex-[1_1_100%]")}>Explorar vacantes<ArrowRight aria-hidden="true" data-icon="inline-end" /></Link>
        <Link href="/candidato/guardadas" className={cn(buttonVariants({ variant: "outline" }), "min-h-11 max-sm:flex-[1_1_100%]")}>Ver vacantes guardadas</Link>
      </div>
    </div>
    <div aria-hidden="true" className="relative -order-1 h-[150px] min-w-0 sm:h-[180px] xl:order-none xl:h-[220px]">{mini(motion.mini1, "bg-status-review/14")}{mini(motion.mini2, "bg-primary/12")}{mini(motion.mini3, "bg-status-info/14")}</div>
  </section>;
}
