"use client";
import { useEffect, useRef, useState, type ComponentType, type ReactNode, type SVGProps } from "react";
import Link from "next/link";
import { ArrowLeft, BriefcaseBusiness, Clock, Repeat, UserCheck, UserX } from "lucide-react";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { StateCard } from "@/components/feedback/state-card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { accentAvatar } from "@/lib/accent";
import { initials } from "@/features/pipeline-movement/pipeline-presentation";
import { HelpProvider } from "@/features/psychometrics/help/info-popover";
import { loadRecruiterAction } from "./actions";
import { fieldErrors } from "./failure";
import { VacancyList } from "./detail-lists";
import { Legend, SegmentedBar, segmentsLabel, Stat, type Segment } from "./metric-parts";
import { MetricsFiltersBar } from "./metrics-filters";
import { MetricsAccessGate } from "./metrics-page";
import { MetricsFailureCard, MetricsHeading, MetricsSkeleton } from "./metrics-workspace";
import { formatMedian, formatRate, number, personName, placementTotal, plural, type MetricsFailure, type MetricsResult, type RecruiterDetail } from "./model";
import { MonthlySeries } from "./monthly-series";
import { mexicoToday, periodLabel } from "./period";
import { useMetricsUrl } from "./use-metrics-url";
import { effectivePeriod, serializeFilters, type MetricsFilters } from "./url-state";

const noResponse: MetricsFailure = { ok: false, reason: "no_response", reference: {} };

function CardBlock({ title, icon: Icon, children }: { title: string; icon: ComponentType<SVGProps<SVGSVGElement>>; children: ReactNode }) {
  return <Card role="region" aria-label={title} size="sm" className="min-w-0">
    <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Icon aria-hidden="true" className="size-4 text-muted-foreground" /><h3>{title}</h3></CardTitle></CardHeader>
    <CardContent className="flex flex-col gap-3">{children}</CardContent>
  </Card>;
}

/** The card of §2.8 in the order of the company table: volume, punctuality, conversion, reassignments. */
function RecruiterCardView({ detail }: { detail: RecruiterDetail }) {
  const { vacancies, delivery, placements, reassignments } = detail;
  const segments: Segment[] = [
    { label: "A tiempo", value: delivery.on_time, tone: "success" },
    { label: "Tarde", value: delivery.late, tone: "review" },
    { label: "Vencidas", value: delivery.overdue, tone: "danger" },
  ];
  const conversion = formatRate(placements.conversion);
  return <section aria-label="Ficha" className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-4">
    <CardBlock title="Volumen" icon={BriefcaseBusiness}>
      <Stat label="Vacantes asignadas" metric="assigned" value={number.format(vacancies.assigned)}
        detail={`Responsable en ${vacancies.as_responsible} · colabora en ${vacancies.as_collaborator} · miembro en ${vacancies.as_member} · ${plural(vacancies.started_in_period, "nueva", "nuevas")}`} />
      <Stat label="Entregados en su tramo" metric="delivered_in_tramo" value={number.format(delivery.delivered_in_tramo)} detail={`${number.format(delivery.delivered_in_tramo)} entregados en su tramo`} />
    </CardBlock>
    <CardBlock title="Puntualidad" icon={Clock}>
      <Stat label="Entregas a tiempo" metric="delivery" value={number.format(delivery.on_time)} detail={`${plural(delivery.late, "tarde", "tarde")} · ${plural(delivery.overdue, "vencida", "vencidas")}`} />
      <SegmentedBar segments={segments} label={segmentsLabel("Entregas", segments)} />
      <Legend segments={segments} />
      <Stat label="Mediana a la meta" metric="time_to_target" value={formatMedian(delivery.median_business_days_to_target)} />
    </CardBlock>
    <CardBlock title="Conversión a placement" icon={UserCheck}>
      <Stat label="Conversión" metric="conversion" value={conversion.value} detail={conversion.detail && `${conversion.detail} cerradas`} />
      <Stat label="Placements" metric="placements" value={number.format(placementTotal(placements))}
        detail={`${plural(placementTotal(placements), "placement", "placements")}: ${plural(placements.direct, "directo", "directos")}, ${placements.participant} por participación, ${plural(placements.shared, "compartido", "compartidos")} · de ellos, ${plural(placements.did_not_hold, "no se sostuvo", "no se sostuvieron")}`} />
    </CardBlock>
    <CardBlock title="Reasignaciones" icon={Repeat}>
      <Stat label="Recibidas" metric="reassignments" value={number.format(reassignments.received)} detail={plural(reassignments.lost, "perdida", "perdidas")} />
      <Stat label="Días hábiles en tramos" metric="business_days" value={number.format(detail.business_days_in_tramos)} />
    </CardBlock>
  </section>;
}

function RecruiterDetailWorkspace({ userId }: { userId: string }) {
  const { filters, key, update } = useMetricsUrl();
  const [today] = useState(mexicoToday);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<MetricsResult<RecruiterDetail> | null>(null);
  // The card reads the period only; the company view's filters do not narrow one person's card.
  const periodFilters: MetricsFilters = { ...(filters.from ? { from: filters.from } : {}), ...(filters.to ? { to: filters.to } : {}) };
  const filtersRef = useRef(periodFilters); filtersRef.current = periodFilters;
  useEffect(() => {
    let active = true;
    setResult(null);
    void loadRecruiterAction({ userId, filters: filtersRef.current }).catch(() => noResponse).then(next => { if (active) setResult(next); });
    return () => { active = false; };
  }, [userId, key, attempt]);
  const period = effectivePeriod(filters, today);
  const back = `/empresa/metricas?${serializeFilters(period)}`;
  const backLink = <Button variant="ghost" className="min-h-10 w-fit" nativeButton={false} role="link" render={<Link href={back} />}><ArrowLeft aria-hidden="true" data-icon="inline-start" />Volver a Métricas</Button>;

  return <DashboardPageContent width="screen-2xl" className="min-w-0 gap-5 md:gap-6">
    {!(result && !result.ok && result.reason === "not_found") && backLink}
    {result?.ok && <header className="flex flex-wrap items-center gap-4">
      <Avatar className="size-12"><AvatarFallback className={accentAvatar}>{initials(personName(result.data))}</AvatarFallback></Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2"><h2 className="font-heading text-2xl font-semibold tracking-tight">{personName(result.data)}</h2>{result.data.former_member && <Badge variant="neutral" title="Ya no pertenece a la empresa; su historial se conserva">Ex miembro</Badge>}</div>
        <p className="text-sm text-muted-foreground">{`${plural(result.data.business_days_in_tramos, "día hábil", "días hábiles")} en tramos · ${plural(result.data.vacancies.assigned, "vacante", "vacantes")} · ${periodLabel(period)}`}</p>
      </div>
      <Badge variant="outline">{`Definiciones ${result.data.definitions_version}`}</Badge>
    </header>}
    {!result?.ok && <MetricsHeading title="Ficha del reclutador" description="Volumen, puntualidad, conversión y reasignaciones de una persona en el periodo elegido." />}
    <MetricsFiltersBar filters={periodFilters} today={today} showRecruiter={false} serverErrors={result && !result.ok && result.reason === "invalid_filter" ? fieldErrors(result.fields) : undefined} onChange={next => update({ ...(next.from ? { from: next.from } : {}), ...(next.to ? { to: next.to } : {}) })} />
    {!result ? <MetricsSkeleton />
      : !result.ok ? result.reason === "not_found"
        ? <StateCard icon={UserX} tone="empty" title="Esta persona no tiene historial en la empresa" description="No tuvo tramos en ninguna vacante de tu empresa, así que no hay ficha que mostrar." primaryAction={{ label: "Volver a Métricas", href: back }} />
        : <MetricsFailureCard failure={result} subject="la ficha" onRetry={() => setAttempt(value => value + 1)} onReset={() => update({})} />
      : <HelpProvider>
        <RecruiterCardView detail={result.data} />
        <MonthlySeries name={personName(result.data)} months={result.data.by_month} />
        <Card role="region" aria-label="Vacantes con su participación" className="min-w-0">
          <CardHeader><CardTitle><h2>Vacantes con su participación</h2></CardTitle></CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-3"><VacancyList filters={{ ...period, recruiter_id: userId }} title="Vacantes con su participación" /></CardContent>
        </Card>
      </HelpProvider>}
  </DashboardPageContent>;
}

/** `/empresa/metricas/reclutadores/[userId]` (artboard 05): the role gate first, then one recruiter's card. */
export function RecruiterDetailPage({ userId }: { userId: string }) {
  return <MetricsAccessGate label="Cargando la ficha"><RecruiterDetailWorkspace userId={userId} /></MetricsAccessGate>;
}
