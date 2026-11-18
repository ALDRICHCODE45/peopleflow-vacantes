"use client";
import { useState } from "react";
import { AlertCircle, BriefcaseBusiness } from "lucide-react";
import { StateCard } from "@/components/feedback/state-card";
import type { MetricsFailure, MetricsResult } from "@/features/company-metrics/model";
import { mexicoToday } from "@/features/company-metrics/period";
import { useSection } from "@/features/company-metrics/use-section";
import type { MetricsFilters } from "@/features/company-metrics/url-state";
import { useIdentity } from "@/features/identity/identity-session";
import { loadAttentionAction, loadOriginAction, loadPipelineAction, loadRecentAction, loadSummaryAction, loadVacanciesAction } from "./actions";
import { drillFor } from "./drilldown";
import { greeting } from "./format";
import { CREATE_VACANCY_HREF, DashboardHeader } from "./header";
import type { AttentionSection, DashboardWindow, PipelineSection, SummarySection as SummaryData } from "./model";
import { ApplicationsSection } from "./sections/applications-section";
import { FollowUpSection } from "./sections/follow-up-section";
import { SummarySection } from "./sections/summary-section";
import { VacanciesSection } from "./sections/vacancies-section";
import { useDashboardWindow } from "./use-dashboard-window";

/** The metrics section hook keyed by the window: the dashboard has no other filter. */
const NO_FILTERS: MetricsFilters = {};
/** Sections that show the state now (contract §3.2–§3.5) never reload when the period changes. */
const NOW = "now";
const useDashboardSection = <T,>(load: () => Promise<MetricsResult<T>>, key: string, lazy = false) => useSection(load, NO_FILTERS, key, { lazy });

/** A company (or a recruiter's scope) with nothing to show yet: no published vacancy, nobody in process, nothing pending. */
function firstVisit(summary: SummaryData | null, attention: AttentionSection | null, pipeline: PipelineSection | null) {
  if (!summary || !attention || !pipeline) return false;
  return summary.published_vacancies.current === 0 && summary.published_vacancies.previous === 0 && summary.positions.required === 0
    && summary.positions.covered === 0 && summary.in_process.series.every(point => point.value === 0)
    && (summary.pool_added === null || summary.pool_added.current + summary.pool_added.previous === 0)
    && attention.overdue.total + attention.due_this_week.total + attention.stalled.total === 0
    && pipeline.stages.every(stage => stage.candidates === 0);
}

/**
 * `/empresa/dashboard` (artboard 09, `design/system.md` «Dashboards and metrics»): the header renders first, then each
 * section loads on its own from its d2 route; the sections below the fold load as they approach the viewport (rule 17).
 */
export function DashboardWorkspace() {
  const { window, update } = useDashboardWindow();
  const [now] = useState(() => new Date());
  const { result } = useIdentity();
  const name = result?.ok ? result.data.user?.full_name : null;
  const key = String(window);
  const summary = useDashboardSection(() => loadSummaryAction(window), key);
  const attention = useDashboardSection(() => loadAttentionAction(), NOW);
  const pipeline = useDashboardSection(() => loadPipelineAction(), NOW);
  const vacancies = useDashboardSection(() => loadVacanciesAction(), NOW, true);
  const recent = useDashboardSection(() => loadRecentAction(), NOW, true);
  const origin = useDashboardSection(() => loadOriginAction(window), key, true);
  const drill = drillFor(window);
  const blocking = [summary, attention, pipeline, vacancies, recent, origin].map(section => section.failure)
    .find((failure): failure is MetricsFailure => failure !== null && ["unauthenticated", "forbidden", "not_found"].includes(failure.reason));
  const empty = summary.status === "ready" && attention.status === "ready" && pipeline.status === "ready" && firstVisit(summary.data, attention.data, pipeline.data);

  return <div className="flex min-w-0 flex-col gap-10">
    <DashboardHeader greeting={greeting(now)} name={name} header={summary.data} window={window} now={now} onWindow={(next: DashboardWindow) => update(next)} />
    {blocking ? <AccessCard failure={blocking} />
      : empty ? <FirstVisit own={summary.data?.scope === "own_vacancies"} />
        : <>
          <SummarySection state={summary} window={window} drill={drill} />
          <FollowUpSection attention={attention} pipeline={pipeline} drill={drill} today={mexicoToday(now)} />
          <VacanciesSection vacancies={vacancies} recent={recent} drill={drill} now={now} />
          <ApplicationsSection state={origin} window={window} drill={drill} />
        </>}
  </div>;
}

/** The current dashboard's access handling: an expired session signs in again; no membership is restricted. */
export function AccessCard({ failure }: { failure: MetricsFailure }) {
  const unauthenticated = failure.reason === "unauthenticated";
  return <StateCard icon={AlertCircle} tone="forbidden" role="alert"
    title={unauthenticated ? "Tu sesión expiró" : "No tienes acceso al dashboard"}
    description={unauthenticated ? "Inicia sesión para ver los datos de tu empresa." : "Usa una cuenta con membresía activa en tu empresa."}
    primaryAction={unauthenticated ? { label: "Iniciar sesión", href: "/empresa/login" } : { label: "Ver mis vacantes", href: "/empresa/vacantes" }} />;
}

/** The current dashboard's first-visit copy, with the create action. */
function FirstVisit({ own }: { own: boolean }) {
  return <StateCard icon={BriefcaseBusiness} tone="empty"
    title={own ? "Todavía no tienes vacantes asignadas" : "Todavía no hay vacantes activas"}
    description={own ? "Aquí verás tus procesos cuando te asignen una vacante publicada." : "Aquí verás tus procesos cuando publiques una vacante. Revisa tus vacantes para preparar la siguiente publicación."}
    primaryAction={{ label: "Crear vacante", href: CREATE_VACANCY_HREF }} secondaryAction={{ label: "Ver mis vacantes", href: "/empresa/vacantes" }} />;
}
