"use client";

import { useId, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { ArrowDown, ArrowUp, Ban, Copy, Ellipsis, EyeOff, GripVertical, Lock, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { BLOCK_LIBRARY, BLOCK_LIBRARY_V2 } from "../defaults";
import { addBlockAction, duplicateBlockAction, type EditorState } from "../editor-state";
import type { AutosaveController } from "../autosave";
import { publishIssuesV2, type BlockType, type BlockTypeV2, type SiteBlockV2 } from "../model";
import { VARIANT_LABELS } from "./variant-picker";
import { SECTION_ICONS } from "./section-icons";
import { missingContent } from "./section-completion";
import { dragMessages, positionText, sectionPlacementError } from "./dnd/reorder";
import { useReportSectionDragPreview } from "./dnd/section-drag-preview";
import { DRAG_ROW_MOTION, SortableList, useListDrag, type DragSession } from "./dnd/use-list-drag";

export { SECTION_ICONS } from "./section-icons";
const protectedBlock = (block: SiteBlockV2) => block.type === "hero" || block.type === "jobs";
type ListProps = {
  editor: EditorState; controller: AutosaveController; onSelect: (id: string) => void; onDelete: (block: SiteBlockV2) => void; onAdd: () => void;
  /** One call per committed drag (pointer, touch or keyboard) with the final index; never for a no-op, a forbidden spot or a cancel. */
  onReorder: (id: string, toIndex: number) => void;
};
type Drag = ReturnType<typeof useListDrag>;
const INSTRUCTIONS = "Para mover una sección, pulsa Espacio o Enter en su manija, usa las flechas arriba y abajo y vuelve a pulsar Espacio o Enter para soltarla; Escape cancela. También puedes usar Subir y Bajar en el menú de acciones.";

/** The section's identity: a tinted 32 px tile with its own glyph. */
export function SectionTile({ type, selected }: { type: BlockTypeV2; selected?: boolean }) {
  const Icon = SECTION_ICONS[type];
  return <span data-section-type-icon="" className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary-text transition-colors duration-150 motion-reduce:transition-none dark:bg-primary-text/15", selected && "bg-selection text-selection-foreground dark:bg-selection")}>
    <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
  </span>;
}
function BlockedHint({ reason }: { reason: string }) {
  return <span className="flex min-w-0 items-center gap-1 text-xs font-medium text-destructive"><Ban className="size-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{reason}</span></span>;
}
function SectionRow({ block, index, incomplete, drag, ...props }: Omit<ListProps, "onAdd"> & { block: SiteBlockV2; index: number; incomplete: boolean; drag: Drag }) {
  // What «Incompleta» means for this section, e.g. «Falta: al menos 1 persona con permiso».
  const hint = incomplete ? missingContent(block, props.editor.draft.blocks)?.hint ?? "Falta información para publicar" : null;
  const hintId = useId();
  const { editor, controller, onSelect, onDelete, onReorder } = props;
  const label = BLOCK_LIBRARY_V2[block.type].label;
  const blocks = editor.draft.blocks; const count = blocks.length;
  // Subir/Bajar and Alt+arrows: one step through the same rule and reorder as a drag.
  const stepReason = (to: number) => to < 0 || to >= count ? null : sectionPlacementError(blocks, block.id, to);
  const [upReason, downReason] = [stepReason(index - 1), stepReason(index + 1)];
  const canUp = index > 0 && !upReason; const canDown = index < count - 1 && !downReason;
  const ruleReason = upReason ?? downReason; const reasonId = useId();
  function step(direction: -1 | 1) {
    const to = index + direction;
    if (to < 0 || to >= count) return drag.announce(`${label} ya es la ${direction < 0 ? "primera" : "última"} sección.`);
    const reason = stepReason(to);
    if (reason) return drag.announce(dragMessages.end("blocked", label, index, to, count, reason));
    onReorder(block.id, to); drag.announce(positionText(label, to, count));
  }
  const draggable = useDraggable({ id: block.id, attributes: { roleDescription: "manija de arrastre" } });
  const { ref: rowRef, ...rowAttrs } = drag.rowProps(block.id);
  const { ref: gripRef, ...grip } = drag.gripProps(block.id);
  const switchId = useId(); const required = protectedBlock(block);
  const selected = editor.selectedId === block.id;
  const blocked = drag.session?.id === block.id ? drag.session.blocked : null;
  return <Item role="listitem" size="xs" ref={node => { draggable.setNodeRef(node); rowRef(node); }} {...rowAttrs} data-selected={selected || undefined}
    className={cn("relative flex-nowrap pl-3.5", DRAG_ROW_MOTION, selected && "bg-card shadow-sm ring-1 ring-primary/40 dark:shadow-none dark:ring-primary-text/50",
      // Pointer drag: the row stays as a dashed placeholder at its landing slot; the overlay carries the copy.
      "data-[drag=placeholder]:border-dashed data-[drag=placeholder]:border-primary/50 data-[drag=placeholder]:bg-primary/5 data-[drag=placeholder]:shadow-none data-[drag=placeholder]:ring-0 data-[drag=placeholder]:*:opacity-0",
      // Keyboard drag: the row itself is lifted and travels to its landing slot.
      "data-[drag=lifted]:z-10 data-[drag=lifted]:bg-card data-[drag=lifted]:shadow-lg data-[drag=lifted]:ring-2 data-[drag=lifted]:ring-primary dark:data-[drag=lifted]:ring-primary-text",
      "data-drag-blocked:border-destructive/60 data-drag-blocked:bg-destructive/5 data-[drag=lifted]:data-drag-blocked:ring-destructive")}>
    {/* Stretched native hit area: hover and focus-visible belong to the whole
        Item, with no inner pill. Drag/menu remain independent sibling controls. */}
    <Button variant="ghost" className="absolute inset-0 size-full" aria-label={`Seleccionar ${label}`} aria-pressed={selected} title={hint ?? undefined} aria-describedby={hint ? hintId : undefined} onClick={() => onSelect(block.id)} onKeyDown={event => {
      if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) { event.preventDefault(); step(event.key === "ArrowUp" ? -1 : 1); }
    }} />
    {/* Quiet handle laid over the row's left padding, so it never takes width
        from the title: shown on hover, focus, selection, while dragging and always
        on coarse pointers; it stays a real, named, focusable 24 × 40 control. */}
    <Button variant="ghost" size="icon" ref={node => { draggable.setActivatorNodeRef(node); gripRef(node); }} {...draggable.listeners} {...draggable.attributes} {...grip} aria-label={`Arrastrar ${label}`}
      className={cn("absolute inset-y-0 -left-1 z-10 my-auto h-10 w-6 cursor-grab touch-manipulation rounded-lg text-muted-foreground opacity-0 select-none [-webkit-touch-callout:none] transition-opacity duration-150 group-hover/item:opacity-100 group-focus-within/item:opacity-100 hover:bg-transparent hover:text-foreground focus-visible:opacity-100 active:cursor-grabbing motion-reduce:transition-none pointer-coarse:opacity-100", (selected || grip["aria-pressed"]) && "opacity-100")}>
      <GripVertical aria-hidden="true" />
    </Button>
    <div className="flex w-full min-w-0 items-center gap-2">
      <ItemContent className="pointer-events-none relative min-w-0 overflow-hidden">
        <div data-section-identity="" className="flex min-w-0 flex-row items-center gap-2">
          <SectionTile type={block.type} selected={selected} />
          <div data-section-copy="" className="flex min-w-0 flex-1 flex-col gap-0.5">
            {/* Wraps to a second line rather than cutting «Misión y valores» short. */}
            <ItemTitle title={label} className="line-clamp-2 w-auto whitespace-normal">{label}</ItemTitle>
            {blocked ? <BlockedHint reason={blocked} /> : <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
              <span className="min-w-0 truncate">{VARIANT_LABELS[block.variant]}</span>
              <span data-section-indicators="" className="flex shrink-0 items-center gap-1">
                {required && <Badge variant="neutral" title="Fija: siempre forma parte de tu sitio" className="h-[18px] px-1.5"><Lock role="img" aria-label="Sección obligatoria" /><span aria-hidden="true">Fija</span></Badge>}
                {block.hidden && <Badge variant="neutral" className="h-[18px] px-1.5"><EyeOff aria-hidden="true" />Oculta</Badge>}
                {incomplete && <Badge variant="review" dot className="h-[18px] px-1.5">Incompleta<span id={hintId} className="sr-only">{`. ${hint}`}</span></Badge>}
              </span>
            </div>}
          </div>
        </div>
      </ItemContent>
      <ItemActions className="relative"><DropdownMenu><div className="relative h-10 w-8"><DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="absolute top-0 left-0 size-10" />} aria-label={`Acciones de ${label}`}><Ellipsis aria-hidden="true" /></DropdownMenuTrigger></div>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuGroup>
            <DropdownMenuItem className="min-h-10" disabled={!canUp} aria-describedby={upReason ? reasonId : undefined} onClick={() => step(-1)}><ArrowUp aria-hidden="true" />Subir</DropdownMenuItem>
            <DropdownMenuItem className="min-h-10" disabled={!canDown} aria-describedby={downReason ? reasonId : undefined} onClick={() => step(1)}><ArrowDown aria-hidden="true" />Bajar</DropdownMenuItem>
            {ruleReason && <p id={reasonId} className="px-2 pb-1 text-xs text-muted-foreground">{ruleReason}</p>}
            <DropdownMenuItem className="min-h-10" disabled={required || editor.draft.blocks.length >= 30} onClick={() => { const action = duplicateBlockAction(editor, block.id); if (action.type === "duplicate") controller.dispatch(action); }}><Copy aria-hidden="true" />Duplicar</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <Field orientation="horizontal" data-disabled={required} className="px-2"><FieldLabel htmlFor={switchId}>Mostrar {label}</FieldLabel><Switch id={switchId} checked={!block.hidden} disabled={required} onCheckedChange={checked => controller.dispatch({ type: "hidden", id: block.id, hidden: !checked })} /></Field>
          {required && <p className="px-2 text-xs text-muted-foreground">Siempre visible en tu sitio.</p>}
          <DropdownMenuSeparator />
          <DropdownMenuGroup><DropdownMenuItem className="min-h-10" variant="destructive" disabled={required} onClick={() => onDelete(block)}><Trash2 aria-hidden="true" />Eliminar</DropdownMenuItem></DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu></ItemActions>
    </div>
  </Item>;
}
/** Floating copy that follows the pointer; it names a forbidden or outside drop. */
function SectionOverlay({ block, session }: { block: SiteBlockV2; session: DragSession }) {
  const label = BLOCK_LIBRARY_V2[block.type].label; const refused = session.blocked ?? (session.outside ? "Suelta dentro de la lista para moverla." : null);
  return <div data-drag-overlay="" className={cn("relative flex size-full cursor-grabbing items-center gap-2 rounded-2xl border border-transparent bg-card py-2 pr-2.5 pl-3.5 text-sm shadow-lg ring-1 ring-border motion-safe:scale-[1.02] dark:ring-foreground/15", refused && "cursor-not-allowed ring-2 ring-destructive/60")}>
    <span className="absolute inset-y-0 -left-1 my-auto flex h-10 w-6 items-center justify-center text-muted-foreground"><GripVertical className="size-4" aria-hidden="true" /></span>
    <SectionTile type={block.type} />
    <span className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="line-clamp-2 font-medium leading-snug">{label}</span>{refused ? <BlockedHint reason={refused} /> : <span className="truncate text-xs text-muted-foreground">{VARIANT_LABELS[block.variant]}</span>}</span>
  </div>;
}
export function SectionList(props: ListProps) {
  const { editor, onAdd, ...rowProps } = props; const { onReorder } = props;
  const blocks = editor.draft.blocks;
  const report = useReportSectionDragPreview();
  const drag = useListDrag({
    ids: blocks.map(block => block.id), instructions: INSTRUCTIONS,
    label: id => BLOCK_LIBRARY_V2[blocks.find(block => block.id === id)?.type ?? "hero"].label,
    blockedReason: (id, to) => sectionPlacementError(blocks, id, to),
    onMove: onReorder,
    onSessionChange: session => report(session ? { activeId: session.id, toIndex: session.to, allowed: !session.blocked && !session.outside } : null),
  });
  const incomplete = new Set(publishIssuesV2(editor.draft, { name: null, logo_url: null }).flatMap(issue => {
    // Slice A issues point inside the block (e.g. `blocks[2].style.image`); the row is still incomplete.
    const match = /^blocks\[(\d+)\](?:\.|$)/.exec(issue.field ?? ""); return match ? [Number(match[1])] : [];
  }));
  return <div className="flex flex-col gap-4">
    <div className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold">Tu página</h2><Badge variant="secondary">{blocks.length === 1 ? "1 sección" : `${blocks.length} secciones`}</Badge></div>
    <p className="text-sm text-muted-foreground">Dale forma a tu historia.</p>
    <SortableList drag={drag} overlay={session => { const block = blocks.find(item => item.id === session.id); return block ? <SectionOverlay block={block} session={session} /> : null; }}>
      <ItemGroup aria-label="Secciones del sitio" className="px-1 py-1 pr-3">{blocks.map((block, index) => <SectionRow key={block.id} {...rowProps} editor={editor} drag={drag} block={block} index={index} incomplete={incomplete.has(index)} />)}</ItemGroup>
    </SortableList>
    <Button variant="outline" className="min-h-10" onClick={onAdd} disabled={blocks.length >= 30}><Plus data-icon="inline-start" aria-hidden="true" />Agregar sección</Button>
    <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><Lock className="size-4 shrink-0" aria-hidden="true" />Portada y Vacantes siempre forman parte de tu sitio, y Portada va primero. Arrastra una sección desde su manija o usa el menú para subirla o bajarla.</p>
  </div>;
}

export function SectionLibrary({ open, onOpenChange, editor, controller }: { open: boolean; onOpenChange: (open: boolean) => void; editor: EditorState; controller: AutosaveController }) {
  const [search, setSearch] = useState(""); const id = useId();
  return <Dialog open={open} onOpenChange={onOpenChange}>
    {/* Controlled: opened by the list action, root intentionally excludes the editor. */}
    <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_auto_minmax(0,1fr)_auto] sm:max-w-2xl">
      <DialogHeader><DialogTitle>Agregar sección</DialogTitle><DialogDescription>Una sección para cada parte de tu historia. Elige un punto de partida.</DialogDescription></DialogHeader>
      <Field><FieldLabel htmlFor={id}>Buscar una sección</FieldLabel><Input id={id} value={search} onChange={event => setSearch(event.target.value)} /></Field>
      <div className="min-h-0 overflow-y-auto"><ItemGroup className="grid gap-3 sm:grid-cols-2">
        {(Object.keys(BLOCK_LIBRARY) as BlockType[]).filter(type => BLOCK_LIBRARY[type].label.toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es"))).map(type => {
          const { label, description } = BLOCK_LIBRARY[type]; const Icon = SECTION_ICONS[type];
          const required = type === "hero" || type === "jobs";
          const disabled = required || editor.draft.blocks.length >= 30;
          const reason = required ? "Ya está en tu sitio; solo puede haber una." : "Llegaste al límite de 30 secciones.";
          return <Item key={type} variant="outline" role="listitem" className="items-start">
            <ItemMedia variant="icon"><Icon aria-hidden="true" /></ItemMedia><ItemContent><ItemTitle>{label}</ItemTitle><ItemDescription className="line-clamp-none">{description}</ItemDescription>{disabled && <p id={`${id}-${type}`} className="text-xs text-muted-foreground">{reason}</p>}
              <Button variant="outline" className="min-h-10 self-start" aria-label={`Agregar ${label}`} aria-describedby={disabled ? `${id}-${type}` : undefined} disabled={disabled} onClick={() => { const action = addBlockAction(type); if (action.type === "add") controller.dispatch(action); onOpenChange(false); }}><Plus data-icon="inline-start" aria-hidden="true" />Agregar</Button>
            </ItemContent>
          </Item>;
        })}
      </ItemGroup>{!(Object.keys(BLOCK_LIBRARY) as BlockType[]).some(type => BLOCK_LIBRARY[type].label.toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es"))) && <p className="text-sm text-muted-foreground">No encontramos secciones con ese nombre.</p>}</div>
      <DialogFooter><DialogClose render={<Button variant="outline" className="min-h-10" />}>Cerrar biblioteca</DialogClose></DialogFooter>
    </DialogContent>
  </Dialog>;
}
