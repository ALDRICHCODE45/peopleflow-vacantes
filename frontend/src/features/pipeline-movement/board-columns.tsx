"use client";
import { useRef, useState, type RefObject } from "react";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCorners, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent } from "@dnd-kit/core";
import { CalendarDays, Ellipsis, FileText, GitBranch, GripVertical, Lock } from "lucide-react";
import { cn } from "cn";
import { ActionStatus, ActionStatusSlot } from "@/components/feedback/action-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { StageKindBadge } from "@/features/employer-vacancies/stage-config/stage-row";
import { allowedMoveTargets } from "./helpers";
import { discardReasonLabel } from "./discard-text";
import type { Board, Participation } from "./model";
import type { Notice } from "./board-feedback";
import { MovementDate } from "@/features/pipeline-movement/board-states";

type Props = {
  board: Board; pending: Set<string>; locked: boolean; notices: Record<string, Notice>;
  onMove: (id: string, target: string) => void; onDetail: (id: string) => void;
  onDisposition: (id: string, kind: "discard" | "recover") => void;
};
function CandidateCard({ item, targets, disabled, pending, notice, onMove, onDetail, onDisposition, suppressClick }: {
  item: Participation; targets: Board["stages"]; disabled: boolean; pending: boolean; notice?: Notice;
  onMove: Props["onMove"]; onDetail: Props["onDetail"]; onDisposition: Props["onDisposition"]; suppressClick: RefObject<boolean>;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: item.id, disabled: disabled || !!item.discard, attributes: { roleDescription: "Tarjeta de candidato" },
  });
  const statusId = `move-status-${item.id}`;
  return <Card ref={setNodeRef} size="sm" aria-busy={pending} className={cn("cursor-pointer", isDragging && "opacity-60")}
    onClick={event => {
      if (suppressClick.current || (event.target as HTMLElement).closest("button,a,[role='menu']")) return;
      onDetail(item.id);
    }}>
    <CardHeader className="border-b">
      <div className="flex min-w-0 items-start gap-1">
        <Button type="button" variant="ghost" size="icon" className="size-10 shrink-0 cursor-grab touch-none active:cursor-grabbing"
          ref={setActivatorNodeRef} {...attributes} {...listeners} disabled={disabled || !!item.discard} id={`candidate-drag-${item.id}`} aria-label={`Arrastrar ${item.candidate.full_name}`} aria-describedby={notice ? statusId : undefined}>
          <GripVertical aria-hidden="true" />
        </Button>
        <CardTitle className="min-w-0"><Button type="button" variant="ghost" className="h-auto min-h-10 max-w-full justify-start whitespace-normal text-left"
          id={`candidate-detail-${item.id}`} aria-label={`Ver detalle de ${item.candidate.full_name}`} onClick={() => onDetail(item.id)}>{item.candidate.full_name}</Button></CardTitle>
      </div>
      <CardAction><DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" className="size-10" disabled={disabled} id={`candidate-move-${item.id}`} aria-label={`Mover a… ${item.candidate.full_name}`} aria-describedby={notice ? statusId : undefined} />}>
          {pending ? <Spinner aria-hidden="true" /> : <Ellipsis aria-hidden="true" />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48"><DropdownMenuGroup><DropdownMenuLabel>{item.discard ? "Candidato descartado" : "Mover a…"}</DropdownMenuLabel>
          {targets.map(stage => <DropdownMenuItem key={stage.id} className="min-h-10" disabled={disabled} onClick={() => onMove(item.id, stage.id)}>{stage.name}</DropdownMenuItem>)}
        </DropdownMenuGroup><DropdownMenuGroup><DropdownMenuItem className="min-h-10" variant={item.discard ? "default" : "destructive"} disabled={disabled} onClick={() => onDisposition(item.id, item.discard ? "recover" : "discard")}>{item.discard ? "Recuperar" : "Descartar"}</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent>
      </DropdownMenu></CardAction>
    </CardHeader>
    <CardContent className="flex flex-col gap-2 text-xs text-muted-foreground">
      <p className="flex items-center gap-2"><CalendarDays aria-hidden="true" className="size-3.5 shrink-0" /><span>Postulación: <MovementDate value={item.applied_at} /></span></p>
      {item.discard && <p className="text-sm text-foreground">{discardReasonLabel(item.discard.reason)}</p>}
      <p className="flex items-start gap-2"><FileText aria-hidden="true" className="size-3.5 shrink-0" /><span className="break-words">{item.cv.name}</span></p>
    </CardContent>
    <CardFooter className="border-t"><ActionStatusSlot>{pending ? <span role="status" className="text-sm text-muted-foreground">Guardando cambio…</span> : notice ? <ActionStatus id={statusId} tone={notice.tone} text={notice.text} /> : null}</ActionStatusSlot></CardFooter>
  </Card>;
}
function Column({ stage, disabled, dragging, children }: { stage: Board["stages"][number] | Board["exit"]; disabled: boolean; dragging: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id, disabled });
  return <Card ref={setNodeRef} role="region" aria-label={`${stage.name}: ${stage.count} candidatos`} aria-describedby={dragging ? `drop-status-${stage.id}` : undefined}
    data-drop-disabled={disabled} data-pf-published-column="" className={cn("min-w-0 self-start", isOver && "ring-2 ring-ring")}>
    <CardHeader className="border-b"><div className="flex items-start justify-between gap-2"><h3 className="font-heading text-base font-semibold">{stage.name}</h3><Badge variant="secondary" aria-label={`${stage.count} candidatos`}>{stage.count}</Badge></div>
      <div className="flex flex-wrap items-center gap-2"><StageKindBadge kind={stage.kind} />{stage.kind === "discarded" && <Badge variant="neutral"><Lock aria-hidden="true" />Sin movimientos directos</Badge>}</div>
    </CardHeader>
    <CardContent className="flex flex-col gap-3">{dragging && <p id={`drop-status-${stage.id}`} className="text-xs text-muted-foreground">{disabled ? "Destino no permitido para este movimiento." : "Suelta aquí para solicitar el movimiento."}</p>}{children}</CardContent>
  </Card>;
}
export function BoardColumns({ board, pending, locked, notices, onMove, onDetail, onDisposition }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = board.participations.find(item => item.id === activeId);
  const targets = active ? allowedMoveTargets(board, active) : [];
  const suppressClick = useRef(false);
  const keyboard = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor));
  const collision: CollisionDetection = args => keyboard.current ? closestCorners(args) : pointerWithin(args);
  const finish = () => { setActiveId(null); window.setTimeout(() => { suppressClick.current = false; }, 0); };
  function end(event: DragEndEvent) {
    finish();
    if (event.over) onMove(String(event.active.id), String(event.over.id));
  }
  return <DndContext id="movement-board" sensors={sensors} collisionDetection={collision}
    onDragStart={event => { suppressClick.current = true; keyboard.current = event.activatorEvent.type === "keydown"; setActiveId(String(event.active.id)); }}
    onDragEnd={end} onDragCancel={finish}
    accessibility={{ screenReaderInstructions: { draggable: "Presiona espacio o enter para levantar la tarjeta, usa las flechas para elegir una etapa y espacio o enter para soltarla. Escape cancela. También puedes usar el menú Mover a…." },
      announcements: {
        onDragStart: ({ active }) => `Levantaste la tarjeta de ${board.participations.find(item => item.id === active.id)?.candidate.full_name ?? "candidato"}.`,
        onDragOver: ({ over }) => over ? `Sobre ${board.stages.find(stage => stage.id === over.id)?.name ?? "la etapa"}.` : "Fuera de las etapas permitidas.",
        onDragEnd: ({ over }) => over ? "Movimiento solicitado. Espera la confirmación del servidor." : "No se movió la tarjeta.",
        onDragCancel: () => "Movimiento cancelado. No cambió la etapa.",
      } }}>
    <div role="region" aria-label="Columnas del pipeline" tabIndex={0} className="overflow-x-auto pb-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/30">
      <div className="grid auto-cols-[minmax(18rem,22rem)] grid-flow-col items-start gap-4">
        {[...board.stages, board.exit].map(stage => {
          const items = board.participations.filter(item => item.stage_id === stage.id);
          return <Column key={stage.id} stage={stage} dragging={!!active} disabled={locked || !targets.some(target => target.id === stage.id)}>
            {items.length ? <ul className="flex flex-col gap-3">{items.map(item => <li key={item.id}>
              <CandidateCard item={item} targets={allowedMoveTargets(board, item)} disabled={locked || pending.has(item.id)}
                pending={pending.has(item.id)} notice={notices[item.id]} onMove={onMove} onDetail={onDetail} onDisposition={onDisposition} suppressClick={suppressClick} />
            </li>)}</ul> : <Empty><EmptyHeader><EmptyMedia variant="icon"><GitBranch aria-hidden="true" /></EmptyMedia><EmptyTitle>Sin candidatos todavía</EmptyTitle><EmptyDescription>Los candidatos de esta etapa aparecerán aquí.</EmptyDescription></EmptyHeader></Empty>}
          </Column>;
        })}
      </div>
    </div>
    <DragOverlay dropAnimation={null} aria-hidden="true">{active && <Card size="sm"><CardHeader><CardTitle>{active.candidate.full_name}</CardTitle></CardHeader></Card>}</DragOverlay>
  </DndContext>;
}
