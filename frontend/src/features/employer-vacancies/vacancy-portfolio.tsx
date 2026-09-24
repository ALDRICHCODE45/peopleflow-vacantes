"use client";

import * as React from "react";
import Link from "next/link";
import { SearchIcon } from "lucide-react";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { EMPLOYER_EMPLOYMENT_TYPE_LABELS, EMPLOYER_VACANCY_STATE_LABELS, EMPLOYER_WORK_MODE_LABELS, VACANCY_PIPELINE_STAGES, summarizeEmployerVacancies, vacancyCandidateTotal, vacancyInProcessCount, vacancyPipelineHref } from "./model";
import type { EmployerVacancy, EmployerVacancyState, VacancyPipelineStage } from "./model";

/** Tab filter: `all` is not a publication state, so it stays surface-local. */
type StatusFilter = "all" | EmployerVacancyState;

const STATUS_FILTERS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Todas" }, { value: "active", label: "Activas" }, { value: "paused", label: "Pausadas" }, { value: "closed", label: "Cerradas" },
];
/** Spanish stage labels shared with the existing employer pipeline vocabulary. */
const STAGE_LABELS: Readonly<Record<VacancyPipelineStage, string>> = { submitted: "Nuevos", in_review: "En revisión", hired: "Contratados", rejected: "Descartados" };
/** Publication-state variant: text always carries the meaning and the shared
    Badge variant only supplements it. */
const STATUS_VARIANT: Readonly<Record<EmployerVacancyState, BadgeVariant>> = { active: "accent", paused: "review", closed: "neutral" };
/** Equal-width pipeline segments, one per stage, decorative next to the text. */
const PIPELINE_BAR: Readonly<Record<VacancyPipelineStage, string>> = { submitted: "bg-primary", in_review: "bg-primary/60", hired: "bg-primary/35", rejected: "bg-muted-foreground/40" };

const FOCUS = "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none";
const FILTER = `inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors duration-200 ${FOCUS}`;
const META = "text-[12.5px] text-muted-foreground";
const GRID = "grid grid-cols-1 gap-3 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_auto] lg:items-center lg:gap-4";
const HEADER = "hidden grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_auto] items-center gap-4 border-b border-border px-5 py-3 text-[12px] font-semibold tracking-wide text-muted-foreground uppercase lg:grid";

/** Diacritic- and case-insensitive needle, so "REACT" and "revisión" both match. */
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().trim();
/** Two-letter monogram of a vacancy title; purely decorative. */
const initials = (title: string) => title.split(/\s+/u).slice(0, 2).map((word) => word.charAt(0)).join("").toUpperCase();
/** Deterministic long-form Spanish published date, always rendered in UTC. */
const publishedDateFormat = new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "UTC" });
const formatPublishedDate = (value: string) => publishedDateFormat.format(new Date(value));

/**
 * One vacancy as a non-clickable list row: the truthful facts and status in
 * text, plus exactly one semantic pipeline link. The row itself is never a
 * link or a button, so no interactive control is nested inside another.
 */
function VacancyRow({ vacancy }: { vacancy: EmployerVacancy }) {
  const total = vacancyCandidateTotal(vacancy.candidateCounts);
  const inProcess = vacancyInProcessCount(vacancy.candidateCounts);
  return (
    <li data-pf-vacancy-row={vacancy.id} className={GRID}>
      <div className="flex min-w-0 items-start gap-3">
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-[13px] font-bold text-foreground">{initials(vacancy.title)}</span>
        <div className="min-w-0">
          <p className="truncate text-[14.5px] font-semibold text-foreground">{vacancy.title}</p>
          <p className={cn(META, "mt-1")}>{EMPLOYER_WORK_MODE_LABELS[vacancy.workMode]} · {EMPLOYER_EMPLOYMENT_TYPE_LABELS[vacancy.employmentType]}</p>
          <p className={cn(META, "mt-0.5")}>{total} candidatos · {inProcess} en proceso</p>
          <p className={cn(META, "mt-0.5")}><span className="sr-only">Reclutador: </span>{vacancy.recruiter}</p>
        </div>
      </div>
      <div>
        <Badge variant={STATUS_VARIANT[vacancy.state]} dot>
          {EMPLOYER_VACANCY_STATE_LABELS[vacancy.state]}
        </Badge>
      </div>
      <div className="flex flex-col gap-1">
        <div aria-hidden="true" className="flex items-center gap-1">
          {VACANCY_PIPELINE_STAGES.map((stage) => (<span key={stage} className={cn("h-1.5 w-6 rounded-full", PIPELINE_BAR[stage])} />))}
        </div>
        <p className={META}>{VACANCY_PIPELINE_STAGES.map((stage) => `${STAGE_LABELS[stage]}: ${vacancy.candidateCounts[stage]}`).join(" · ")}</p>
      </div>
      <div className={META}>
        <time dateTime={vacancy.publishedAt}><span className="sr-only">Publicada el </span>{formatPublishedDate(vacancy.publishedAt)}</time>
      </div>
      <div>
        <Link href={vacancyPipelineHref(vacancy.id)} data-pf-vacancy-pipeline={vacancy.id} aria-label={`Ver pipeline de ${vacancy.title}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-10 gap-1.5 px-3.5 transition-colors duration-200")}>Ver pipeline</Link>
      </div>
    </li>
  );
}

/**
 * Employer vacancy portfolio: a fully local, in-memory surface over the
 * validated prototype vacancies it receives. It derives its four summary metrics
 * from the model helpers, composes a labelled search with the status tabs, and
 * renders one truthful row per vacancy with exactly one pipeline link. It owns
 * no fetch, router mutation, storage, clipboard, drag/drop, or business
 * mutation, and it never imports the Nexo fixture: fixtures arrive as props.
 */
export function VacancyPortfolio({ vacancies }: { vacancies: readonly EmployerVacancy[] }) {
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState<StatusFilter>("all");
  const summary = summarizeEmployerVacancies(vacancies);
  const counts: Readonly<Record<StatusFilter, number>> = { all: summary.total, active: summary.active, paused: summary.paused, closed: summary.closed };
  const cards = [
    { key: "active", label: "Activas", value: summary.active },
    { key: "paused", label: "Pausadas", value: summary.paused },
    { key: "in-process", label: "Candidatos en proceso", value: summary.inProcessCandidates },
    { key: "closed", label: "Cerradas", value: summary.closed },
  ] as const;
  const needle = normalize(query);
  const results = vacancies.filter((vacancy) => (status === "all" || vacancy.state === status) && (needle === "" || normalize(vacancy.title).includes(needle)));
  const filtersActive = query.trim() !== "" || status !== "all";
  const clearFilters = () => { setQuery(""); setStatus("all"); };
  return (
    <div data-pf-vacancy-portfolio className="flex flex-col gap-5">
      <section data-pf-vacancy-summary aria-label="Resumen de vacantes" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map((card) => (
          <div key={card.key} data-pf-vacancy-metric={card.key} className="rounded-xl border border-border bg-card/50 p-4">
            <p className="font-heading text-[22px] font-bold text-foreground tabular-nums">{card.value}</p>
            <p className={META}>{card.label}</p>
          </div>
        ))}
      </section>
      <div className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="vacancy-portfolio-search" className="text-[12.5px] font-medium text-foreground">Buscar vacante</label>
          <div className="relative">
            <SearchIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="vacancy-portfolio-search" data-pf-vacancy-search type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Puesto o palabra clave" className="h-10 pl-9 lg:w-72" />
          </div>
        </div>
        <div role="group" aria-label="Filtrar por estado" className="flex flex-wrap items-center gap-2">
          {STATUS_FILTERS.map((filter) => {
            const active = status === filter.value;
            return (
              <button key={filter.value} type="button" data-pf-vacancy-filter={filter.value} aria-pressed={active} onClick={() => setStatus(filter.value)} className={cn(FILTER, active ? "border-primary/60 bg-primary/12 text-foreground" : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground")}>
                {filter.label}
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground tabular-nums">{counts[filter.value]}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div data-pf-vacancy-results className="overflow-hidden rounded-2xl border border-border bg-card/40">
        <div aria-hidden="true" className={HEADER}>
          <span>Vacante</span><span>Estado</span><span>Pipeline</span><span>Publicada</span><span />
        </div>
        {results.length === 0 ? (
          <div className="p-4">
            <Empty data-pf-vacancy-empty className="border border-border bg-card/40">
              <EmptyHeader>
                <EmptyMedia variant="icon"><SearchIcon aria-hidden="true" /></EmptyMedia>
                <EmptyTitle>{vacancies.length === 0 ? "Todavía no hay vacantes" : "Sin resultados"}</EmptyTitle>
                <EmptyDescription>{vacancies.length === 0 ? "Cuando publiques una vacante va a aparecer en este listado." : "No hay vacantes que coincidan con la búsqueda y el estado seleccionados."}</EmptyDescription>
              </EmptyHeader>
              {filtersActive && vacancies.length > 0 && (
                <EmptyContent>
                  <Button type="button" variant="outline" data-pf-vacancy-clear onClick={clearFilters} className="min-h-10">Limpiar filtros</Button>
                </EmptyContent>
              )}
            </Empty>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {results.map((vacancy) => (<VacancyRow key={vacancy.id} vacancy={vacancy} />))}
          </ul>
        )}
      </div>
    </div>
  );
}
