"use client";

import * as React from "react";
import { cn } from "cn";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { CollisionDetection, DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { EllipsisVerticalIcon, GripVerticalIcon } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription } from "@/components/ui/empty";

import { VACANCY_PIPELINE_STAGES } from "./model";
import type { VacancyPipelineStage } from "./model";
import { CANDIDATE_SOURCE_LABELS, CANDIDATE_STATUS_LABELS } from "./pipeline-model";
import type { CandidateStatus, PipelineCandidate } from "./pipeline-model";

/**
 * Kanban surface of one vacancy pipeline: the four committed stage columns, the
 * candidate cards with their truthful recruiter facts, the handle-only drag
 * contract, and the per-candidate actions menu that moves a card without a
 * pointer. The candidate presented by a menu is always the card that owns the
 * trigger, never a similarly named person from another fixture.
 *
 * The board is a local prototype: dragging never mutates anything by itself, the
 * confirmed move that a drop requests is owned by the workspace, and nothing
 * here fetches, persists or reports a delivery.
 */

/** Supplementary dot color for the non-Badge column-heading stage marker. */
const STAGE_DOT: Readonly<Record<VacancyPipelineStage, string>> = {
  submitted: "bg-status-info",
  in_review: "bg-status-review",
  hired: "bg-status-success",
  rejected: "bg-status-danger",
};

/**
 * Semantic stage variant: the Spanish label always carries the meaning, so the
 * shared Badge variant only reinforces it through the `--status-*` tokens. No
 * raw color value or local tone recipe is authored here.
 */
export const STAGE_VARIANT: Readonly<Record<VacancyPipelineStage, BadgeVariant>> = {
  submitted: "info",
  in_review: "review",
  hired: "success",
  rejected: "danger",
};

/** Shared metadata type scale of the board card and the list row. */
export const META = "text-[12px] text-muted-foreground";
export const CARD_META = "text-[11.5px] text-muted-foreground";

/** Spanish count agreement: singular for exactly one, plural otherwise. */
export const plural = (count: number, singular: string, pluralForm: string) =>
  `${count} ${count === 1 ? singular : pluralForm}`;

/** Honest zero-comment copy, shared by both representations. */
export const commentCopy = (count: number) =>
  count === 0 ? "Sin comentarios" : plural(count, "comentario", "comentarios");

/** Deterministic first+last initials, so an avatar never depends on randomness. */
export function initialsOf(fullName: string): string {
  const words = fullName.trim().split(/\s+/u).filter((word) => word !== "");
  const first = words[0]?.charAt(0) ?? "";
  const last = words.length > 1 ? words[words.length - 1].charAt(0) : "";
  return `${first}${last}`.toUpperCase();
}

/** Match-score Badge shared by the board card and the list row. A counter is
    not a status, so it never opts into the decorative dot even when it reuses a
    semantic stage variant for color. */
export function MatchScore({ score, variant }: { score: number; variant?: BadgeVariant }) {
  return (
    <Badge variant={variant ?? "outline"} className="font-bold tabular-nums">
      <span className="sr-only">Compatibilidad </span>
      {score}%
    </Badge>
  );
}

/** Skill chips shared by the board card and the list row: the semantic list
    stays, and every chip is the installed Badge primitive. */
export function SkillChips({ skills }: { skills: readonly string[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {skills.slice(0, 4).map((skill) => (
        <li key={skill}>
          <Badge variant="outline" className="text-[11px] font-normal text-muted-foreground">
            {skill}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

/** One row of the movement menu: the current stage is offered but inert. */
function StageMoveItem({
  stage,
  current,
  onSelect,
}: {
  stage: CandidateStatus;
  current: CandidateStatus;
  onSelect: (stage: CandidateStatus) => void;
}) {
  const isCurrent = stage === current;
  return (
    <DropdownMenuItem
      className="min-h-10"
      data-pf-pipeline-move-target={stage}
      disabled={isCurrent}
      onClick={() => onSelect(stage)}
    >
      {CANDIDATE_STATUS_LABELS[stage]}
      {isCurrent ? <span className="sr-only"> (etapa actual)</span> : null}
    </DropdownMenuItem>
  );
}

/**
 * Actions of one candidate: the non-drag movement alternative and the detail
 * entry. The trigger is a real 40px ghost icon Button carrying a
 * candidate-specific accessible name, and every item only asks the workspace for
 * a pending change; nothing in the menu mutates, sends or stores.
 */
export function PipelineCandidateActions({
  candidate,
  onOpenDetail,
  onRequestMove,
}: {
  candidate: PipelineCandidate;
  onOpenDetail: (candidateId: string) => void;
  onRequestMove: (candidateId: string, to: CandidateStatus) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-10"
            data-pf-pipeline-move={candidate.id}
            aria-label={`Acciones de ${candidate.fullName}`}
          />
        }
      >
        <EllipsisVerticalIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" className="min-w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Mover a otra etapa</DropdownMenuLabel>
          {VACANCY_PIPELINE_STAGES.map((stage) => (
            <StageMoveItem
              key={stage}
              stage={stage}
              current={candidate.status}
              onSelect={(to) => onRequestMove(candidate.id, to)}
            />
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            className="min-h-10"
            data-pf-pipeline-detail-action={candidate.id}
            onClick={() => onOpenDetail(candidate.id)}
          >
            Ver detalle
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One candidate as a board card. The card body opens the detail sheet, the
 * dedicated handle owns the drag, and the actions menu moves the card without a
 * pointer. No control nests another: the card is not a button, and the drag
 * handle and the menu are siblings of the detail control.
 */
function CandidateCard({
  candidate,
  onOpenDetail,
  onRequestMove,
  suppressClickRef,
}: {
  candidate: PipelineCandidate;
  onOpenDetail: (candidateId: string) => void;
  onRequestMove: (candidateId: string, to: CandidateStatus) => void;
  suppressClickRef: React.RefObject<boolean>;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: candidate.id,
    attributes: { roleDescription: "Tarjeta de candidato" },
  });
  return (
    <Card
      ref={setNodeRef}
      data-pf-pipeline-card={candidate.id}
      size="sm"
      onClick={(event: React.MouseEvent<HTMLElement>) => {
        // A drag ends with a synthetic click on its own card; opening the detail
        // there would be an accident, so the drag consumes that click.
        if (suppressClickRef.current) return;
        // The card body is a pointer convenience; every control keeps its own
        // activation, so a click on one is never read as a card click.
        const target = event.target as HTMLElement;
        if (target.closest("button, a, input, textarea, [role='menu']") !== null) return;
        onOpenDetail(candidate.id);
      }}
      className={cn("cursor-pointer transition-shadow motion-reduce:transition-none", isDragging && "opacity-60")}
    >
      <CardHeader className="grid-cols-[1fr_auto] items-start">
        <div className="flex min-w-0 items-start gap-2.5">
          <Avatar size="sm" className="shrink-0">
            <AvatarFallback className="text-[11px] font-semibold">
              {initialsOf(candidate.fullName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <CardTitle>
              <h3 className="text-balance text-[14px] leading-snug font-semibold text-foreground">
                <Button
                  type="button"
                  variant="ghost"
                  data-pf-pipeline-detail={candidate.id}
                  aria-label={`Ver detalle de ${candidate.fullName}`}
                  onClick={() => onOpenDetail(candidate.id)}
                  className="h-auto min-h-10 max-w-full justify-start whitespace-normal px-0 text-left"
                >
                  {candidate.fullName}
                </Button>
              </h3>
            </CardTitle>
            <p className={`mt-0.5 text-pretty leading-snug ${META}`}>
              {candidate.professionalTitle}
            </p>
          </div>
        </div>
        <CardAction className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            ref={setActivatorNodeRef}
            data-pf-pipeline-drag={candidate.id}
            aria-label={`Mover a ${candidate.fullName} de etapa`}
            className="size-10 cursor-grab touch-none motion-reduce:transition-none active:cursor-grabbing"
            {...listeners}
            {...attributes}
          >
            <GripVerticalIcon aria-hidden="true" />
          </Button>
          <PipelineCandidateActions
            candidate={candidate}
            onOpenDetail={onOpenDetail}
            onRequestMove={onRequestMove}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <MatchScore score={candidate.matchScore} variant={STAGE_VARIANT[candidate.status]} />
          <p className={META}>{plural(candidate.yearsOfExperience, "año", "años")} de experiencia</p>
        </div>
        <SkillChips skills={candidate.skills} />
      </CardContent>
      <CardFooter className="flex flex-col items-start gap-1">
        <p className={CARD_META}>
          Origen: {CANDIDATE_SOURCE_LABELS[candidate.source]} · Responsable: {candidate.owner}
        </p>
        <p className={CARD_META}>{commentCopy(candidate.commentCount)}</p>
        {candidate.nextStep ? (
          <p
            data-pf-pipeline-next-step={candidate.id}
            className={`mt-1 rounded-lg bg-muted px-2.5 py-1.5 ${CARD_META}`}
          >
            <span className="font-semibold text-foreground">Próximo paso: </span>
            {candidate.nextStep}
          </p>
        ) : null}
      </CardFooter>
    </Card>
  );
}

/** The dragged card's ghost: identity and stage only, so the pointer carries no
    extra interactive surface. */
function DragPreview({ candidate }: { candidate: PipelineCandidate }) {
  return (
    <Card size="sm" data-pf-pipeline-drag-preview={candidate.id} className="shadow-lg">
      <CardHeader className="flex flex-row items-center gap-2.5">
        <Avatar size="sm" className="shrink-0">
          <AvatarFallback className="text-[11px] font-semibold">
            {initialsOf(candidate.fullName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] leading-snug font-semibold text-foreground">
            {candidate.fullName}
          </p>
          <p className={`mt-0.5 ${META}`}>{candidate.professionalTitle}</p>
        </div>
        <Badge variant={STAGE_VARIANT[candidate.status]} dot className="text-[11px] font-semibold">
          {CANDIDATE_STATUS_LABELS[candidate.status]}
        </Badge>
      </CardHeader>
    </Card>
  );
}

/** One always-present stage column and its drop target. */
function BoardColumn({
  stage,
  count,
  candidates,
  onOpenDetail,
  onRequestMove,
  suppressClickRef,
}: {
  stage: VacancyPipelineStage;
  count: number;
  candidates: readonly PipelineCandidate[];
  onOpenDetail: (candidateId: string) => void;
  onRequestMove: (candidateId: string, to: CandidateStatus) => void;
  suppressClickRef: React.RefObject<boolean>;
}) {
  const label = CANDIDATE_STATUS_LABELS[stage];
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return (
    <section
      ref={setNodeRef}
      data-pf-pipeline-column={stage}
      data-pf-pipeline-column-over={isOver ? "" : undefined}
      aria-label={`${label}: ${plural(count, "candidato", "candidatos")}`}
      tabIndex={-1}
      className={cn("flex min-w-0 flex-col rounded-2xl border border-border bg-card/40 p-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/30", isOver && "ring-2 ring-ring/40")}
    >
      <header className="flex items-center justify-between gap-2 px-1 pb-3">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className={`size-2.5 rounded-full ${STAGE_DOT[stage]}`} />
          <h3 className="text-[13.5px] font-semibold text-foreground">{label}</h3>
        </div>
        <Badge
          variant={STAGE_VARIANT[stage]}
          data-pf-pipeline-column-count={stage}
          className="text-[11px] font-semibold tabular-nums"
        >
          {count}
        </Badge>
      </header>
      {candidates.length === 0 ? (
        <Empty
          data-pf-pipeline-column-empty={stage}
          className="border border-dashed border-border p-4"
        >
          <EmptyDescription className="text-[12.5px]">
            Sin candidatos en esta etapa.
          </EmptyDescription>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {candidates.map((candidate) => (
            <li key={candidate.id}>
              <CandidateCard
                candidate={candidate}
                onOpenDetail={onOpenDetail}
                onRequestMove={onRequestMove}
                suppressClickRef={suppressClickRef}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Spanish drag instructions announced once per board. */
const SCREEN_READER_INSTRUCTIONS = {
  draggable:
    "Presiona espacio o enter para levantar la tarjeta, mueve con las flechas y vuelve a presionar espacio o enter para soltarla. Escape cancela el movimiento.",
} as const;

/** True when the visitor asked the system to reduce motion. SSR and jsdom
    (no `matchMedia`) resolve to false, so the board never animates a drop. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

export type PipelineBoardProps = {
  candidates: readonly PipelineCandidate[];
  /** Visible counts per stage, already derived from the filtered set. */
  stageCounts: Readonly<Record<VacancyPipelineStage, number>>;
  /** Accessible name of the scroll region that owns the grid. */
  boardLabel: string;
  onOpenDetail: (candidateId: string) => void;
  onRequestMove: (candidateId: string, to: CandidateStatus) => void;
};

/**
 * The Tablero representation: one explicit, stable drag context over the four
 * stage columns. Pointer and touch drags start only on a card's handle and need
 * a deliberate activation move, the keyboard sensor drives the same handle, and
 * a drop anywhere outside a column resolves to no target at all.
 */
export function PipelineBoard({
  candidates,
  stageCounts,
  boardLabel,
  onOpenDetail,
  onRequestMove,
}: PipelineBoardProps) {
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const reducedMotion = useReducedMotion();
  /** Set while a drag is in flight so its closing click never opens a detail. */
  const suppressClickRef = React.useRef(false);
  /** Which input started the drag: a keyboard drag has no pointer to hit-test. */
  const inputModeRef = React.useRef<"pointer" | "keyboard">("pointer");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const collisionDetection = React.useCallback<CollisionDetection>((args) => {
    // Pointer drags resolve against the pointer, so releasing outside every
    // column yields no target. A keyboard drag has no pointer and resolves
    // against the nearest column instead.
    if (inputModeRef.current === "keyboard") return closestCorners(args);
    return pointerWithin(args);
  }, []);

  const accessibility = React.useMemo(
    () => ({
      screenReaderInstructions: SCREEN_READER_INSTRUCTIONS,
      announcements: {
        onDragStart: ({ active }: { active: { id: string | number } }) =>
          `Levantaste la tarjeta de ${candidates.find(candidate => candidate.id === String(active.id))?.fullName ?? "la persona candidata"}.`,
        onDragOver: ({ over }: { over: { id: string | number } | null }) =>
          over === null
            ? "Fuera de las etapas del pipeline."
            : `Sobre la etapa ${CANDIDATE_STATUS_LABELS[over.id as CandidateStatus] ?? "seleccionada"}.`,
        onDragEnd: ({ over }: { over: { id: string | number } | null }) =>
          over === null
            ? "Soltaste la tarjeta fuera de las etapas: no se movió."
            : `Soltaste la tarjeta sobre ${CANDIDATE_STATUS_LABELS[over.id as CandidateStatus] ?? "la etapa seleccionada"}.`,
        onDragCancel: () => "Cancelaste el movimiento: la etapa no cambió.",
      },
    }),
    [candidates],
  );

  const activeCandidate = candidates.find((candidate) => candidate.id === activeId) ?? null;

  function handleDragStart(event: DragStartEvent) {
    suppressClickRef.current = true;
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    // The synthetic click of the drop fires after this handler, before timers.
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
    const { over } = event;
    if (over === null) return;
    const stage = String(over.id);
    if (!(VACANCY_PIPELINE_STAGES as readonly string[]).includes(stage)) return;
    onRequestMove(String(event.active.id), stage as CandidateStatus);
  }

  function handleDragCancel() {
    setActiveId(null);
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }

  return (
    <DndContext
      id="pipeline-board"
      accessibility={accessibility}
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div
        data-pf-pipeline-board
        role="region"
        aria-label={boardLabel}
        tabIndex={0}
        className="overflow-x-auto pb-1 focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
        onPointerDownCapture={() => {
          inputModeRef.current = "pointer";
        }}
        onKeyDownCapture={(event: React.KeyboardEvent<HTMLElement>) => {
          if (event.key === " " || event.key === "Enter") inputModeRef.current = "keyboard";
        }}
      >
        <div data-pf-pipeline-grid className="grid min-w-[60rem] grid-cols-4 gap-3 lg:min-w-0">
          {VACANCY_PIPELINE_STAGES.map((stage) => (
            <BoardColumn
              key={stage}
              stage={stage}
              count={stageCounts[stage]}
              candidates={candidates.filter((candidate) => candidate.status === stage)}
              onOpenDetail={onOpenDetail}
              onRequestMove={onRequestMove}
              suppressClickRef={suppressClickRef}
            />
          ))}
        </div>
      </div>
      <DragOverlay dropAnimation={reducedMotion ? null : undefined} aria-hidden="true">
        {activeCandidate ? <DragPreview candidate={activeCandidate} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
