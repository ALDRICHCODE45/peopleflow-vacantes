import { useCallback } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { cn } from "cn";
import { ArrowDown, ArrowUp, Ellipsis, GripVertical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemMedia } from "@/components/ui/item";
import { canMove, type SubstateEntry, type SubstateError, type SubstatesEditorState } from "@/features/jobs/drafts/pipeline/substates-model";
import type { MoveDirection } from "@/features/jobs/drafts/pipeline/editor-model";
import { POSITION_MEDALLION } from "../stage-config/reorder";

type RowAction = { id: "up" | "down" | "remove"; label: string; disabled: boolean };
/** Menu contract is pure so it can be tested independently of the floating portal. */
export function substateRowActions(state: SubstatesEditorState, key: string): RowAction[] {
  return [
    { id: "up", label: "Subir", disabled: !canMove(state, key, "up") },
    { id: "down", label: "Bajar", disabled: !canMove(state, key, "down") },
    { id: "remove", label: "Quitar subestado", disabled: !state.entries.some(entry => entry.key === key && !entry.in_use) },
  ];
}
const icons = { up: ArrowUp, down: ArrowDown, remove: Trash2 };
function nameError(error: SubstateError | undefined, max: number) {
  switch (error) {
    case "required": return "Escribe un nombre para el subestado.";
    case "too_long": return `Usa como máximo ${max} caracteres.`;
    case "control_character": return "Quita los caracteres no válidos.";
    case "duplicate": return "Ya hay otro subestado con este nombre.";
    default: return undefined;
  }
}
export function SubstateRow({ entry, position, state, error, disabled, inputRef, onRename, onBlur, onMove, onRemove }: {
  entry: SubstateEntry; position: number; state: SubstatesEditorState; error?: SubstateError; disabled: boolean;
  inputRef: (node: HTMLInputElement | null) => void; onRename: (name: string) => void; onBlur: () => void;
  onMove: (direction: MoveDirection) => void; onRemove: () => void;
}) {
  const id = `pipeline-substate-${entry.key}`;
  const message = nameError(error, state.limits.nameMaxLength);
  const inUseCopy = "Tiene candidatos asignados. Reasígnalos para quitarlo.";
  const invalid = !!message || !!entry.blocked;
  const { attributes, listeners, setNodeRef: setDragRef, setActivatorNodeRef, isDragging } = useDraggable({ id: entry.key, disabled, attributes: { roleDescription: "Subestado" } });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: entry.key, disabled });
  const setRowRef = useCallback((node: HTMLElement | null) => { setDragRef(node); setDropRef(node); }, [setDragRef, setDropRef]);
  const actions = substateRowActions(state, entry.key);
  const item = (action: RowAction) => {
    const Icon = icons[action.id];
    return <DropdownMenuItem key={action.id} className="min-h-10" disabled={action.disabled} variant={action.id === "remove" ? "destructive" : "default"}
      onClick={() => { if (action.id === "remove") onRemove(); else onMove(action.id); }}><Icon aria-hidden="true" />{action.label}</DropdownMenuItem>;
  };
  return <Item ref={setRowRef} render={<li />} variant="outline" size="xs" className={cn("flex-nowrap", isDragging && "opacity-60", isOver && "ring-2 ring-ring")}>
    <Button type="button" variant="ghost" size="icon" className="size-10 shrink-0 cursor-grab touch-none active:cursor-grabbing" ref={setActivatorNodeRef}
      disabled={disabled} {...attributes} {...listeners} aria-label={`Arrastrar ${entry.name}`}><GripVertical aria-hidden="true" /></Button>
    <ItemMedia variant="icon" className={POSITION_MEDALLION} aria-hidden="true">{position}</ItemMedia>
    <ItemContent className="min-w-0">
      <FieldGroup><Field data-invalid={invalid} data-disabled={disabled}>
        <FieldLabel htmlFor={id} className="sr-only">Nombre del subestado {position}</FieldLabel>
        <Input id={id} ref={inputRef} className="min-h-10" value={entry.name} disabled={disabled} onChange={event => onRename(event.target.value)} onBlur={onBlur}
          aria-invalid={invalid} aria-describedby={[message && `${id}-error`, entry.in_use && `${id}-in-use`].filter(Boolean).join(" ") || undefined} />
        {message && <FieldError id={`${id}-error`}>{message}</FieldError>}
        {entry.in_use && (entry.blocked ? <FieldError id={`${id}-in-use`}>{inUseCopy}</FieldError> : <FieldDescription id={`${id}-in-use`}>{inUseCopy}</FieldDescription>)}
      </Field></FieldGroup>
    </ItemContent>
    <ItemActions><DropdownMenu>
      <DropdownMenuTrigger disabled={disabled} render={<Button type="button" variant="ghost" size="icon" className="size-10" aria-label={`Acciones de ${entry.name}`} />}><Ellipsis aria-hidden="true" /></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuGroup>{actions.filter(action => action.id !== "remove").map(item)}</DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>{actions.filter(action => action.id === "remove").map(item)}</DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu></ItemActions>
  </Item>;
}
