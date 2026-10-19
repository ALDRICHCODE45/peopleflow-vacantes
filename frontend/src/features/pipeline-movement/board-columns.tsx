"use client";
import { useRef, useState, type RefObject } from "react";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCorners, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent } from "@dnd-kit/core";
import { CalendarDays, Clock3, FileText, FileType2, GripVertical, LockKeyhole } from "lucide-react";
import { cn } from "cn";
import { ActionStatus } from "@/components/feedback/action-status";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { allowedMoveTargets } from "./helpers";
import { discardGroupLabel, discardReasonLabel } from "./discard-text";
import type { Board, Participation } from "./model";
import type { Notice } from "./board-feedback";
import { MovementDate } from "./board-states";
import { CandidateMenu } from "./candidate-menu";
import { isInProcess, matchesSubstateFilter, substateName } from "./substates";
import { filePresentation, Hint, initials, stageClass } from "./pipeline-presentation";
import { canMoveTo } from "@/features/jobs/drafts/pipeline/editor-model";
import type { BoardColumnOrder } from "./use-board-column-order";
import { ColumnOrderControls } from "./column-order-controls";

type Props = {
  board: Board; pending: Set<string>; locked: boolean; notices: Record<string, Notice>; columnOrder?: BoardColumnOrder;
  onMove: (id: string, target: string) => void; onDetail: (id: string) => void;
  onDisposition: (id: string, kind: "discard" | "recover") => void;
  onSubstate?: (id: string, substateId: string | null) => void; substateFilter?: string[];
};
// Draggable board-card exception (§14.3): compact handle/menu anatomy owns its spacing.
function CandidateCard({ item, targets, disabled, pending, notice, onMove, onDetail, onDisposition, onSubstate, board, suppressClick }: {
  item: Participation; targets: Board["stages"]; disabled: boolean; pending: boolean; notice?: Notice;
  onMove: Props["onMove"]; onDetail: Props["onDetail"]; onDisposition: Props["onDisposition"]; onSubstate: Props["onSubstate"]; board: Board; suppressClick: RefObject<boolean>;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: item.id, disabled: disabled || !!item.discard, attributes: { roleDescription: "Tarjeta de candidato" },
  });
  const error = notice && notice.tone !== "success" ? notice : undefined;
  const statusId = error ? `move-status-${item.id}` : undefined;
  const FileIcon = filePresentation(item.cv.name) === "pdf" ? FileText : FileType2;
  return <Card ref={setNodeRef} size="sm" aria-busy={pending} className={cn("pf-candidate-card group/candidate cursor-pointer rounded-xl gap-3 p-3", (isDragging || pending) && "opacity-55")}
    onClick={event => {
      if (suppressClick.current || (event.target as HTMLElement).closest("button,a,[role='menu']")) return;
      onDetail(item.id);
    }}>
    <CardHeader className="items-center gap-2 px-0">
      <div className="flex min-w-0 items-center gap-2">
        <Avatar className="size-8 shrink-0"><AvatarFallback className="bg-secondary text-xs font-medium text-muted-foreground">{initials(item.candidate.full_name)}</AvatarFallback></Avatar>
        <CardTitle className="min-w-0 text-sm font-medium"><Hint text={item.candidate.full_name}><Button type="button" variant="ghost" className="h-auto min-h-10 w-full justify-start whitespace-normal p-0 text-left text-sm font-medium hover:bg-transparent"
          id={`candidate-detail-${item.id}`} aria-label={`Ver detalle de ${item.candidate.full_name}`} onClick={() => onDetail(item.id)}><span className="line-clamp-2 break-words leading-5">{item.candidate.full_name}</span></Button></Hint></CardTitle>
      </div>
      <CardAction className="row-span-1 self-center"><CandidateMenu item={item} targets={targets} disabled={disabled} pending={pending} describedBy={statusId} onMove={onMove} onDetail={onDetail} onDisposition={onDisposition} onSubstate={isInProcess(board, item) ? onSubstate : undefined} substates={board.substates} /></CardAction>
    </CardHeader>
    <CardContent className="flex flex-col gap-1.5 px-0 text-xs text-muted-foreground">
      {isInProcess(board, item) && item.substate_id !== null && <Badge variant="secondary" className="max-w-full" title={substateName(board, item.substate_id)}><span className="truncate">{substateName(board, item.substate_id)}</span></Badge>}
      <p className="flex items-center gap-2"><CalendarDays aria-hidden="true" className="size-3.5 shrink-0" /><span>Postuló <MovementDate value={item.applied_at} compact /></span></p>
      <p className="flex items-center gap-2"><Clock3 aria-hidden="true" className="size-3.5 shrink-0" /><span>En la etapa desde <MovementDate value={item.moved_at} compact /></span></p>
    </CardContent>
    <Separator />
    <CardFooter className="min-h-6 gap-2 px-0">
      {item.discard ? <div className="flex min-w-0 flex-col items-start gap-2"><Badge variant="danger" className="h-auto whitespace-normal">{discardReasonLabel(item.discard.reason)}</Badge><p className="text-xs text-muted-foreground">{discardGroupLabel(item.discard.reason)}</p></div> : <>
        <Hint text={item.cv.name}><span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"><FileIcon aria-hidden="true" className="size-3.5 shrink-0" /><span className="truncate">{item.cv.name}</span></span></Hint>
        <Button type="button" variant="ghost" size="icon" className="-my-2 ml-auto size-10 shrink-0 cursor-grab touch-none text-muted-foreground opacity-100 active:cursor-grabbing sm:opacity-0 sm:group-hover/candidate:opacity-100 sm:group-focus-within/candidate:opacity-100 focus-visible:opacity-100"
          ref={setActivatorNodeRef} {...attributes} {...listeners} disabled={disabled} id={`candidate-drag-${item.id}`} aria-label={`Arrastrar ${item.candidate.full_name}`} aria-describedby={statusId}><GripVertical aria-hidden="true" /></Button>
      </>}
    </CardFooter>
    {error && <div className="pf-card-error"><ActionStatus id={`move-status-${item.id}`} tone={error.tone} text={error.text} /></div>}
  </Card>;
}
function Column({ stage, countLabel = String(stage.count), disabled, dragging, children, order, lifted, insertion }: { stage: Board["stages"][number] | Board["exit"]; disabled: boolean; dragging: boolean; children: React.ReactNode; countLabel?: string; order?: BoardColumnOrder; lifted: boolean; insertion: "left" | "right" | null }) {
  const { setNodeRef } = useDroppable({ id: stage.id, disabled });
  const drag = useDraggable({ id: stage.id, disabled: !order || order.locked || stage.kind === "new" || stage.kind === "placement" || stage.kind === "discarded", data: { type: "column" }, attributes: { roleDescription: "Columna del pipeline" } });
  return <section ref={node => { setNodeRef(node); drag.setNodeRef(node); }} role="region" aria-label={`${stage.name}: ${countLabel} candidatos`} aria-describedby={dragging ? `drop-status-${stage.id}` : undefined}
    data-drop-disabled={disabled} data-pf-published-column="" className={cn("stage-column group/column relative flex min-h-[420px] w-[284px] shrink-0 snap-start flex-col rounded-xl p-2 transition-opacity motion-reduce:transition-none", stageClass(stage.kind), dragging && (disabled ? "opacity-35" : "outline outline-1 outline-dashed outline-primary"), lifted && "opacity-55", insertion && "before:absolute before:inset-y-0 before:w-1 before:rounded-full before:bg-primary", insertion === "left" && "before:-left-2", insertion === "right" && "before:-right-2")}>
    {insertion && <span className="sr-only">Insertar {insertion === "left" ? "antes" : "después"} de {stage.name}</span>}
    <div className="stage-heading mb-3 flex h-10 shrink-0 items-center gap-2 rounded-lg px-2"><span aria-hidden="true" className="stage-dot size-2 shrink-0 rounded-full" /><h3 className="min-w-0 truncate text-[13px] font-semibold" title={stage.name}>{stage.name}</h3><Badge variant="secondary" className="stage-count tabular-nums" aria-label={`${countLabel} candidatos`}>{countLabel}</Badge>
      {order && <ColumnOrderControls stage={stage} order={order} drag={drag} />}
      {stage.kind === "discarded" && <Hint text="Se llega descartando, no moviendo"><span tabIndex={0} aria-label="Se llega descartando, no moviendo" className="ml-auto flex size-8 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"><LockKeyhole aria-hidden="true" className="size-3.5" /></span></Hint>}
    </div>
    {dragging && <p id={`drop-status-${stage.id}`} className="sr-only">{disabled ? "Destino no permitido para este movimiento." : "Suelta aquí para solicitar el movimiento."}</p>}
    <ScrollArea role="region" aria-label={`Candidatos en ${stage.name}`} className="pf-column-scroll min-h-0 flex-1">
      <div className="p-0.5 pr-3">{children}</div>
    </ScrollArea>
  </section>;
}
export function BoardColumns({ board, pending, locked, notices, onMove, onDetail, onDisposition, onSubstate, substateFilter = [], columnOrder }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [columnId, setColumnId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const activeColumn = board.stages.find(stage => stage.id === columnId);
  const columnIndex = (id: string) => columnOrder?.editor?.stages.findIndex(stage => stage.key === id) ?? -1;
  const canDropColumn = (id: string) => !!columnId && !!columnOrder?.editor && !columnOrder.locked && canMoveTo(columnOrder.editor, columnId, columnIndex(id));
  const active = board.participations.find(item => item.id === activeId);
  const targets = active ? allowedMoveTargets(board, active) : [];
  const suppressClick = useRef(false);
  const keyboard = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor));
  const collision: CollisionDetection = args => keyboard.current ? closestCorners(args) : pointerWithin(args);
  const finish = () => { setActiveId(null); setColumnId(null); setOverId(null); window.setTimeout(() => { suppressClick.current = false; }, 0); };
  function end(event: DragEndEvent) {
    finish();
    if (!event.over) return;
    if (event.active.data?.current?.type === "column") void columnOrder?.move(String(event.active.id), columnIndex(String(event.over.id)));
    else onMove(String(event.active.id), String(event.over.id));
  }
  return <DndContext id="movement-board" sensors={sensors} collisionDetection={collision}
    onDragStart={event => { suppressClick.current = true; keyboard.current = event.activatorEvent.type === "keydown"; if (event.active.data?.current?.type === "column") setColumnId(String(event.active.id)); else setActiveId(String(event.active.id)); }}
    onDragOver={({ over }) => setOverId(over ? String(over.id) : null)}
    onDragEnd={end} onDragCancel={finish}
    accessibility={{ screenReaderInstructions: { draggable: "Presiona espacio o enter para levantar, usa las flechas para elegir destino y espacio o enter para soltar. Escape cancela. Para columnas también puedes usar el menú Orden de columna: Mover a la izquierda o Mover a la derecha. Para tarjetas usa el menú Mover a…." },
      announcements: {
        onDragStart: ({ active }) => active.data?.current?.type === "column" ? `Tomaste la columna ${board.stages.find(stage => stage.id === active.id)?.name}.` : `Levantaste la tarjeta de ${board.participations.find(item => item.id === active.id)?.candidate.full_name ?? "candidato"}.`,
        onDragOver: ({ over }) => over ? `Sobre ${board.stages.find(stage => stage.id === over.id)?.name ?? "la etapa"}.` : "Fuera de las etapas permitidas.",
        onDragEnd: ({ active, over }) => active.data?.current?.type === "column" ? "Arrastre terminado. Revisa el resultado del orden de columnas." : over ? "Movimiento solicitado. Espera la confirmación del servidor." : "No se movió la tarjeta.",
        onDragCancel: () => "Movimiento cancelado. No cambió la etapa.",
      } }}>
    <ScrollArea role="region" aria-label="Columnas del pipeline" className="pf-board-scroll h-[min(70dvh,640px)] min-h-[448px] min-w-0 md:h-auto md:min-h-0 md:flex-1">
      <div data-pf-board-track="" className="flex h-full min-h-[448px] w-max items-stretch gap-3 px-0.5 pt-0.5 pb-6">
        {[...board.stages, board.exit].map(stage => {
          const allItems = board.participations.filter(item => item.stage_id === stage.id);
          const items = allItems.filter(item => matchesSubstateFilter(board, item, substateFilter));
          const countLabel = substateFilter.length ? `${items.length} de ${allItems.length}` : String(stage.count);
          return <Column key={stage.id} stage={stage} countLabel={countLabel} order={columnOrder} lifted={columnId === stage.id} insertion={overId === stage.id && canDropColumn(stage.id) ? (columnIndex(columnId!) < columnIndex(stage.id) ? "right" : "left") : null} dragging={!!active} disabled={columnId ? !canDropColumn(stage.id) : locked || !targets.some(target => target.id === stage.id)}>
            {items.length ? <ul className="flex flex-col gap-3">{items.map(item => <li key={item.id}>
              <CandidateCard item={item} board={board} onSubstate={onSubstate} targets={allowedMoveTargets(board, item)} disabled={locked || pending.has(item.id)}
                pending={pending.has(item.id)} notice={notices[item.id]} onMove={onMove} onDetail={onDetail} onDisposition={onDisposition} suppressClick={suppressClick} />
            </li>)}</ul> : <p className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border text-[11px] text-muted-foreground">{substateFilter.length ? "Ningún candidato coincide con el filtro" : "Sin candidatos en esta etapa"}</p>}
          </Column>;
        })}
      </div><ScrollBar orientation="horizontal" />
    </ScrollArea>
    {/* Draggable board-card exception: the non-interactive overlay carries only the lifted identity. */}
    <DragOverlay dropAnimation={null} aria-hidden="true">{activeColumn && <div className={cn("stage-column flex min-h-[420px] w-[284px] flex-col rounded-xl p-2 opacity-95 shadow-xl", stageClass(activeColumn.kind))}><div className="stage-heading flex h-10 items-center gap-2 rounded-lg px-3"><GripVertical aria-hidden="true" className="size-4" /><span className="truncate text-[13px] font-semibold">{activeColumn.name}</span></div></div>}{active && <Card size="sm" className="rounded-xl"><CardHeader><CardTitle>{active.candidate.full_name}</CardTitle></CardHeader></Card>}</DragOverlay>
  </DndContext>;
}
