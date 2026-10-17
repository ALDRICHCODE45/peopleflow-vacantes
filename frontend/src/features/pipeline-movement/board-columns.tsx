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
import { filePresentation, Hint, initials, stageClass } from "./pipeline-presentation";

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
      <CardAction className="row-span-1 self-center"><CandidateMenu item={item} targets={targets} disabled={disabled} pending={pending} describedBy={statusId} onMove={onMove} onDetail={onDetail} onDisposition={onDisposition} /></CardAction>
    </CardHeader>
    <CardContent className="flex flex-col gap-1.5 px-0 text-xs text-muted-foreground">
      <p className="flex items-center gap-2"><CalendarDays aria-hidden="true" className="size-3.5 shrink-0" /><span>Postuló <MovementDate value={item.applied_at} compact /></span></p>
      <p className="flex items-center gap-2"><Clock3 aria-hidden="true" className="size-3.5 shrink-0" /><span>En la etapa desde <MovementDate value={item.moved_at} compact /></span></p>
    </CardContent>
    <Separator />
    <CardFooter className="min-h-6 gap-2 px-0">
      {item.discard ? <div className="flex min-w-0 flex-col items-start gap-2"><Badge variant="danger" className="h-auto whitespace-normal">{discardReasonLabel(item.discard.reason)}</Badge><p className="text-xs text-muted-foreground">{discardGroupLabel(item.discard.reason)}</p></div> : <>
        <Hint text={item.cv.name}><span className="flex min-w-0 items-center gap-1.5 rounded-md bg-muted/60 px-2 py-1 text-xs text-muted-foreground"><FileIcon aria-hidden="true" className="size-3.5 shrink-0" /><span className="truncate">{item.cv.name}</span></span></Hint>
        <Button type="button" variant="ghost" size="icon" className="-my-2 ml-auto size-10 shrink-0 cursor-grab touch-none text-muted-foreground opacity-100 active:cursor-grabbing sm:opacity-0 sm:group-hover/candidate:opacity-100 sm:group-focus-within/candidate:opacity-100 focus-visible:opacity-100"
          ref={setActivatorNodeRef} {...attributes} {...listeners} disabled={disabled} id={`candidate-drag-${item.id}`} aria-label={`Arrastrar ${item.candidate.full_name}`} aria-describedby={statusId}><GripVertical aria-hidden="true" /></Button>
      </>}
    </CardFooter>
    {error && <div className="pf-card-error"><ActionStatus id={`move-status-${item.id}`} tone={error.tone} text={error.text} /></div>}
  </Card>;
}
function Column({ stage, disabled, dragging, children }: { stage: Board["stages"][number] | Board["exit"]; disabled: boolean; dragging: boolean; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id: stage.id, disabled });
  return <section ref={setNodeRef} role="region" aria-label={`${stage.name}: ${stage.count} candidatos`} aria-describedby={dragging ? `drop-status-${stage.id}` : undefined}
    data-drop-disabled={disabled} data-pf-published-column="" className={cn("stage-column w-[284px] shrink-0 snap-start self-start rounded-xl p-2 transition-opacity", stageClass(stage.kind), dragging && (disabled ? "opacity-35" : "outline outline-1 outline-dashed outline-primary"))}>
    <div className="stage-heading mb-3 flex h-10 items-center gap-2 rounded-lg px-3"><span aria-hidden="true" className="stage-dot size-2 shrink-0 rounded-full" /><h3 className="min-w-0 truncate text-[13px] font-semibold" title={stage.name}>{stage.name}</h3><Badge variant="secondary" className="stage-count tabular-nums" aria-label={`${stage.count} candidatos`}>{stage.count}</Badge>
      {stage.kind === "discarded" && <Hint text="Se llega descartando, no moviendo"><span tabIndex={0} aria-label="Se llega descartando, no moviendo" className="ml-auto flex size-8 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"><LockKeyhole aria-hidden="true" className="size-3.5" /></span></Hint>}
    </div>
    {dragging && <p id={`drop-status-${stage.id}`} className="sr-only">{disabled ? "Destino no permitido para este movimiento." : "Suelta aquí para solicitar el movimiento."}</p>}{children}
  </section>;
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
    <ScrollArea role="region" aria-label="Columnas del pipeline" className="pf-board-scroll min-w-0">
      <div className="flex w-max items-start gap-3 px-0.5 pt-0.5 pb-6">
        {[...board.stages, board.exit].map(stage => {
          const items = board.participations.filter(item => item.stage_id === stage.id);
          return <Column key={stage.id} stage={stage} dragging={!!active} disabled={locked || !targets.some(target => target.id === stage.id)}>
            {items.length ? <ul className="flex flex-col gap-3">{items.map(item => <li key={item.id}>
              <CandidateCard item={item} targets={allowedMoveTargets(board, item)} disabled={locked || pending.has(item.id)}
                pending={pending.has(item.id)} notice={notices[item.id]} onMove={onMove} onDetail={onDetail} onDisposition={onDisposition} suppressClick={suppressClick} />
            </li>)}</ul> : <p className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border text-[11px] text-muted-foreground">Sin candidatos en esta etapa</p>}
          </Column>;
        })}
      </div><ScrollBar orientation="horizontal" />
    </ScrollArea>
    <DragOverlay dropAnimation={null} aria-hidden="true">{active && <Card size="sm" className="rounded-xl"><CardHeader><CardTitle>{active.candidate.full_name}</CardTitle></CardHeader></Card>}</DragOverlay>
  </DndContext>;
}
