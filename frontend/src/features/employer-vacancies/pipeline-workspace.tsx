"use client";

import * as React from "react";
import { SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { VACANCY_PIPELINE_STAGES, vacancyCandidateTotal } from "./model";
import type { EmployerVacancy, VacancyPipelineStage } from "./model";
import { CANDIDATE_SOURCE_LABELS, CANDIDATE_STATUS_LABELS, summarizeCandidateStages, visibleCandidatesCopy } from "./pipeline-model";
import type { PipelineCandidate } from "./pipeline-model";

/**
 * Supplemental stage tint: the text label always carries the meaning, so the dot
 * only reinforces it. Only reused project semantic tokens are allowed here.
 */
const STAGE_DOT: Readonly<Record<VacancyPipelineStage, string>> = {
  submitted: "bg-primary",
  in_review: "bg-primary/55",
  hired: "bg-primary/25",
  rejected: "bg-destructive",
};
const META = "text-[12px] text-muted-foreground";
const CARD_META = "text-[11.5px] text-muted-foreground";

/** Spanish count agreement: singular for exactly one, plural otherwise. */
const plural = (count: number, singular: string, pluralForm: string) => `${count} ${count === 1 ? singular : pluralForm}`;

/** Diacritic- and case-insensitive needle, so "LUCIA" and "lucía" both match. */
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().trim();
/** Exact name, professional title, or skill match against the normalized needle. */
const matchesQuery = (candidate: PipelineCandidate, needle: string): boolean =>
  [candidate.fullName, candidate.professionalTitle, ...candidate.skills].some((field) => normalize(field).includes(needle));

/**
 * One candidate as a non-clickable card: the truthful recruiter-facing facts and
 * nothing interactive. It is never a link, button, drag handle, or mutation shell.
 */
function CandidateCard({ candidate }: { candidate: PipelineCandidate }) {
  return (
    <article data-pf-pipeline-card={candidate.id} className="rounded-xl border border-border bg-card p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-foreground">{candidate.fullName}</p>
          <p className={cn("mt-0.5 truncate", META)}>{candidate.professionalTitle}</p>
        </div>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-[11.5px] font-bold text-foreground tabular-nums"><span className="sr-only">Compatibilidad </span>{candidate.matchScore}%</span>
      </div>
      <p className={cn("mt-2", META)}>{plural(candidate.yearsOfExperience, "año", "años")} de experiencia</p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {candidate.skills.slice(0, 4).map((skill) => (<li key={skill} className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{skill}</li>))}
      </ul>
      <p className={cn("mt-3", CARD_META)}>Origen: {CANDIDATE_SOURCE_LABELS[candidate.source]} · Responsable: {candidate.owner}</p>
      <p className={cn("mt-1", CARD_META)}>{candidate.commentCount === 0 ? "Sin comentarios" : plural(candidate.commentCount, "comentario", "comentarios")}</p>
      {candidate.nextStep ? (
        <p data-pf-pipeline-next-step={candidate.id} className={cn("mt-2.5 rounded-lg bg-muted px-2.5 py-1.5", CARD_META)}><span className="font-semibold text-foreground">Próximo paso: </span>{candidate.nextStep}</p>
      ) : null}
    </article>
  );
}

/** One always-present stage column: text label, supplemental dot, filtered count, honest empty state. */
function BoardColumn({ stage, count, candidates }: { stage: VacancyPipelineStage; count: number; candidates: readonly PipelineCandidate[] }) {
  const label = CANDIDATE_STATUS_LABELS[stage];
  return (
    <section data-pf-pipeline-column={stage} aria-label={`${label}: ${plural(count, "candidato", "candidatos")}`} className="flex min-w-0 flex-col rounded-2xl border border-border bg-card/40 p-3">
      <header className="flex items-center justify-between gap-2 px-1 pb-3">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className={cn("size-2.5 rounded-full", STAGE_DOT[stage])} />
          <h3 className="text-[13.5px] font-semibold text-foreground">{label}</h3>
        </div>
        <span data-pf-pipeline-column-count={stage} className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground tabular-nums">{count}</span>
      </header>
      {candidates.length === 0 ? (
        <p data-pf-pipeline-column-empty={stage} className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-[12.5px] text-muted-foreground">Sin candidatos en esta etapa.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {candidates.map((candidate) => (<li key={candidate.id}><CandidateCard candidate={candidate} /></li>))}
        </ul>
      )}
    </section>
  );
}

/**
 * Per-vacancy pipeline board: a fully local, in-memory client surface over one
 * validated vacancy and the candidate cards already filtered to it. It derives
 * the four column counts from the model helper, filters by name, title, and
 * skills with a diacritic-insensitive search, and discloses that the demo cards
 * are a representative sample of the vacancy counters. It owns no fetch, router
 * mutation, storage, drag/drop, or candidate mutation, and it never imports fixtures.
 */
export function PipelineWorkspace({ vacancy, candidates }: { vacancy: EmployerVacancy; candidates: readonly PipelineCandidate[] }) {
  const [query, setQuery] = React.useState("");
  const needle = normalize(query);
  const filtered = needle === "" ? candidates : candidates.filter((candidate) => matchesQuery(candidate, needle));
  const stageCounts = summarizeCandidateStages(filtered);
  return (
    <div data-pf-pipeline className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pipeline-search" className="text-[12.5px] font-medium text-foreground">Buscar candidato</label>
          <div className="relative">
            <SearchIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="pipeline-search" data-pf-pipeline-search type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre, puesto o habilidad" className="h-10 pl-9 sm:w-80" />
          </div>
        </div>
        <p data-pf-pipeline-sample className={META}>{visibleCandidatesCopy(filtered.length, vacancyCandidateTotal(vacancy.candidateCounts))}</p>
      </div>
      <div data-pf-pipeline-board role="region" aria-label={`Tablero de candidatos de ${vacancy.title}`} tabIndex={0} className="overflow-x-auto pb-1 focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none">
        <div data-pf-pipeline-grid className="grid min-w-[60rem] grid-cols-4 gap-3 lg:min-w-0">
          {VACANCY_PIPELINE_STAGES.map((stage) => (<BoardColumn key={stage} stage={stage} count={stageCounts[stage]} candidates={filtered.filter((candidate) => candidate.status === stage)} />))}
        </div>
      </div>
      {needle !== "" && filtered.length === 0 ? (
        <div data-pf-pipeline-recovery className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card/40 px-4 py-6 text-center">
          <p className="text-[13px] text-muted-foreground">No hay candidatos que coincidan con la búsqueda «{query.trim()}».</p>
          <Button type="button" variant="outline" data-pf-pipeline-clear onClick={() => setQuery("")} className="h-10">Limpiar búsqueda</Button>
        </div>
      ) : null}
    </div>
  );
}
