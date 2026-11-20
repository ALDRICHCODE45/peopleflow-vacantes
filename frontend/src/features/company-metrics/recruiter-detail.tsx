"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, UserX } from "lucide-react";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { StateCard } from "@/components/feedback/state-card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { accentAvatar } from "@/lib/accent";
import { cn } from "@/lib/utils";
import { initials } from "@/features/pipeline-movement/pipeline-presentation";
import { loadRecruiterAction } from "./actions";
import { VacancyList } from "./detail-lists";
import { drilldownHref, recruiterPath } from "./drilldown";
import { fieldErrors } from "./failure";
import { MetricsAccessGate } from "./metrics-page";
import { MetricsFailureCard } from "./metrics-workspace";
import { dayLabel, momentLabel, personName, type VacancyRow } from "./model";
import { mexicoToday, type Period } from "./period";
import { ProcessNote } from "./process-kind";
import { MonthlySection } from "./recruiter-detail/monthly";
import { HelpList, see, type Drill, type Who } from "./recruiter-detail/parts";
import { PeriodControl } from "./recruiter-detail/period-control";
import { DeliveriesSection, SummarySection, targets, WorkloadSection } from "./recruiter-detail/sections";
import { MetricsSection } from "./section";
import { useMetricsUrl } from "./use-metrics-url";
import { useSection } from "./use-section";
import { effectivePeriod, serializeFilters, type MetricsFilters } from "./url-state";

type Role = "owner" | "stakeholder";
/** How far below the viewport the vacancy list starts loading (rule 17), as the board's lazy sections. */
const NEAR_VIEWPORT = "600px 0px";

/** True once the node approaches the viewport (at once without IntersectionObserver). */
function useNear() {
  const [near, setNear] = useState(false);
  const observer = useRef<IntersectionObserver | null>(null);
  const ref = useCallback((node: Element | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") { setNear(true); return; }
    const watcher = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { watcher.disconnect(); setNear(true); } }, { rootMargin: NEAR_VIEWPORT });
    watcher.observe(node);
    observer.current = watcher;
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  return { near, ref };
}

/** «Vacantes con su participación»: below the fold, so its list loads when it approaches the viewport. */
function VacanciesSection({ who, assigned, period, process, drill, vacancyHref }: { who: Who | null; assigned: number; period: Period; process: Pick<MetricsFilters, "process_kind">; drill: Drill; vacancyHref: (row: VacancyRow) => string }) {
  const { near, ref } = useNear();
  const ready = near && who !== null;
  const retry = useCallback(() => {}, []);
  const detailHref = who ? drill(targets(who.id).assigned, assigned) : null;
  return <MetricsSection title="Vacantes con su participación" helpFirst
    state={{ status: ready ? "ready" : "idle", data: ready ? who : null, stale: false, failure: null, ref, retry }}
    help={{ title: "Cómo se lee la lista de vacantes", body: <HelpList items={[
      ["Vacantes", `Las vacantes asignadas a ${who?.first ?? "la persona"} en el periodo, con su entrega, su último cierre, posiciones cubiertas y reasignaciones.`],
      ["Datos personales", "La lista no muestra nombres de candidatos. «Entregados» los abre aparte y esa consulta queda registrada en Auditoría."],
    ]} /> }}
    actions={detailHref && who && <Link href={detailHref} aria-label={`${see(assigned, "f", "vacante asignada", "vacantes asignadas")} a ${who.name} en el detalle`}
      className={cn(buttonVariants({ variant: "ghost" }), "min-h-10 text-muted-foreground")}>Ver en detalle<ChevronRight aria-hidden="true" data-icon="inline-end" /></Link>}
    skeleton={<Card className="gap-0 p-6" aria-hidden="true">
      <Skeleton className="mb-4 h-4 w-full max-w-xl" />
      {[0, 1, 2, 3].map(index => <div key={index} className="flex h-16 items-center justify-between gap-4 border-t"><Skeleton className="h-4 w-56" /><Skeleton className="h-4 w-20" /></div>)}
    </Card>}>
    {person => <Card className="gap-4 p-6">
      {/* The flat vacancies list is roots only (replacement-processes-v1 «Metrics»): it never follows the process filter. */}
      <ProcessNote filters={process}>Esta lista no cambia con el filtro de proceso: cuenta cada vacante una sola vez.</ProcessNote>
      <VacancyList filters={{ ...period, ...process, recruiter_id: person.id }} person={person.name} drill={drill} vacancyHref={vacancyHref} />
    </Card>}
  </MetricsSection>;
}

function RecruiterDetailWorkspace({ userId, role }: { userId: string; role: Role }) {
  const { filters, update } = useMetricsUrl();
  const [today] = useState(mexicoToday);
  // The page reads the period and the process filter only; the board's other filters do not narrow one person's numbers.
  const process = filters.process_kind ? { process_kind: filters.process_kind } : {};
  const periodFilters: MetricsFilters = { ...(filters.from ? { from: filters.from } : {}), ...(filters.to ? { to: filters.to } : {}), ...process };
  const load = useCallback((next: MetricsFilters) => loadRecruiterAction({ userId, filters: next }), [userId]);
  const state = useSection(load, periodFilters, `${userId}?${serializeFilters(periodFilters)}`);
  const period = effectivePeriod(filters, today);
  // Back keeps the board window and the process filter only, never this person as a filter (L47); replace, so the browser's Back skips it.
  const scope: MetricsFilters = { ...period, ...process };
  const back = `/empresa/metricas?${serializeFilters(scope)}`;
  const data = state.status === "failed" ? null : state.data;
  const name = data ? personName(data) : null;
  const who: Who | null = name ? { id: userId, name, first: name.split(/\s+/)[0] } : null;
  // Every figure opened from here returns to this page with its window (drill-down «back», `drilldown.ts`).
  const here = recruiterPath(userId, scope);
  const drill: Drill = (target, count) => drilldownHref(target, scope, { count, back: here });
  // The role decides where a vacancy opens (v2 §7): the owner its board, a stakeholder its records inside Métricas.
  const vacancyHref = (row: VacancyRow) => role === "owner" ? `/empresa/vacantes/${row.draft_id}/pipeline`
    : drilldownHref({ kind: "deliveries", params: { vacancy_id: row.draft_id } }, scope, { back: here }) ?? here;
  const failure = state.status === "failed" ? state.failure : null;

  if (failure?.reason === "not_found") return <DashboardPageContent width="screen-2xl" className="min-w-0 gap-6">
    <StateCard icon={UserX} tone="empty" title="Esta persona no tiene historial en la empresa" description="No tuvo tramos en ninguna vacante de tu empresa, así que no hay ficha que mostrar." primaryAction={{ label: "Volver a Métricas", href: back }} />
  </DashboardPageContent>;

  const shown = data ? { from: data.period.from, to: data.period.to } : period;
  const freshness = [data?.as_of && `Actualizado ${momentLabel(data.as_of)}`, `${dayLabel(shown.from)} – ${dayLabel(shown.to)}`, data && `Definiciones ${data.definitions_version}`,
    filters.process_kind && `Solo ${filters.process_kind === "replacement" ? "reemplazos" : "originales"}`].filter(Boolean).join(" · ");
  const periodError = failure?.reason === "invalid_filter" ? (({ from, to }) => from ?? to)(fieldErrors(failure.fields)) : undefined;
  const sections = { state, drill, who: who ?? { id: userId, name: "", first: "" }, filters: process };

  return <DashboardPageContent width="screen-2xl" className="min-w-0 gap-10 max-md:gap-8">
    <div className="flex flex-col gap-4">
      <nav aria-label="Ruta" className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link href={back} replace className="-ml-2 inline-flex min-h-10 items-center gap-1 rounded-lg px-2 font-medium text-primary-text outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronLeft aria-hidden="true" className="size-4" />Métricas
        </Link>
        <ChevronRight aria-hidden="true" className="size-3.5" />
        {name ? <span aria-current="page" className="min-w-0 truncate font-medium text-foreground">{name}</span> : <Skeleton className="h-4 w-32" />}
      </nav>
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 items-center gap-4 max-md:gap-3">
          {name ? <Avatar className="size-12 max-md:size-10"><AvatarFallback className={cn(accentAvatar, "text-base")}>{initials(name)}</AvatarFallback></Avatar>
            : <Skeleton className="size-12 rounded-full max-md:size-10" />}
          <div className="flex min-w-0 flex-col gap-2">
            {name ? <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h2 className="font-heading text-2xl font-semibold tracking-tight max-md:text-[22px]">{name}</h2>
              {data?.former_member && <Badge variant="neutral" title="Ya no pertenece a la empresa; su historial se conserva">Ex miembro</Badge>}
            </div> : <Skeleton className="h-8 w-56" />}
            <p className="text-xs text-muted-foreground">{freshness}</p>
          </div>
        </div>
        <PeriodControl period={period} today={today} error={periodError} onChange={next => update({ ...next, ...process })} />
      </header>
    </div>
    {failure ? <MetricsFailureCard failure={failure} subject="la ficha" onRetry={state.retry} onReset={() => update({})} />
      : <>
        <SummarySection {...sections} />
        <DeliveriesSection {...sections} />
        <WorkloadSection {...sections} />
        <MonthlySection {...sections} period={period} today={today} />
        <VacanciesSection who={who} assigned={data?.vacancies.assigned ?? 0} period={period} process={process} drill={drill} vacancyHref={vacancyHref} />
      </>}
  </DashboardPageContent>;
}

/** `/empresa/metricas/reclutadores/[userId]` (artboard 10): the role gate first, then one recruiter's numbers. */
export function RecruiterDetailPage({ userId }: { userId: string }) {
  return <MetricsAccessGate label="Cargando la ficha">{role => <RecruiterDetailWorkspace userId={userId} role={role} />}</MetricsAccessGate>;
}
