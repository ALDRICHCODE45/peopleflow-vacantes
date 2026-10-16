import { useCallback } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { cn } from "cn";
import { ArrowDown, ArrowUp, Ellipsis, GripVertical, ListChecks, Lock, LogOut, Trash2 } from "lucide-react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
export type StageRowAction = { id: "up" | "down" | "remove" | "substates"; label: string; disabled: boolean };

/** Items of a movable row's actions menu; "remove" only exists for custom stages. */
export function stageRowActions(state: PipelineEditorState, key: string, cutoffStageId: string | null = null): StageRowAction[] {
  const actions: StageRowAction[] = [
    { id: "up", label: "Subir", disabled: !canMove(state, key, "up") },
    { id: "down", label: "Bajar", disabled: !canMove(state, key, "down") },
  ];
  if (state.stages.some(stage => stage.key === key && stage.kind === "in_process")) {
    actions.push({ id: "substates", label: "Subestados", disabled: false });
  }
  if (canRemoveStage(state, key)) actions.push({ id: "remove", label: "Quitar columna", disabled: cutoffStageId !== null && state.stages.some(stage => stage.key === key && stage.id === cutoffStageId) });
  return actions;
}
const ACTION_ICONS = { up: ArrowUp, down: ArrowDown, remove: Trash2, substates: ListChecks } as const;

export function StageKindBadge({ kind }: { kind: StageKind }) {
  return <Badge variant={STAGE_VARIANTS[kind]}>{STAGE_KIND_LABELS[kind]}</Badge>;
}
export function StageRow({ stage, position, state, error, disabled, inputRef, onRename, onBlur, onMove, onRemove, substateCount, onSubstates, cutoffStageId, cutoffError }:  {
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
  cutoffStageId?: string | null;
  cutoffError?: boolean;
  substateCount?: number;
  onSubstates?: () => void;
}) {
  const id = `pipeline-stage-${stage.key}`;
  const message = cutoffError ? "Esta columna es el corte de entrega. Cámbiala en Entrega antes de quitarla." : nameError(error, state.limits.nameMaxLength);
  const fixed = stage.kind === "new" || stage.kind === "placement";
  const isExit = stage.kind === "discarded";
  const showKind = stage.kind === "custom" || normalizeStageName(stage.name) !== STAGE_KIND_LABELS[stage.kind];
  const { attributes, listeners, setNodeRef: setDragRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: stage.key, disabled: disabled || fixed || isExit, attributes: { roleDescription: "Columna del pipeline" },
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: stage.key, disabled: disabled || isExit });
  const actions = stageRowActions(state, stage.key, cutoffStageId);
  const item = (action: StageRowAction) => {
    const Icon = ACTION_ICONS[action.id];
    const remove = action.id === "remove";
    return (
      <DropdownMenuItem key={action.id} className="min-h-10" variant={remove ? "destructive" : "default"} disabled={action.disabled}
        onClick={() => { if (action.id === "remove") onRemove(); else if (action.id === "substates") onSubstates?.(); else onMove(action.id); }}>
        <Icon aria-hidden="true" />{action.label}
      </DropdownMenuItem>
    );
  };
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
        {(showKind || stage.kind === "in_process" || (cutoffStageId != null && stage.id === cutoffStageId)) && <div className="flex flex-wrap gap-2">
          {cutoffStageId != null && stage.id === cutoffStageId && <Badge variant="info">Corte de entrega</Badge>}
          {showKind && <StageKindBadge kind={stage.kind} />}
          {stage.kind === "in_process" && <Badge variant="neutral">{!substateCount ? "Sin subestados" : substateCount === 1 ? "1 subestado" : `${substateCount} subestados`}</Badge>}
        </div>}
      </ItemContent>
      {!isExit && <ItemActions className="flex-wrap">
        {fixed ? <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Lock className="size-3.5" aria-hidden="true" />Posición fija</span> : (
          // Moving and removing are peer actions of one row, so they share one menu (rules §6).
          <DropdownMenu>
            <DropdownMenuTrigger disabled={disabled} render={<Button type="button" variant="ghost" size="icon" className="size-10" aria-label={`Acciones de ${stage.name}`} />}>
              <Ellipsis aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuGroup>{actions.filter(action => action.id === "up" || action.id === "down").map(item)}</DropdownMenuGroup>
              {actions.some(action => action.id === "substates" || action.id === "remove") && <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>{actions.filter(action => action.id === "substates" || action.id === "remove").map(item)}</DropdownMenuGroup>
              </>}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </ItemActions>}
    </Item>
  );
}
