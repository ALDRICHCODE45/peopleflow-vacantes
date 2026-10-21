"use client";

import * as React from "react";
import Link from "next/link";
import { BriefcaseBusiness, CirclePause, FilePenLine, SearchIcon, SquareKanban, Users, CircleCheck } from "lucide-react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from "@/components/ui/card";
import { DropdownMenuGroup, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { StateCard } from "@/components/feedback/state-card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActionStatus, ActionStatusSlot } from "@/components/feedback/action-status";
import type { DraftListRow } from "@/features/jobs/drafts/list/client";
import { cn } from "@/lib/utils";
import { EMPLOYER_EMPLOYMENT_TYPE_LABELS, EMPLOYER_VACANCY_STATE_LABELS, EMPLOYER_WORK_MODE_LABELS, VACANCY_PIPELINE_STAGES, summarizeEmployerVacancies, vacancyCandidateTotal, vacancyInProcessCount, vacancyPipelineHref } from "./model";
import type { EmployerVacancy, EmployerVacancyState, VacancyPipelineStage } from "./model";
import { lifecycleLabel, type Lifecycle } from "@/features/vacancy-lifecycle/model";
import { LifecycleActionsMenu } from "@/features/vacancy-lifecycle/ui/lifecycle-actions-menu";
import { PublishDialog } from "./publication/publish-dialog";
import { portfolioRowActions } from "./model";
import { DRAFT_LIST_MESSAGES, usePortfolioDrafts } from "./use-portfolio-drafts";

type StatusFilter = "all" | "draft" | EmployerVacancyState;
type PortfolioDraft = { id: string; title: string; state: "draft" | EmployerVacancyState; draft: DraftListRow };
type PortfolioVacancy = EmployerVacancy | PortfolioDraft;
const STATUS_FILTERS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Todas" }, { value: "draft", label: "Borradores" }, { value: "active", label: "Activas" }, { value: "paused", label: "Pausadas" }, { value: "closed", label: "Cerradas" },
];
const STAGE_LABELS: Readonly<Record<VacancyPipelineStage, string>> = { submitted: "Nuevos", in_review: "En revisión", hired: "Contratados", rejected: "Descartados" };
const STATUS_VARIANT: Readonly<Record<EmployerVacancyState, BadgeVariant>> = { active: "accent", paused: "review", closed: "neutral" };
const PIPELINE_BAR: Readonly<Record<VacancyPipelineStage, string>> = { submitted: "bg-primary", in_review: "bg-primary/60", hired: "bg-primary/35", rejected: "bg-muted-foreground/40" };
const META = "text-[12.5px] text-muted-foreground";
// Reserve the same action column for every row, including the contextual disclosure.
const GRID = "grid grid-cols-1 gap-4 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.6fr)_11rem] lg:items-center";
const HEADER = "hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.6fr)_11rem] items-center gap-4 border-b border-border px-5 py-3 text-[12px] font-semibold tracking-wide text-muted-foreground uppercase lg:grid";
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().trim();
const initials = (title: string) => title.split(/\s+/u).slice(0, 2).map(word => word.charAt(0)).join("").toUpperCase();
const dateFormat = new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "America/Mexico_City" });
const formatDate = (value: string) => dateFormat.format(new Date(value));

/** Shared row composition, with draft facts rather than invented publication or candidate data. */
const candidateSummary = (total: number, inProcess: number, finished = false) => `${total} ${total === 1 ? "candidato" : "candidatos"}${finished ? "" : ` · ${inProcess} en proceso`}`;

function StageBreakdown({ pairs }: { pairs: string[] }) {
  return pairs.map((pair, index) => <React.Fragment key={index}>{index > 0 && " · "}<span className="inline-block whitespace-nowrap">{pair}</span></React.Fragment>);
}

function VacancyRow({ vacancy, onPublished, onLifecycleChanged }: { vacancy: PortfolioVacancy; onPublished: (id: string, publishedAt: string) => void; onLifecycleChanged: (id: string, view: Lifecycle) => void }) {
  const [publishOpen, setPublishOpen] = React.useState(false);
  const draft = "draft" in vacancy ? vacancy.draft : null;
  const prototype = "draft" in vacancy ? null : vacancy;
  const candidates = draft?.candidates;
  const transition = draft?.status === "paused" ? { label: "Pausada el", at: draft.paused_at }
    : draft?.status === "closed" ? draft.process === "finished"
      ? { label: "Proceso finalizado el", at: draft.process_finished_at }
      : { label: "Cerrada el", at: draft.closed_at }
    : { label: "Publicada el", at: draft?.published_at };
  const meta = draft
    ? [draft.work_mode ? EMPLOYER_WORK_MODE_LABELS[draft.work_mode] : "Modalidad sin definir", draft.work_schedule ? EMPLOYER_EMPLOYMENT_TYPE_LABELS[draft.work_schedule] : null].filter(Boolean).join(" · ")
    : prototype ? `${EMPLOYER_WORK_MODE_LABELS[prototype.workMode]} · ${EMPLOYER_EMPLOYMENT_TYPE_LABELS[prototype.employmentType]}` : "";
  return (
    <li data-pf-vacancy-row={vacancy.id} className={GRID}>
      <div data-pf-vacancy-zone="identity" className="flex min-w-0 items-start gap-3">
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-[13px] font-bold text-foreground">{initials(vacancy.title)}</span>
        <div className="min-w-0">
          <p className="break-words text-[14.5px] font-semibold text-foreground">{vacancy.title}</p>
          <p className={cn(META, "mt-0.5")}><span className="sr-only">Reclutador: </span>{draft ? draft.principal_recruiter.name ?? "Usuario dado de baja" : prototype?.recruiter}</p>
          {draft?.requester?.name && <p className={cn(META, "mt-0.5")}>Solicitante: {draft.requester.name}</p>}
        </div>
      </div>
      <div data-pf-vacancy-zone="conditions" className="flex flex-col items-start gap-2">
        <Badge variant={vacancy.state === "draft" ? "info" : STATUS_VARIANT[vacancy.state]} dot>{draft ? lifecycleLabel({ publication: draft.status === "draft" ? null : draft.status, process: draft.process }) : vacancy.state === "draft" ? "Borrador" : EMPLOYER_VACANCY_STATE_LABELS[vacancy.state]}</Badge>
        <p className={META}>{meta}</p>
      </div>
      <div data-pf-vacancy-zone="complement" className="flex min-w-0 flex-col gap-2">
        {candidates && candidates.total > 0 && <p className={cn(META, "tabular-nums")}>{candidateSummary(candidates.total, candidates.in_process, draft?.process === "finished")}</p>}
        {prototype && <p className={cn(META, "tabular-nums")}>{candidateSummary(vacancyCandidateTotal(prototype.candidateCounts), vacancyInProcessCount(prototype.candidateCounts))}</p>}
        <div className="flex flex-col gap-1">
          <div aria-hidden="true" className="flex items-center gap-1">
            {candidates ? <>
              {candidates.by_stage.map(stage => <span key={stage.id} className={cn("h-1.5 w-6 rounded-full", stage.kind === "new" ? PIPELINE_BAR.submitted : stage.kind === "placement" ? PIPELINE_BAR.hired : PIPELINE_BAR.in_review)} />)}
              <span className={cn("h-1.5 w-6 rounded-full", PIPELINE_BAR.rejected)} />
            </> : VACANCY_PIPELINE_STAGES.map(stage => <span key={stage} className={cn("h-1.5 w-6 rounded-full", draft ? "bg-muted" : PIPELINE_BAR[stage])} />)}
          </div>
          <p className={META}>{vacancy.state === "draft" ? "Sin pipeline · en borrador" : prototype ? <StageBreakdown pairs={VACANCY_PIPELINE_STAGES.map(stage => `${STAGE_LABELS[stage]}: ${prototype.candidateCounts[stage]}`)} /> : candidates ? candidates.total === 0 ? "Sin candidatos todavía" : <StageBreakdown pairs={[...candidates.by_stage.map(stage => `${stage.name}: ${stage.count}`), `Descartados: ${candidates.discarded}`]} /> : null}</p>
        </div>
        <div className={META}>
          {draft ? draft.status === "draft" ? <div className="flex flex-col gap-1"><span>Sin publicar</span><time dateTime={draft.updated_at}>Editado {formatDate(draft.updated_at)}</time></div> : transition.at ? <time dateTime={transition.at}>{transition.label} {formatDate(transition.at)}</time> : "Fecha no disponible" : prototype && <time dateTime={prototype.publishedAt}><span className="sr-only">Publicada el </span>{formatDate(prototype.publishedAt)}</time>}
        </div>
      </div>
      <div data-pf-vacancy-zone="action" className="flex items-center gap-1 [&>a]:w-full [&>a]:lg:w-auto [&>button]:w-full [&>button]:lg:w-auto">
        {draft ? (
          <LifecycleActionsMenu draftId={draft.id} title={vacancy.title} onChanged={view => onLifecycleChanged(draft.id, view)} onPublish={draft.status === "draft" ? () => setPublishOpen(true) : undefined}>
            <DropdownMenuGroup>
              {portfolioRowActions(vacancy.id, draft.status === "draft" ? "draft" : "published").filter(action => action.kind !== "publish").map(action => {
                const Icon = action.kind === "pipeline" ? SquareKanban : FilePenLine;
                return <DropdownMenuItem key={action.kind} className="min-h-10" render={<Link href={action.href!} />}><Icon aria-hidden="true" />{action.label}</DropdownMenuItem>;
              })}
            </DropdownMenuGroup>
          </LifecycleActionsMenu>
        ) : (
          <Link href={vacancyPipelineHref(vacancy.id)} data-pf-vacancy-pipeline={vacancy.id} aria-label={`Ver pipeline de ${vacancy.title}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-10 w-full gap-1.5 px-3.5 transition-colors duration-200 lg:w-auto")}>Ver pipeline</Link>
        )}
      </div>
      {draft?.status === "draft" && <PublishDialog draftId={draft.id} open={publishOpen} onOpenChange={setPublishOpen} onPublished={publishedAt => onPublished(draft.id, publishedAt)} />}
    </li>
  );
}

function DraftSkeletonRows() {
  return <ul aria-hidden="true" className="divide-y divide-border">{[0, 1].map(key => <li key={key} data-pf-draft-skeleton="" className={GRID}>
    <div data-pf-vacancy-zone="identity" className="flex items-start gap-3"><Skeleton className="size-10 shrink-0" /><div className="flex flex-1 flex-col gap-2"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-4 w-1/3" /></div></div>
    <div data-pf-vacancy-zone="conditions" className="flex flex-col items-start gap-2"><Badge variant="info" dot><Skeleton className="h-3 w-12" /></Badge><Skeleton className="h-4 w-1/2" /></div>
    <div data-pf-vacancy-zone="complement" className="flex min-w-0 flex-col gap-2"><Skeleton className="h-4 w-2/3" /><div className="flex flex-col gap-1"><Skeleton className="h-1.5 w-28" /><Skeleton className="h-4 w-36" /></div><div className="flex flex-col gap-1"><Skeleton className="h-4 w-20" /><Skeleton className="h-4 w-36" /></div></div>
    <div data-pf-vacancy-zone="action" className="flex items-center gap-1"><Skeleton className="h-10 w-full lg:w-28" /></div>
  </li>)}</ul>;
}

/** Local prototype rows remain usable while the authenticated draft read loads. */
export function VacancyPortfolio({ vacancies }: { vacancies: readonly EmployerVacancy[] }) {
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState<StatusFilter>("all");
  const drafts = usePortfolioDrafts();
  const summary = summarizeEmployerVacancies(vacancies);
  const draftCount = drafts.items.filter(item => item.status === "draft").length;
  const activeCount = summary.active + drafts.items.filter(item => item.status === "published").length;
  const counts: Readonly<Record<StatusFilter, number>> = { all: summary.total + drafts.items.length, draft: draftCount, active: activeCount, paused: summary.paused + drafts.items.filter(item => item.status === "paused").length, closed: summary.closed + drafts.items.filter(item => item.status === "closed").length };
  const cards = [
    { key: "active", label: "Activas", value: activeCount, icon: BriefcaseBusiness },
    { key: "draft", label: "Borradores", value: draftCount, icon: FilePenLine },
    { key: "paused", label: "Pausadas", value: counts.paused, icon: CirclePause },
    { key: "in-process", label: "Candidatos en proceso", value: summary.inProcessCandidates + drafts.items.reduce((sum, item) => sum + (item.process === "finished" ? 0 : item.candidates?.in_process ?? 0), 0), icon: Users },
    { key: "closed", label: "Cerradas", value: counts.closed, icon: CircleCheck },
  ] as const;
  const combined: PortfolioVacancy[] = [...drafts.items.map(draft => ({ id: draft.id, title: draft.title || "Sin título", state: draft.status === "published" ? "active" as const : draft.status, draft })), ...vacancies];
  const needle = normalize(query);
  const results = combined.filter(vacancy => (status === "all" || vacancy.state === status) && (!needle || normalize(vacancy.title).includes(needle)));
  const filtersActive = query.trim() !== "" || status !== "all";
  const emptyDrafts = status === "draft" && draftCount === 0 && !query.trim();
  const emptyDescription = combined.length === 0
    ? "Crea tu primera vacante con «Nueva vacante». Se guarda como borrador hasta que la publiques."
    : emptyDrafts
      ? "Crea una vacante con «Nueva vacante». Se guarda como borrador hasta que la publiques."
      : "No hay vacantes que coincidan con la búsqueda y el estado seleccionados. Limpia los filtros para volver a ver el listado.";
  const clearFilters = () => { setQuery(""); setStatus("all"); };
  const loadingDraftRows = drafts.pending && (status === "all" || status === "draft");
  const failure = drafts.failure;
  const recoveryHref = failure?.reason === "unauthenticated" ? "/empresa/login" : failure?.reason.startsWith("company_") ? "/empresa/configuracion" : null;
  return (
    <div data-pf-vacancy-portfolio className="flex flex-col gap-5">
      <section data-pf-vacancy-summary aria-label="Resumen de vacantes" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map(card => <Card key={card.key} size="sm" data-pf-vacancy-metric={card.key} className="last:sm:col-span-2 last:xl:col-span-1">
          <CardHeader><CardTitle><h3 className="text-[26px] font-bold tabular-nums">{card.key === "draft" && drafts.pending && drafts.items.length === 0 ? <Skeleton aria-hidden="true" className="h-8 w-10" /> : card.value}</h3></CardTitle><CardDescription className="flex items-center gap-1.5"><card.icon aria-hidden="true" className="size-3.5" />{card.label}</CardDescription></CardHeader>
        </Card>)}
      </section>
      <Tabs value={status} onValueChange={value => setStatus(value as StatusFilter)} className="gap-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="vacancy-portfolio-search" className="text-[12.5px] font-medium text-foreground">Buscar vacante</label>
            <div className="relative"><SearchIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="vacancy-portfolio-search" data-pf-vacancy-search type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Puesto o palabra clave" className="h-10 pl-9 lg:w-72" /></div>
          </div>
          <div className="max-w-full overflow-x-auto pb-1">
            <TabsList aria-label="Filtrar por estado" className="**:data-[slot=badge]:size-5 **:data-[slot=badge]:rounded-full">
              {STATUS_FILTERS.map(filter => <TabsTrigger key={filter.value} value={filter.value} data-pf-vacancy-filter={filter.value}>{filter.label}<Badge variant="secondary">{counts[filter.value]}</Badge></TabsTrigger>)}
            </TabsList>
          </div>
        </div>
        <TabsContent value={status}>
          <Card data-pf-vacancy-results aria-busy={drafts.pending}>
            <CardContent className="-mx-(--card-spacing)">
              <div aria-hidden="true" className={HEADER}><span>Vacante</span><span>Condiciones y estado</span><span>Pipeline y fechas</span><span /></div>
              {drafts.pending && <span role="status" className="sr-only">Cargando borradores</span>}
              {failure && <div className="border-b border-border bg-muted p-4 sm:px-5">
                <p className="text-sm font-semibold">No pudimos cargar tus borradores</p><p className={cn(META, "mt-1")}>{DRAFT_LIST_MESSAGES[failure.reason]} Las demás vacantes siguen disponibles.</p>
                <div className="mt-3 flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={drafts.retry} disabled={drafts.pending} aria-busy={drafts.pending} className="min-h-10" aria-describedby={drafts.pending ? undefined : "portfolio-drafts-status"}>{drafts.pending && <Spinner aria-hidden="true" data-icon="inline-start" />}{drafts.pending ? "Reintentando…" : "Reintentar"}</Button>{recoveryHref && <Button nativeButton={false} role="link" variant="ghost" className="min-h-10" render={<Link href={recoveryHref} />}>{failure.reason === "unauthenticated" ? "Iniciar sesión" : "Revisar empresa"}</Button>}</div>
                <ActionStatusSlot>{!drafts.pending && <ActionStatus id="portfolio-drafts-status" tone="error" text="No se cargaron los borradores · ver aviso" />}</ActionStatusSlot>
              </div>}
              {loadingDraftRows && <DraftSkeletonRows />}
              {drafts.capped && <p className={cn(META, "px-5 py-3")}>Se muestran hasta 500 borradores. El listado puede estar incompleto; los más recientes aparecen primero.</p>}
              {results.length === 0 ? (status === "draft" && (loadingDraftRows || failure)) ? null : <StateCard data-pf-vacancy-empty icon={status === "draft" ? FilePenLine : SearchIcon} tone="empty"
                title={combined.length === 0 ? "Todavía no hay vacantes" : emptyDrafts ? "No hay borradores que mostrar" : "Sin resultados"} description={emptyDescription}>
                {filtersActive && <Button type="button" data-pf-vacancy-clear onClick={clearFilters} className="min-h-10 w-full sm:w-auto">Limpiar filtros</Button>}
              </StateCard> : <ul className="divide-y divide-border">{results.map(vacancy => <VacancyRow key={vacancy.id} vacancy={vacancy} onPublished={drafts.published} onLifecycleChanged={drafts.lifecycleChanged} />)}</ul>}
              {!failure && drafts.retried && <div className="px-5"><ActionStatusSlot>{!drafts.pending && <ActionStatus id="portfolio-drafts-status" tone="success" text="Borradores cargados" />}</ActionStatusSlot></div>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
