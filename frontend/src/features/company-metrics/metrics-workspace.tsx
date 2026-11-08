"use client";
import { useRef, useState, type ReactNode } from "react";
import { ChartNoAxesColumn, SearchX, TriangleAlert } from "lucide-react";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { StateCard } from "@/components/feedback/state-card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { loadClosuresAction, loadComplianceAction, loadDelaysAction, loadOriginAction, loadRecruitersAction, loadSummaryAction } from "./actions";
import { failureMessage, fieldErrors, filterIssueMessages } from "./failure";
import type { RecruiterOption, RequesterOption } from "./metrics-filters";
import { MetricsBoardHeader } from "./metrics-header";
import { MetricsRestricted } from "./metrics-page";
import { dayLabel, momentLabel, type MetricsFailure, type MetricsSummary, type RecruiterCard } from "./model";
import { mexicoToday } from "./period";
import { ClosuresSection } from "./sections/closures-section";
import { ComplianceSection } from "./sections/compliance-section";
import { DelaysSection } from "./sections/delays-section";
import { OriginSection } from "./sections/origin-section";
import { RecruitersSection } from "./sections/recruiters-section";
import { SummaryStrip } from "./sections/summary-strip";
import { useMetricsUrl } from "./use-metrics-url";
import { useSection } from "./use-section";
import { effectivePeriod, NO_REQUESTER, type MetricsFilters } from "./url-state";

export function MetricsHeading({ title, description, version, computedAt }: { title: string; description: ReactNode; version?: string; computedAt?: Date }) {
  return <header className="flex flex-wrap items-end justify-between gap-3">
    <div className="flex max-w-prose flex-col gap-2">
      <h2 className="font-heading text-2xl font-semibold tracking-tight text-balance">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
    {version && <div className="flex flex-col items-end gap-1">
      <Badge variant="outline">{`Definiciones ${version}`}</Badge>
      {computedAt && <p className="text-xs text-muted-foreground">{`Calculado al abrir · ${momentLabel(computedAt)} · hora del centro de México`}</p>}
    </div>}
  </header>;
}

export function MetricsFailureCard({ failure, onRetry, onReset, subject = "las métricas" }: { failure: MetricsFailure; onRetry: () => void; onReset: () => void; subject?: string }) {
  if (failure.reason === "forbidden") return <MetricsRestricted />;
  if (failure.reason === "unauthenticated") return <StateCard icon={TriangleAlert} tone="error" title="Tu sesión terminó" description={failureMessage(failure, subject)} primaryAction={{ label: "Iniciar sesión", href: "/empresa/login" }} />;
  if (failure.reason === "invalid_filter") return <StateCard icon={SearchX} tone="error" title="No pudimos aplicar los filtros"
    description={<>{failureMessage(failure)}{filterIssueMessages(failure.fields).map(message => <span key={message} className="block">{message}</span>)}</>}
    primaryAction={{ label: "Restablecer vista", onClick: onReset }} />;
  return <StateCard icon={TriangleAlert} tone="error" title={`No pudimos calcular ${subject}`} description={failureMessage(failure, subject)} primaryAction={{ label: "Reintentar", onClick: onRetry }} />;
}

export function MetricsSkeleton() {
  return <div role="status" aria-label="Calculando las métricas del periodo" aria-busy="true" className="flex flex-col gap-4">
    <div className="grid gap-4 lg:grid-cols-3">{[0, 1, 2].map(index => <Skeleton key={index} aria-hidden="true" className="h-64 w-full" />)}</div>
    <Skeleton aria-hidden="true" className="h-80 w-full" />
  </div>;
}

/** What each filter keeps (§3.7.3): a recruiter narrows vacancies by their tramos and reassignments by lost or received. */
export function filteredViewNote(filters: MetricsFilters): string {
  const parts = [
    filters.recruiter_id && "Reclutador: el resumen y las vacantes cuentan las vacantes en las que esa persona tuvo un tramo en el periodo; las reasignaciones, las que perdió o recibió.",
    (filters.requester_kind || filters.requester_id) && "Cliente o área: se cuentan solo las vacantes con ese solicitante actual.",
  ].filter(Boolean);
  return `Vista filtrada · ${parts.join(" ")}`;
}

const quiet = (summary: MetricsSummary) => summary.vacancies.assigned === 0 && summary.delivery.total === 0 && summary.placements.credits === 0
  && summary.reassignments.total === 0 && Object.values(summary.origin).every(value => value === 0)
  && summary.closed_by_month.every(month => month.filled + month.cancelled + month.other + month.no_reason === 0);

/** Options seen so far stay available while a filter narrows the answer, so a filter never hides its own choices. */
function useRememberedOptions(summary: MetricsSummary | null, cards: RecruiterCard[] | null) {
  const recruiters = useRef(new Map<string, RecruiterOption>());
  const requesters = useRef(new Map<string, RequesterOption>());
  for (const card of cards ?? []) recruiters.current.set(card.user_id, { user_id: card.user_id, name: card.name, former_member: card.former_member });
  for (const { requester } of summary?.by_requester ?? []) if (requester) requesters.current.set(`${requester.kind}:${requester.id ?? NO_REQUESTER}`, requester);
  // Both lists keep the backend order as first seen (§3.7.11); they are never re-sorted here.
  return { recruiters: [...recruiters.current.values()], requesters: [...requesters.current.values()] };
}

/**
 * `/empresa/metricas` (artboard 07, `design/system.md` «Dashboards and metrics»): header with period and filters, then
 * each section loading on its own; the sections below the fold load as they approach the viewport (rule 17).
 */
export function MetricsWorkspace({ details }: { details?: (filters: MetricsFilters) => ReactNode }) {
  const { filters, key, update } = useMetricsUrl();
  const [today] = useState(mexicoToday);
  const summary = useSection(loadSummaryAction, filters, key);
  const closures = useSection(loadClosuresAction, filters, key, { lazy: true });
  const compliance = useSection(loadComplianceAction, filters, key, { lazy: true });
  const delays = useSection(loadDelaysAction, filters, key, { lazy: true });
  const recruiters = useSection(loadRecruitersAction, filters, key, { lazy: true });
  const origin = useSection(loadOriginAction, filters, key, { lazy: true });
  const options = useRememberedOptions(summary.data, recruiters.data);
  const period = effectivePeriod(filters, today);
  const narrowed = Boolean(filters.recruiter_id || filters.requester_kind || filters.requester_id);
  const sectionProps = { filters, period };
  const invalid = summary.failure?.reason === "invalid_filter" ? summary.failure : null;
  const blocking = summary.failure && ["forbidden", "unauthenticated", "invalid_filter"].includes(summary.failure.reason) ? summary.failure : null;
  const settledQuiet = summary.status === "ready" && summary.data !== null && quiet(summary.data);

  return <DashboardPageContent width="screen-2xl" className="min-w-0 gap-10">
    <MetricsBoardHeader filters={filters} today={today} asOf={summary.data?.as_of} version={summary.data?.definitions_version}
      appliedPeriod={summary.data ? { from: summary.data.period.from, to: summary.data.period.to } : undefined}
      recruiters={options.recruiters} requesters={options.requesters} serverErrors={invalid ? fieldErrors(invalid.fields) : undefined}
      onChange={update} onFiltersOpen={recruiters.activate} />
    {blocking ? <MetricsFailureCard failure={blocking} onRetry={summary.retry} onReset={() => update({})} />
      : settledQuiet ? narrowed
        ? <StateCard icon={SearchX} tone="empty" title="Sin resultados" description="Ninguna vacante coincide con el reclutador y el cliente o área elegidos en este periodo." primaryAction={{ label: "Limpiar filtros", onClick: () => update(period) }} />
        : <StateCard icon={ChartNoAxesColumn} tone="empty" title="No hubo actividad en este periodo" description={`Entre el ${dayLabel(period.from)} y el ${dayLabel(period.to)} no se asignó, cerró ni entregó ninguna vacante publicada. Prueba con un periodo más amplio.`} primaryAction={{ label: "Ver últimos 90 días", onClick: () => update({}) }} />
      : <>
        <SummaryStrip state={summary} {...sectionProps} />
        <ClosuresSection state={closures} {...sectionProps} />
        <ComplianceSection state={compliance} {...sectionProps} />
        <DelaysSection state={delays} {...sectionProps} />
        <RecruitersSection state={recruiters} {...sectionProps} />
        <OriginSection state={origin} {...sectionProps} />
        {details?.(filters)}
      </>}
  </DashboardPageContent>;
}
