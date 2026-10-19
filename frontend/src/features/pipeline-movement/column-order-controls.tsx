import { ArrowLeft, ArrowRight, Ellipsis, GripVertical, LockKeyhole } from "lucide-react";
import type { useDraggable } from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { canMove } from "@/features/jobs/drafts/pipeline/editor-model";
import type { BoardColumnOrder } from "./use-board-column-order";
import type { Board } from "./model";
import { Hint } from "./pipeline-presentation";

export function ColumnOrderControls({ stage, order, drag }: {
  stage: Board["stages"][number] | Board["exit"]; order: BoardColumnOrder; drag: ReturnType<typeof useDraggable>;
}) {
  if (stage.kind === "discarded") return null;
  if (stage.kind === "new" || stage.kind === "placement") return <Hint text="Posición fija"><span tabIndex={0} aria-label={`${stage.name}: posición fija`} className="ml-auto flex size-10 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"><LockKeyhole aria-hidden="true" className="size-3.5" /></span></Hint>;
  if (!order.editor) return null;
  const index = order.editor.stages.findIndex(item => item.id === stage.id);
  const describedBy = order.notice ? "column-order-status" : undefined;
  return <div className="ml-auto flex shrink-0 items-center opacity-100 sm:opacity-0 sm:group-hover/column:opacity-100 sm:group-focus-within/column:opacity-100">
    <Button type="button" variant="ghost" size="icon" className="size-10 cursor-grab touch-none active:cursor-grabbing focus-visible:opacity-100 motion-reduce:transition-none"
      ref={drag.setActivatorNodeRef} {...drag.attributes} {...drag.listeners} disabled={order.locked} aria-label={`Reordenar ${stage.name}`} aria-describedby={[drag.attributes["aria-describedby"], describedBy].filter(Boolean).join(" ") || undefined} id={`column-drag-${stage.id}`}><GripVertical aria-hidden="true" /></Button>
    <DropdownMenu><DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" className="size-10" disabled={order.locked} aria-label={`Orden de ${stage.name}`} aria-describedby={describedBy} id={`column-menu-${stage.id}`} />}><Ellipsis aria-hidden="true" /></DropdownMenuTrigger>
      <DropdownMenuContent align="end"><DropdownMenuGroup>
        <DropdownMenuItem className="min-h-10" disabled={order.locked || !canMove(order.editor, stage.id, "up")} onClick={() => void order.move(stage.id, index - 1)}><ArrowLeft aria-hidden="true" />Mover a la izquierda</DropdownMenuItem>
        <DropdownMenuItem className="min-h-10" disabled={order.locked || !canMove(order.editor, stage.id, "down")} onClick={() => void order.move(stage.id, index + 1)}><ArrowRight aria-hidden="true" />Mover a la derecha</DropdownMenuItem>
      </DropdownMenuGroup></DropdownMenuContent>
    </DropdownMenu>
  </div>;
}
