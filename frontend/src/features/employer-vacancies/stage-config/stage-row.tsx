import { useCallback } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { cn } from "cn";
import { ChevronDown, ChevronUp, GripVertical, Lock, LogOut, Trash2 } from "lucide-react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemMedia } from "@/components/ui/item";
import {
  STAGE_KIND_LABELS, canMove, canRemoveStage, normalizeStageName,
  type EditorError, type EditorExit, type EditorStage, type MoveDirection, type PipelineEditorState, type StageKind,
} from "@/features/jobs/drafts/pipeline/editor-model";

import { POSITION_MEDALLION } from "./reorder";

export const STAGE_VARIANTS: Record<StageKind, BadgeVariant> = {
  new: "info", screening: "review", screening_ok: "accent", in_process: "review",
  placement: "success", custom: "neutral", discarded: "danger",
};
function nameError(error: EditorError | undefined, max: number) {
  switch (error) {
    case "required": return "Escribe un nombre para la columna.";
    case "too_long": return `Usa como máximo ${max} caracteres.`;
    case "control_character": return "Quita los caracteres no válidos.";
    case "duplicate": return "Ya hay otra columna con este nombre.";
    default: return undefined;
  }
}
export function StageKindBadge({ kind }: { kind: StageKind }) {
  return <Badge variant={STAGE_VARIANTS[kind]}>{STAGE_KIND_LABELS[kind]}</Badge>;
}
export function StageRow({ stage, position, state, error, disabled, inputRef, onRename, onBlur, onMove, onRemove }: {
  stage: EditorStage | EditorExit;
  position: number;
  state: PipelineEditorState;
  error?: EditorError;
  disabled: boolean;
  inputRef: (node: HTMLInputElement | null) => void;
  onRename: (name: string) => void;
  onBlur: () => void;
  onMove: (direction: MoveDirection) => void;
  onRemove: () => void;
}) {
  const id = `pipeline-stage-${stage.key}`;
  const message = nameError(error, state.limits.nameMaxLength);
  const fixed = stage.kind === "new" || stage.kind === "placement";
  const isExit = stage.kind === "discarded";
  const showKind = stage.kind === "custom" || normalizeStageName(stage.name) !== STAGE_KIND_LABELS[stage.kind];
  const { attributes, listeners, setNodeRef: setDragRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: stage.key, disabled: disabled || fixed || isExit, attributes: { roleDescription: "Columna del pipeline" },
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: stage.key, disabled: disabled || isExit });
  const setRowRef = useCallback((node: HTMLElement | null) => {
    setDragRef(node); setDropRef(node);
  }, [setDragRef, setDropRef]);
  return (
    <Item ref={setRowRef} render={isExit ? <div /> : <li />} variant="outline"
      className={cn(isDragging && "opacity-60", isOver && "ring-2 ring-ring")}>
      {fixed || isExit
        ? <span data-pf-stage-handle-slot="" aria-hidden="true" className="size-10 shrink-0" />
        : <Button type="button" variant="ghost" size="icon" ref={setActivatorNodeRef}
          className="size-10 shrink-0 cursor-grab touch-none active:cursor-grabbing" disabled={disabled}
          {...attributes} {...listeners} aria-label={`Arrastrar ${stage.name}`}><GripVertical aria-hidden="true" /></Button>}
      <ItemMedia variant="icon" className={POSITION_MEDALLION} aria-hidden="true">
        {isExit ? <LogOut /> : position}
      </ItemMedia>
      <ItemContent className="min-w-40">
        <FieldGroup>
          <Field data-invalid={!!message} data-disabled={disabled}>
            <FieldLabel htmlFor={id} className="sr-only">{isExit ? "Nombre de la columna de salida" : `Nombre de la columna ${position}`}</FieldLabel>
            <Input id={id} ref={inputRef} className="min-h-10" value={stage.name} disabled={disabled}
              onChange={event => onRename(event.target.value)} onBlur={onBlur}
              aria-invalid={!!message} aria-describedby={message ? `${id}-error` : undefined} />
            {message && <FieldError id={`${id}-error`}>{message}</FieldError>}
          </Field>
        </FieldGroup>
        {showKind && <div><StageKindBadge kind={stage.kind} /></div>}
      </ItemContent>
      {!isExit && <ItemActions className="flex-wrap">
        {fixed ? <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Lock className="size-3.5" aria-hidden="true" />Posición fija</span> : <>
          <Button type="button" variant="ghost" size="icon" className="size-10" aria-label={`Subir ${stage.name}`}
            disabled={disabled || !canMove(state, stage.key, "up")} onClick={() => onMove("up")}><ChevronUp aria-hidden="true" /></Button>
          <Button type="button" variant="ghost" size="icon" className="size-10" aria-label={`Bajar ${stage.name}`}
            disabled={disabled || !canMove(state, stage.key, "down")} onClick={() => onMove("down")}><ChevronDown aria-hidden="true" /></Button>
        </>}
        {canRemoveStage(state, stage.key) && <Button type="button" variant="ghost" size="icon" className="size-10" aria-label={`Quitar ${stage.name}`}
          disabled={disabled} onClick={onRemove}><Trash2 aria-hidden="true" /></Button>}
      </ItemActions>}
    </Item>
  );
}
