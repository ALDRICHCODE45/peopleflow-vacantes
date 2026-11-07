"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChartNoAxesColumn, SearchX, TriangleAlert } from "lucide-react";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { StateCard } from "@/components/feedback/state-card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { HelpProvider } from "@/features/psychometrics/help/info-popover";
import { loadOverviewAction, type Overview } from "./actions";
import { failureMessage, filterIssueMessages } from "./failure";
import { MetricsFiltersBar, type RecruiterOption, type RequesterOption } from "./metrics-filters";
import { MetricsRestricted } from "./metrics-page";
import { momentLabel, type MetricsFailure, type MetricsResult } from "./model";
import { mexicoToday, periodLabel } from "./period";
import { RecruiterTable } from "./recruiter-table";
import { SummaryCards } from "./summary-cards";
import { useMetricsUrl } from "./use-metrics-url";
import { effectivePeriod, serializeFilters, type MetricsFilters } from "./url-state";

const noResponse: MetricsFailure = { ok: false, reason: "no_response", reference: {} };

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

const isQuiet = ({ summary, recruiters }: Overview) => recruiters.length === 0 && summary.vacancies.assigned === 0 && summary.delivery.total === 0
  && summary.placements.credits === 0 && summary.reassignments.total === 0 && Object.values(summary.origin).every(value => value === 0)
  && summary.closed_by_month.every(month => month.filled + month.cancelled + month.other + month.no_reason === 0);

/** Options seen so far stay available while a filter narrows the answer, so a filter never hides its own choices. */
function useRememberedOptions(overview: Overview | null) {
  const recruiters = useRef(new Map<string, RecruiterOption>());
  const requesters = useRef(new Map<string, RequesterOption>());
  if (overview) {
    for (const card of overview.recruiters) recruiters.current.set(card.user_id, { user_id: card.user_id, name: card.name, former_member: card.former_member });
    for (const row of overview.summary.by_requester) if (row.kind && row.id) requesters.current.set(`${row.kind}:${row.id}`, { kind: row.kind, id: row.id, name: row.name });
  }
  const byName = (a: { name: string | null }, b: { name: string | null }) => (a.name ?? "").localeCompare(b.name ?? "", "es");
  return { recruiters: [...recruiters.current.values()].sort(byName), requesters: [...requesters.current.values()].sort(byName) };
}

/** `/empresa/metricas` (artboard 01, corrected by L8): period and filters, company summary and recruiter table. */
export function MetricsWorkspace({ details }: { details?: (filters: MetricsFilters) => ReactNode }) {
  const { filters, key, update } = useMetricsUrl();
  const [today] = useState(mexicoToday);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ result: MetricsResult<Overview>; at: Date } | null>(null);
  const filtersRef = useRef(filters); filtersRef.current = filters;
  useEffect(() => {
    let active = true;
    setState(null);
    void loadOverviewAction(filtersRef.current).catch(() => noResponse).then(result => { if (active) setState({ result, at: new Date() }); });
    return () => { active = false; };
  }, [key, attempt]);
  const overview = state?.result.ok ? state.result.data : null;
  const options = useRememberedOptions(overview);
  const period = effectivePeriod(filters, today);
  const narrowed = Boolean(filters.recruiter_id || filters.requester_kind || filters.requester_id);
  const recruiterHref = (userId: string) => {
    const query = serializeFilters(period).toString();
    return `/empresa/metricas/reclutadores/${userId}?${query}`;
  };

  return <DashboardPageContent width="screen-2xl" className="min-w-0 gap-5 md:gap-6">
    <MetricsHeading title="Métricas de la empresa" version={overview?.summary.definitions_version} computedAt={overview ? state?.at : undefined}
      description="Rendimiento de tu empresa en el periodo elegido. Cada número tiene su definición escrita: abre el ícono de información para leerla." />
    <MetricsFiltersBar filters={filters} today={today} recruiters={options.recruiters} requesters={options.requesters} onChange={update} />
    {narrowed && <p role="status" className="text-sm text-muted-foreground"><span aria-hidden="true" className="text-primary">● </span>Vista filtrada · El resumen y las fichas consideran solo las vacantes que coinciden con los filtros.</p>}
    {!state ? <MetricsSkeleton />
      : !state.result.ok ? <MetricsFailureCard failure={state.result} onRetry={() => setAttempt(value => value + 1)} onReset={() => update({})} />
      : isQuiet(state.result.data) ? narrowed
        ? <StateCard icon={SearchX} tone="empty" title="Sin resultados" description="Ninguna vacante coincide con el reclutador y el cliente o área elegidos en este periodo." primaryAction={{ label: "Limpiar filtros", onClick: () => update(period) }} />
        : <StateCard icon={ChartNoAxesColumn} tone="empty" title="No hubo actividad en este periodo" description={`Del ${periodLabel(period)} no se asignó, cerró ni entregó ninguna vacante publicada. Prueba con un periodo más amplio.`} primaryAction={{ label: "Ver últimos 90 días", onClick: () => update({}) }} />
      : <HelpProvider>
        <SummaryCards summary={state.result.data.summary} />
        <RecruiterTable items={state.result.data.recruiters} href={card => recruiterHref(card.user_id)} />
      </HelpProvider>}
    {state?.result.ok && details?.(filters)}
  </DashboardPageContent>;
}
