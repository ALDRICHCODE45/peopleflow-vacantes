import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Clock3, MessageSquare } from "lucide-react";
import { cn } from "cn";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { AssessmentBlock, actionableAssessment } from "@/features/psychometrics/workspace/assessments";
import type { AccountAssessment } from "@/features/psychometrics/model";
import type { ApplicationsPage } from "./model";

export type Application = ApplicationsPage["items"][number];
const date = new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "UTC" });
const relative = new Intl.RelativeTimeFormat("es-MX", { numeric: "always" });
const initials = (name: string) => name.trim().split(/\s+/u).slice(0, 2).map(word => Array.from(word)[0]).join("").toUpperCase();
export const applicationStatus = (item: Application) => item.status === "closed" ? "Cerrada" : item.vacancy.state === "closed" ? "Vacante cerrada" : item.status === "submitted" ? "Enviada" : "En proceso";
function Status({ item, detail = false }: { item: Application; detail?: boolean }) {
  return <Badge variant={item.status === "closed" || item.vacancy.state === "closed" ? "neutral" : item.status === "submitted" ? "info" : "review"} dot>{detail ? `Estado: ${applicationStatus(item)}` : applicationStatus(item)}</Badge>;
}
function appliedAgo(value: string, now: number) {
  const days = Math.floor((now - Date.parse(value)) / 86400000);
  return relative.format(-Math.max(0, days), "day");
}
export function ApplicationRow({ item, assessment, selected, onSelect, now }: { item: Application; assessment?: AccountAssessment; selected: boolean; onSelect: (target: HTMLElement) => void; now: number }) {
  const actionable = assessment && actionableAssessment(assessment, now);
  return <Item variant="outline" data-pf-application-row data-selected={selected} className={cn("relative min-w-0 cursor-pointer outline-none transition-colors hover:bg-muted hover:text-foreground has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/30", selected ? "border-transparent bg-card text-foreground shadow-sm ring-1 ring-primary/40" : "text-muted-foreground")} onClick={event => onSelect(event.currentTarget.querySelector("a")!)}>
    <ItemMedia><Avatar className="size-10" aria-hidden="true"><AvatarFallback>{initials(item.company.name)}</AvatarFallback></Avatar></ItemMedia>
    <ItemContent className="min-w-0">
      <ItemTitle className="text-foreground"><h3 className="truncate">
        {/* Preserve the vacancy href for no-JS / modified clicks; ordinary activation selects the full record. */}
        <Link href={`/vacantes/${item.vacancy.id}`} aria-current={selected ? "true" : undefined} aria-controls="application-detail" className="outline-none after:absolute after:inset-0 after:rounded-2xl" onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) event.preventDefault(); else event.stopPropagation(); }}>{item.vacancy.title}</Link>
      </h3></ItemTitle>
      <ItemDescription>{item.company.name} · Postulada {appliedAgo(item.applied_at, now)}</ItemDescription>
    </ItemContent>
    <ItemActions className="flex-wrap">
      <Status item={item} />
      {actionable && <Button variant="outline" className="relative min-h-10" onClick={event => { event.stopPropagation(); onSelect(event.currentTarget); }}>{assessment.status === "in_progress" ? `Evaluación · ${assessment.answered_count} de ${assessment.total_count}` : "Evaluación pendiente"}</Button>}
    </ItemActions>
  </Item>;
}

function Activity({ item, assessment }: { item: Application; assessment?: AccountAssessment }) {
  // The account contract has no moved_at, updated_at, started_at or closed_at.
  const events = [
    { label: "Postulaste", at: item.applied_at },
    ...(assessment ? [{ label: "Recibiste una evaluación", at: assessment.created_at }] : []),
    ...(assessment?.status === "finished" && assessment.finished_at ? [{ label: "Terminaste la evaluación", at: assessment.finished_at }] : []),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return <section aria-labelledby="application-activity" className="flex flex-col gap-4">
    <h3 id="application-activity" className="flex items-center gap-2 text-sm font-semibold"><Clock3 aria-hidden="true" className="size-4 text-muted-foreground" />Actividad del proceso</h3>
    <dl className="flex flex-col gap-4 border-l border-border pl-4">{events.map(event => <div key={event.label} className="relative flex flex-col gap-1 before:absolute before:top-1.5 before:-left-5 before:size-2 before:rounded-full before:bg-border"><dt className="text-sm">{event.label}</dt><dd className="text-xs text-muted-foreground"><time dateTime={event.at}>{date.format(new Date(event.at))}</time></dd></div>)}</dl>
  </section>;
}
function DetailBody({ item, assessment }: { item: Application; assessment?: AccountAssessment }) {
  return <>
    {assessment && <AssessmentBlock item={assessment} />}
    <Activity item={item} assessment={assessment} />
    {/* Open applications: the status chip already says it; only closures add information. */}
    {(item.status === "closed" || item.vacancy.state === "closed") && <p className="text-sm text-muted-foreground">{item.status === "closed" ? "El proceso de tu postulación finalizó." : "La empresa cerró esta vacante y finalizó el proceso."}</p>}
    {item.status === "closed" && item.message !== null && <section data-pf-application-message className="flex flex-col gap-2 border-t border-border pt-4"><h3 className="flex items-center gap-2 text-sm font-semibold"><MessageSquare aria-hidden="true" className="size-4 text-muted-foreground" />Mensaje de la empresa</h3><p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{item.message}</p></section>}
  </>;
}
function VacancyLink({ item }: { item: Application }) {
  return item.vacancy.id ? <Link href={`/vacantes/${item.vacancy.id}`} className={cn(buttonVariants({ variant: "outline" }), "min-h-10 w-full")}>Ver vacante<ArrowUpRight aria-hidden="true" data-icon="inline-end" /></Link> : <Button variant="outline" disabled>Vacante histórica sin enlace</Button>;
}
export function ApplicationDetail({ item, assessment, mobileOpen, onClose, returnFocus }: { item: Application; assessment?: AccountAssessment; mobileOpen: boolean; onClose: () => void; returnFocus: React.RefObject<HTMLElement | null> }) {
  return mobileOpen ? <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    {/* Controlled, no Trigger: either row or chip opens this full-screen mobile record (R6).
        Dialog owns focus trapping/inert background; no nested cards in the modal. */}
    <DialogContent id="application-detail" showCloseButton={false} finalFocus={returnFocus} className="inset-0 flex h-dvh max-w-none translate-x-0 translate-y-0 flex-col rounded-none sm:max-w-none">
      <DialogHeader className="shrink-0 border-b border-border pb-4"><Button variant="ghost" className="min-h-10 self-start" onClick={onClose}><ArrowLeft aria-hidden="true" />Volver a mis postulaciones</Button><DialogTitle>{item.vacancy.title}</DialogTitle><DialogDescription>{item.company.name}</DialogDescription><Status item={item} detail /></DialogHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto"><DetailBody item={item} assessment={assessment} /></div>
      <DialogFooter className="shrink-0 border-t border-border pt-4"><VacancyLink item={item} /></DialogFooter>
    </DialogContent>
  </Dialog> : <aside id="application-detail" aria-label="Detalle de postulación" className="hidden min-w-0 lg:sticky lg:top-4 lg:block">
    <Card>
      <CardHeader className="border-b"><CardTitle><h2 className="break-words text-xl font-semibold">{item.vacancy.title}</h2></CardTitle><CardDescription>{item.company.name}</CardDescription><CardAction><Status item={item} detail /></CardAction></CardHeader>
      <CardContent className="flex max-h-[calc(100dvh-25rem)] min-h-52 flex-col gap-5 overflow-y-auto"><DetailBody item={item} assessment={assessment} /></CardContent>
      <CardFooter className="border-t"><VacancyLink item={item} /></CardFooter>
    </Card>
  </aside>;
}
export function ApplicationsSkeleton() {
  return <section aria-busy="true" aria-label="Postulaciones" className="flex flex-col gap-5"><span role="status" className="sr-only">Cargando postulaciones</span>
    <div data-pf-applications-loading-search aria-hidden="true" className="flex flex-wrap justify-between gap-3"><Skeleton className="h-9 w-96 max-w-full" /><Skeleton className="h-11 w-60" /></div>
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_368px]"><ul aria-label="Mis postulaciones" className="grid gap-2">{[0, 1, 2].map(index => <li key={index}><Item variant="outline" aria-hidden="true"><ItemMedia><Skeleton className="size-10 rounded-full" /></ItemMedia><ItemContent className="min-w-0"><ItemTitle><Skeleton className="h-5 w-36 max-w-full" /></ItemTitle><Skeleton className="h-4 w-48 max-w-full"><ItemDescription /></Skeleton></ItemContent><ItemActions><Skeleton className="h-5 w-16" /></ItemActions></Item></li>)}</ul><Skeleton aria-hidden="true" className="hidden h-96 w-full lg:block" /></div>
  </section>;
}
