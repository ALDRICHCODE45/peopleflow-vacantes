"use client";

import * as React from "react";
import { Columns3Icon, ListIcon, SearchIcon } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { VACANCY_PIPELINE_STAGES, vacancyCandidateTotal } from "./model";
import type { EmployerVacancy, VacancyPipelineStage } from "./model";
import { CANDIDATE_SOURCE_LABELS, CANDIDATE_STATUS_LABELS, summarizeCandidateStages, visibleCandidatesCopy } from "./pipeline-model";
import type { PipelineCandidate } from "./pipeline-model";
import {
  createEmptyPipelineFilters,
  filterPipelineCandidates,
  hasActivePipelineFilters,
  pipelineListEmptyCopy,
  pipelineNoResultsCopy,
} from "./pipeline-filter-model";
import { PipelineFilterBar } from "./pipeline-filters";

/**
 * Semantic stage variant: the Spanish label always carries the meaning, so the
 * shared Badge variant only reinforces it through the `--status-*` tokens. No
 * raw color value or local tone recipe is authored here.
 */
const STAGE_VARIANT: Readonly<Record<VacancyPipelineStage, BadgeVariant>> = {
  submitted: "info",
  in_review: "review",
  hired: "success",
  rejected: "danger",
};
/** Supplementary dot color for the non-Badge column-heading stage marker. */
const STAGE_DOT: Readonly<Record<VacancyPipelineStage, string>> = {
  submitted: "bg-status-info",
  in_review: "bg-status-review",
  hired: "bg-status-success",
  rejected: "bg-status-danger",
};
const META = "text-[12px] text-muted-foreground";
const CARD_META = "text-[11.5px] text-muted-foreground";
/** Shared list-row cell geometry, kept identical across every column. */
const CELL = "px-3 py-3 align-top";

/** The two local display modes of the pipeline. Nothing outside this component reads them. */
type PipelineView = "board" | "list";

/** Both view buttons: label, column/list icon, and the pressed target they set. */
const PIPELINE_VIEWS = [
  { id: "board", label: "Tablero", Icon: Columns3Icon },
  { id: "list", label: "Lista", Icon: ListIcon },
] as const;

/** Column headers of the list representation, in render order. */
const LIST_COLUMN_LABELS = ["Candidato", "Estado", "Experiencia", "Habilidades", "Compatibilidad", "Origen", "Responsable", "Comentarios", "Próximo paso"] as const;

/** Spanish count agreement: singular for exactly one, plural otherwise. */
const plural = (count: number, singular: string, pluralForm: string) => `${count} ${count === 1 ? singular : pluralForm}`;

/** Deterministic first+last initials, so an avatar never depends on randomness. */
const initialsOf = (fullName: string) => {
  const words = fullName.trim().split(/\s+/u).filter((word) => word !== "");
  const first = words[0]?.charAt(0) ?? "";
  const last = words.length > 1 ? words[words.length - 1].charAt(0) : "";
  return `${first}${last}`.toUpperCase();
};
/** Honest zero-comment copy, shared by both representations. */
const commentCopy = (count: number) => (count === 0 ? "Sin comentarios" : plural(count, "comentario", "comentarios"));

/** Match-score Badge shared by the board card and the list row. A counter is
    not a status, so it never opts into the decorative dot even when it reuses a
    semantic stage variant for color. */
function MatchScore({ score, variant }: { score: number; variant?: BadgeVariant }) {
  return (
    <Badge variant={variant ?? "outline"} className="font-bold tabular-nums"><span className="sr-only">Compatibilidad </span>{score}%</Badge>
  );
}

/** Skill chips shared by the board card and the list row: the semantic list
    stays, and every chip is the installed Badge primitive. */
function SkillChips({ skills }: { skills: readonly string[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {skills.slice(0, 4).map((skill) => (<li key={skill}><Badge variant="outline" className="text-[11px] font-normal text-muted-foreground">{skill}</Badge></li>))}
    </ul>
  );
}

/**
 * One candidate as a non-clickable card: the truthful recruiter-facing facts and
 * nothing interactive. It is never a link, button, drag handle, or mutation shell.
 */
function CandidateCard({ candidate }: { candidate: PipelineCandidate }) {
  return (
    <Card data-pf-pipeline-card={candidate.id} size="sm">
      <CardHeader className="flex flex-row items-center gap-2.5">
        <Avatar size="sm" className="shrink-0"><AvatarFallback className="text-[11px] font-semibold">{initialsOf(candidate.fullName)}</AvatarFallback></Avatar>
        <div className="min-w-0 flex-1">
          <CardTitle><h3 className="text-balance text-[14px] leading-snug font-semibold text-foreground">{candidate.fullName}</h3></CardTitle>
          <p className={`mt-0.5 text-pretty leading-snug ${META}`}>{candidate.professionalTitle}</p>
        </div>
        <MatchScore score={candidate.matchScore} variant={STAGE_VARIANT[candidate.status]} />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className={META}>{plural(candidate.yearsOfExperience, "año", "años")} de experiencia</p>
        <SkillChips skills={candidate.skills} />
      </CardContent>
      <CardFooter className="flex flex-col items-start gap-1">
        <p className={CARD_META}>Origen: {CANDIDATE_SOURCE_LABELS[candidate.source]} · Responsable: {candidate.owner}</p>
        <p className={CARD_META}>{commentCopy(candidate.commentCount)}</p>
        {candidate.nextStep ? (
          <p data-pf-pipeline-next-step={candidate.id} className={`mt-1 rounded-lg bg-muted px-2.5 py-1.5 ${CARD_META}`}><span className="font-semibold text-foreground">Próximo paso: </span>{candidate.nextStep}</p>
        ) : null}
      </CardFooter>
    </Card>
  );
}

/** One always-present stage column: text label, supplemental dot, filtered count, honest empty state. */
function BoardColumn({ stage, count, candidates }: { stage: VacancyPipelineStage; count: number; candidates: readonly PipelineCandidate[] }) {
  const label = CANDIDATE_STATUS_LABELS[stage];
  return (
    <section data-pf-pipeline-column={stage} aria-label={`${label}: ${plural(count, "candidato", "candidatos")}`} className="flex min-w-0 flex-col rounded-2xl border border-border bg-card/40 p-3">
      <header className="flex items-center justify-between gap-2 px-1 pb-3">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className={`size-2.5 rounded-full ${STAGE_DOT[stage]}`} />
          <h3 className="text-[13.5px] font-semibold text-foreground">{label}</h3>
        </div>
        <Badge variant={STAGE_VARIANT[stage]} data-pf-pipeline-column-count={stage} className="text-[11px] font-semibold tabular-nums">{count}</Badge>
      </header>
      {candidates.length === 0 ? (
        <Empty data-pf-pipeline-column-empty={stage} className="border border-dashed border-border p-4">
          <EmptyDescription className="text-[12.5px]">Sin candidatos en esta etapa.</EmptyDescription>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {candidates.map((candidate) => (<li key={candidate.id}><CandidateCard candidate={candidate} /></li>))}
        </ul>
      )}
    </section>
  );
}

/**
 * The local Tablero/Lista switch: a labelled, controlled ToggleGroup of two
 * installed items. The pressed styling and `aria-pressed` both come from the
 * same local view, so the visible and the accessible state can never disagree.
 * It owns no routing, transport, or persistence.
 */
function ViewSwitch({ view, onChange }: { view: PipelineView; onChange: (next: PipelineView) => void }) {
  return (
    <ToggleGroup
      data-pf-pipeline-view
      aria-label="Vista del pipeline"
      variant="outline"
      spacing={0}
      value={[view]}
      onValueChange={(next: string[]) => {
        // Base UI emits an empty array when the active item is toggled off; ignoring it keeps one view always selected.
        const [nextView] = next;
        if (nextView === "board" || nextView === "list") onChange(nextView);
      }}
      className="self-start sm:self-auto"
    >
      {PIPELINE_VIEWS.map(({ id, label, Icon }) => (
        <ToggleGroupItem key={id} value={id} data-pf-pipeline-view-tab={id} className="h-10 gap-2 px-3.5">
          <Icon aria-hidden="true" className="size-4" />
          {label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/**
 * One candidate as a list row: the same truthful, non-interactive facts as the
 * board card, never a row-wide link, button, or drag handle.
 */
function CandidateRow({ candidate }: { candidate: PipelineCandidate }) {
  return (
    <TableRow data-pf-pipeline-row={candidate.id} className="border-b border-border/70 align-top last:border-b-0">
      <TableCell className={CELL}>
        <p className="text-[13.5px] font-semibold text-foreground">{candidate.fullName}</p>
        <p className={`mt-0.5 ${META}`}>{candidate.professionalTitle}</p>
      </TableCell>
      <TableCell className={CELL}>
        <Badge variant={STAGE_VARIANT[candidate.status]} dot className="text-[12px] font-semibold tabular-nums">{CANDIDATE_STATUS_LABELS[candidate.status]}</Badge>
      </TableCell>
      <TableCell className={`${CELL} ${META}`}>{plural(candidate.yearsOfExperience, "año", "años")} de experiencia</TableCell>
      <TableCell className={CELL}>
        <SkillChips skills={candidate.skills} />
      </TableCell>
      <TableCell className={CELL}><MatchScore score={candidate.matchScore} /></TableCell>
      <TableCell className={`${CELL} ${META}`}>{CANDIDATE_SOURCE_LABELS[candidate.source]}</TableCell>
      <TableCell className={`${CELL} ${META}`}>{candidate.owner}</TableCell>
      <TableCell className={`${CELL} ${META}`}>{commentCopy(candidate.commentCount)}</TableCell>
      <TableCell className={CELL}>
        {candidate.nextStep ? (<span data-pf-pipeline-next-step={candidate.id} className={`inline-block rounded-lg bg-muted px-2.5 py-1.5 ${CARD_META}`}><span className="font-semibold text-foreground">Próximo paso: </span>{candidate.nextStep}</span>) : null}
      </TableCell>
    </TableRow>
  );
}

/**
 * The list representation: one semantic responsive table over the exact filtered
 * array, in the order it was filtered into. Narrow screens scroll inside this
 * region instead of widening the document, and an empty set keeps an honest
 * message so the shared recovery below it still reads truthfully.
 */
function CandidateList({ label, candidates, emptyCopy }: { label: string; candidates: readonly PipelineCandidate[]; emptyCopy: string }) {
  return (
    <div data-pf-pipeline-list role="region" aria-label={label} tabIndex={0} className="overflow-x-auto rounded-2xl border border-border bg-card/40 p-1 focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none [&>[data-slot=table-container]]:contents">
      {candidates.length === 0 ? (
        <Empty data-pf-pipeline-list-empty className="border border-dashed border-border p-6">
          <EmptyDescription className="text-[12.5px]">{emptyCopy}</EmptyDescription>
        </Empty>
      ) : (
        <Table className="min-w-[64rem]">
          <TableCaption className="sr-only">{label}</TableCaption>
          <TableHeader>
            <TableRow className="border-b border-border hover:bg-transparent">
              {LIST_COLUMN_LABELS.map((column) => (<TableHead key={column} scope="col" className="px-3 py-2.5 text-[12px] font-semibold text-muted-foreground">{column}</TableHead>))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {candidates.map((candidate) => (<CandidateRow key={candidate.id} candidate={candidate} />))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

/**
 * Per-vacancy pipeline surface: a fully local, in-memory client view over one
 * validated vacancy and the candidate cards already filtered to it. It derives
 * the four column counts from the model helper, filters by name, title, and
 * skills with a diacritic-insensitive search, and renders that single filtered
 * set as either the Tablero board or the Lista table behind one accessible local
 * switch. It reports how many candidate cards the current view shows out of the
 * vacancy total. It owns no fetch, router mutation, storage, drag/drop, or
 * candidate mutation, and it never imports fixtures.
 */
export function PipelineWorkspace({ vacancy, candidates }: { vacancy: EmployerVacancy; candidates: readonly PipelineCandidate[] }) {
  const [filters, setFilters] = React.useState(createEmptyPipelineFilters);
  const [view, setView] = React.useState<PipelineView>("board");
  const filtered = filterPipelineCandidates(candidates, filters);
  const stageCounts = summarizeCandidateStages(filtered);
  const hasActive = hasActivePipelineFilters(filters);
  const listEmptyCopy = pipelineListEmptyCopy(filters);
  return (
    <div data-pf-pipeline className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="pipeline-search" className="text-[12.5px] font-medium text-foreground">Buscar candidato</label>
          <InputGroup className="h-10 sm:w-80">
            <InputGroupAddon>
              <SearchIcon aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput id="pipeline-search" data-pf-pipeline-search type="search" value={filters.query} onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))} placeholder="Nombre, puesto o habilidad" />
          </InputGroup>
        </div>
        <ViewSwitch view={view} onChange={setView} />
      </div>
      <PipelineFilterBar candidates={candidates} filters={filters} onChange={setFilters} />
      <p data-pf-pipeline-sample className={META}>{visibleCandidatesCopy(filtered.length, vacancyCandidateTotal(vacancy.candidateCounts))}</p>
      {view === "board" ? (
        <div data-pf-pipeline-board role="region" aria-label={`Tablero de candidatos de ${vacancy.title}`} tabIndex={0} className="overflow-x-auto pb-1 focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none">
          <div data-pf-pipeline-grid className="grid min-w-[60rem] grid-cols-4 gap-3 lg:min-w-0">
            {VACANCY_PIPELINE_STAGES.map((stage) => (<BoardColumn key={stage} stage={stage} count={stageCounts[stage]} candidates={filtered.filter((candidate) => candidate.status === stage)} />))}
          </div>
        </div>
      ) : (
        <CandidateList label={`Lista de candidatos de ${vacancy.title}`} candidates={filtered} emptyCopy={listEmptyCopy} />
      )}
      {hasActive && filtered.length === 0 ? (
        <Empty data-pf-pipeline-recovery className="border border-dashed border-border bg-card/40 p-6">
          <EmptyHeader>
            <EmptyTitle>Sin resultados</EmptyTitle>
            <EmptyDescription>{pipelineNoResultsCopy(filters)}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button type="button" variant="outline" data-pf-pipeline-clear onClick={() => setFilters(createEmptyPipelineFilters())} className="h-10">Limpiar filtros</Button>
          </EmptyContent>
        </Empty>
      ) : null}
    </div>
  );
}
