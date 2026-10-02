"use client";

import * as React from "react";
import { Columns3Icon, ListIcon, SearchIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TalentDetailSheet } from "@/features/employer-talent/talent-detail-sheet";

import { vacancyCandidateTotal } from "./model";
import type { EmployerVacancy } from "./model";
import {
  CANDIDATE_SOURCE_LABELS,
  CANDIDATE_STATUS_LABELS,
  findCandidateById,
  summarizeCandidateStages,
  visibleCandidatesCopy,
} from "./pipeline-model";
import type { CandidateStatus, PipelineCandidate } from "./pipeline-model";
import {
  CARD_META,
  META,
  MatchScore,
  PipelineBoard,
  PipelineCandidateActions,
  STAGE_VARIANT,
  SkillChips,
  commentCopy,
  plural,
} from "./pipeline-board";
import {
  createEmptyPipelineFilters,
  filterPipelineCandidates,
  hasActivePipelineFilters,
  pipelineListEmptyCopy,
  pipelineNoResultsCopy,
} from "./pipeline-filter-model";
import { PipelineFilterBar } from "./pipeline-filters";
import {
  appendPipelineMoveRecord,
  applyPipelineStageMoves,
  confirmedPipelineMessage,
  isCandidateStatus,
  pipelineActivityItems,
  pipelineCandidateDetailView,
  pipelineMoveIntent,
  pipelineMoveRecordsOf,
  recordPipelineStageMove,
} from "./pipeline-move-model";
import type {
  PipelineMoveIntent,
  PipelineMoveRecord,
  PipelineNotificationDraft,
  PipelineStageMoves,
} from "./pipeline-move-model";
import { PipelineMoveDialog } from "./pipeline-move-dialog";

/**
 * Per-vacancy pipeline surface: a fully local, in-memory client view over one
 * validated vacancy and the candidate cards already filtered to it.
 *
 * It owns the filter state, the single filtered projection both representations
 * render, the visit-local confirmed movements, the pending change awaiting
 * confirmation, the selected detail and the message drafts composed with each
 * move. Confirmation alone applies a movement; cancel, Escape, dismissal,
 * outside drops and same-stage choices mutate nothing. It never imports
 * fixtures, never fetches, stores or routes, and it claims no delivery.
 *
 * A client navigation to another vacancy starts a new visit-local session: the
 * inner session is keyed by the vacancy id, so no movement, pending change,
 * detail selection or draft can leak into the vacancy the visitor just opened.
 */
export function PipelineWorkspace({
  vacancy,
  candidates,
}: {
  vacancy: EmployerVacancy;
  candidates: readonly PipelineCandidate[];
}) {
  return <PipelineVacancySession key={vacancy.id} vacancy={vacancy} candidates={candidates} />;
}

/** The two local display modes of the pipeline. Nothing outside this component reads them. */
type PipelineView = "board" | "list";

/** Both view buttons: label, column/list icon, and the pressed target they set. */
const PIPELINE_VIEWS = [
  { id: "board", label: "Tablero", Icon: Columns3Icon },
  { id: "list", label: "Lista", Icon: ListIcon },
] as const;

/** Column headers of the list representation, in render order. */
const LIST_COLUMN_LABELS = [
  "Candidato",
  "Estado",
  "Experiencia",
  "Habilidades",
  "Compatibilidad",
  "Origen",
  "Responsable",
  "Comentarios",
  "Próximo paso",
  "Acciones",
] as const;

/** Shared list-row cell geometry, kept identical across every column. */
const CELL = "px-3 py-3 align-top";

/** Detail control shared by the board card and the list row: a real button with
    a candidate-specific accessible name and a visible focus ring. */
const DETAIL_CONTROL =
  "h-auto min-h-10 max-w-full justify-start whitespace-normal px-0 text-left";

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

/** One candidate as a list row: the same truthful facts as the board card, with
    the detail control in the identity cell and one actions menu at the end. */
function CandidateRow({
  candidate,
  onOpenDetail,
  onRequestMove,
}: {
  candidate: PipelineCandidate;
  onOpenDetail: (candidateId: string) => void;
  onRequestMove: (candidateId: string, to: CandidateStatus) => void;
}) {
  return (
    <TableRow data-pf-pipeline-row={candidate.id} className="border-b border-border/70 align-top last:border-b-0">
      <TableCell className={CELL}>
        <Button
          type="button"
          variant="ghost"
          data-pf-pipeline-detail={candidate.id}
          aria-label={`Ver detalle de ${candidate.fullName}`}
          onClick={() => onOpenDetail(candidate.id)}
          className={DETAIL_CONTROL}
        >
          {candidate.fullName}
        </Button>
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
      <TableCell className={CELL}>
        <div className="flex justify-end">
          <PipelineCandidateActions candidate={candidate} onOpenDetail={onOpenDetail} onRequestMove={onRequestMove} />
        </div>
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
function CandidateList({
  label,
  candidates,
  emptyCopy,
  onOpenDetail,
  onRequestMove,
}: {
  label: string;
  candidates: readonly PipelineCandidate[];
  emptyCopy: string;
  onOpenDetail: (candidateId: string) => void;
  onRequestMove: (candidateId: string, to: CandidateStatus) => void;
}) {
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
            {candidates.map((candidate) => (
              <CandidateRow
                key={candidate.id}
                candidate={candidate}
                onOpenDetail={onOpenDetail}
                onRequestMove={onRequestMove}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

/**
 * Local activity of one candidate inside the shared detail Sheet: the requested
 * stage changes that were confirmed in this visit, with the message prepared for
 * the candidate when there was one. It is a record of local drafts and never a
 * delivery report.
 */
function PipelineActivity({ records }: { records: readonly PipelineMoveRecord[] }) {
  const items = pipelineActivityItems(records);
  if (items.length === 0) {
    return (
      <p data-pf-pipeline-activity-empty="" className="rounded-xl bg-muted p-3 text-[12.5px] text-muted-foreground">
        Aún no hay movimientos registrados.
      </p>
    );
  }
  return (
    <ul data-pf-pipeline-activity="" className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.key} data-pf-pipeline-activity-item={item.key} className="flex flex-col gap-1 rounded-xl bg-muted p-3">
          <p className="text-sm font-semibold text-foreground">{item.title}</p>
          <p className="text-[12.5px] text-muted-foreground">{item.detail}</p>
          {item.message === null ? null : (
            <p data-pf-pipeline-activity-message="" className="mt-1 rounded-lg bg-card px-2.5 py-2 text-sm text-foreground">
              <span className="font-semibold">Mensaje: </span>
              {item.message}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The visit-local state of one vacancy: filters, view, confirmed movements,
    pending change, selected detail and the message drafts of each movement. */
function PipelineVacancySession({
  vacancy,
  candidates,
}: {
  vacancy: EmployerVacancy;
  candidates: readonly PipelineCandidate[];
}) {
  const [filters, setFilters] = React.useState(createEmptyPipelineFilters);
  const [view, setView] = React.useState<PipelineView>("board");
  /** Confirmed stage overrides; the frozen roster itself is never rewritten. */
  const [stageMoves, setStageMoves] = React.useState<PipelineStageMoves>({});
  const [moveRecords, setMoveRecords] = React.useState<readonly PipelineMoveRecord[]>([]);
  /** The change that is pending confirmation; `null` means none. */
  const [moveIntent, setMoveIntent] = React.useState<PipelineMoveIntent | null>(null);
  /**
   * The intent that is still awaiting a decision. It is cleared by the first
   * decision, because Base UI reports a close when the confirmation unmounts
   * after a confirmation too: that report must not be read as a cancellation.
   */
  const pendingIntentRef = React.useRef<PipelineMoveIntent | null>(null);
  const [detailCandidateId, setDetailCandidateId] = React.useState<string | null>(null);
  const [announcement, setAnnouncement] = React.useState("");
  /** Where focus goes once the move it belongs to has been rendered. */
  const [pendingFocus, setPendingFocus] = React.useState<{
    candidateId: string;
    stage: CandidateStatus;
  } | null>(null);

  const roster = React.useMemo(
    () => applyPipelineStageMoves(candidates, stageMoves),
    [candidates, stageMoves],
  );
  const filtered = filterPipelineCandidates(roster, filters);
  const stageCounts = summarizeCandidateStages(filtered);
  const hasActive = hasActivePipelineFilters(filters);
  const listEmptyCopy = pipelineListEmptyCopy(filters);

  const pendingCandidate =
    moveIntent === null ? null : (findCandidateById(roster, moveIntent.candidateId) ?? null);
  const detailCandidate =
    detailCandidateId === null ? null : (findCandidateById(roster, detailCandidateId) ?? null);

  // A confirmed move can relocate a card into another column or hide it behind
  // the active filter. The moved card's own detail control is the destination
  // when it is still rendered; otherwise the destination column (or the list
  // region) receives focus, so focus is never dropped on the document body.
  React.useEffect(() => {
    if (pendingFocus === null) return;
    const control = document.querySelector<HTMLElement>(
      `[data-pf-pipeline-detail="${pendingFocus.candidateId}"]`,
    );
    const column = document.querySelector<HTMLElement>(
      `[data-pf-pipeline-column="${pendingFocus.stage}"]`,
    );
    const listRegion = document.querySelector<HTMLElement>("[data-pf-pipeline-list]");
    (control ?? column ?? listRegion)?.focus();
    setPendingFocus(null);
  }, [pendingFocus]);

  function requestMove(candidateId: string, to: string) {
    if (!isCandidateStatus(to)) return;
    const candidate = findCandidateById(roster, candidateId);
    if (candidate === undefined) return;
    const intent = pipelineMoveIntent(candidate, to);
    // A same-stage drop, or a target outside the four stages, is a no-op: it
    // opens no confirmation and leaves the roster untouched.
    if (intent === null) return;
    pendingIntentRef.current = intent;
    setMoveIntent(intent);
  }

  function cancelMove() {
    const intent = pendingIntentRef.current;
    if (intent === null) return;
    pendingIntentRef.current = null;
    setMoveIntent(null);
    setPendingFocus({ candidateId: intent.candidateId, stage: intent.from });
  }

  function confirmMove(confirmed: {
    to: CandidateStatus;
    notification: PipelineNotificationDraft;
  }) {
    const intent = pendingIntentRef.current;
    if (intent === null) return;
    pendingIntentRef.current = null;
    const name = findCandidateById(roster, intent.candidateId)?.fullName ?? "";
    setStageMoves((current) => recordPipelineStageMove(current, intent.candidateId, confirmed.to));
    setMoveRecords((current) =>
      appendPipelineMoveRecord(current, {
        candidateId: intent.candidateId,
        from: intent.from,
        to: confirmed.to,
        message: confirmedPipelineMessage(confirmed.notification),
      }),
    );
    setAnnouncement(
      `Movimiento confirmado: ${name} ahora está en ${CANDIDATE_STATUS_LABELS[confirmed.to]}.`,
    );
    setMoveIntent(null);
    setPendingFocus({ candidateId: intent.candidateId, stage: confirmed.to });
  }

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
      <p role="status" aria-live="polite" data-pf-pipeline-announcement="" className="sr-only">{announcement}</p>
      {view === "board" ? (
        <PipelineBoard
          candidates={filtered}
          stageCounts={stageCounts}
          boardLabel={`Tablero de candidatos de ${vacancy.title}`}
          onOpenDetail={setDetailCandidateId}
          onRequestMove={requestMove}
        />
      ) : (
        <CandidateList
          label={`Lista de candidatos de ${vacancy.title}`}
          candidates={filtered}
          emptyCopy={listEmptyCopy}
          onOpenDetail={setDetailCandidateId}
          onRequestMove={requestMove}
        />
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
      {moveIntent !== null && pendingCandidate !== null ? (
        <PipelineMoveDialog
          candidateName={pendingCandidate.fullName}
          vacancyTitle={vacancy.title}
          from={moveIntent.from}
          to={moveIntent.to}
          onCancel={cancelMove}
          onConfirm={confirmMove}
        />
      ) : null}
      <TalentDetailSheet
        person={detailCandidate === null ? null : pipelineCandidateDetailView(detailCandidate)}
        vacancyTitleById={{}}
        open={detailCandidate !== null}
        onOpenChange={(next: boolean) => {
          if (!next) setDetailCandidateId(null);
        }}
        activity={
          detailCandidateId === null ? null : (
            <PipelineActivity records={pipelineMoveRecordsOf(moveRecords, detailCandidateId)} />
          )
        }
      />
    </div>
  );
}
