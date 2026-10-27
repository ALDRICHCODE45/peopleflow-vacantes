"use client";

import { useId, useState } from "react";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { ArrowDown, ArrowUp, BookOpen, Briefcase, ChartNoAxesColumn, Compass, Copy, Circle, Ellipsis, EyeOff, Gift, GripVertical, HelpCircle, Images, LayoutTemplate, Lock, MapPin, MessageSquareQuote, Plus, SlidersHorizontal, Trash2, Video, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { BLOCK_LIBRARY } from "../defaults";
import { addBlockAction, duplicateBlockAction, type EditorState } from "../editor-state";
import type { AutosaveController } from "../autosave";
import { publishIssues, type BlockType, type SiteBlock } from "../model";
import { VARIANT_LABELS } from "./variant-picker";

export const SECTION_ICONS: Record<BlockType, LucideIcon> = { hero: LayoutTemplate, story: BookOpen, values: Compass, benefits: Gift, stats: ChartNoAxesColumn, process: SlidersHorizontal, gallery: Images, testimonials: MessageSquareQuote, video: Video, offices: MapPin, jobs: Briefcase, faq: HelpCircle, closing: LayoutTemplate };
const protectedBlock = (block: SiteBlock) => block.type === "hero" || block.type === "jobs";
type ListProps = { editor: EditorState; controller: AutosaveController; onSelect: (id: string) => void; onDelete: (block: SiteBlock) => void; onAdd: () => void };
function SectionRow({ block, index, incomplete, ...props }: Omit<ListProps, "onAdd"> & { block: SiteBlock; index: number; incomplete: boolean }) {
  const { editor, controller, onSelect, onDelete } = props;
  const label = BLOCK_LIBRARY[block.type].label; const Icon = SECTION_ICONS[block.type];
  const drag = useDraggable({ id: block.id }); const drop = useDroppable({ id: block.id });
  const switchId = useId(); const required = protectedBlock(block);
  return <Item role="listitem" size="xs" ref={node => { drag.setNodeRef(node); drop.setNodeRef(node); }}
    className={cn("relative flex-nowrap", editor.selectedId === block.id && "bg-card shadow-sm ring-1 ring-primary/40", drag.isDragging && "opacity-50", drop.isOver && "ring-2 ring-ring")}>
    {/* Stretched native hit area: hover and focus-visible belong to the whole
        Item, with no inner pill. Drag/menu remain independent sibling controls. */}
    <Button variant="ghost" className="absolute inset-0 size-full" aria-label={`Seleccionar ${label}`} aria-pressed={editor.selectedId === block.id} onClick={() => onSelect(block.id)} onKeyDown={event => {
      if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) { event.preventDefault(); controller.dispatch({ type: "move", id: block.id, direction: event.key === "ArrowUp" ? -1 : 1 }); }
    }} />
    {/* The compact layout owns its gaps, not ItemTitle's line-clamp display.
        36px slots retain 40px hit targets by extending into Item's own inset. */}
    <div className="flex w-full items-center gap-0.5">
    <ItemMedia className="relative h-10 w-9 shrink-0"><Button variant="ghost" size="icon" className="absolute top-0 -left-1 size-10 touch-none" ref={drag.setActivatorNodeRef} {...drag.listeners} {...drag.attributes} aria-label={`Arrastrar ${label}`}><GripVertical aria-hidden="true" /></Button></ItemMedia>
    <ItemContent className="pointer-events-none relative min-w-0">
      <div data-section-identity="" className="flex min-w-0 flex-row items-center gap-1"><Icon data-section-type-icon="" className="size-3.5 shrink-0" aria-hidden="true" /><div data-section-copy="" className="flex min-w-0 flex-col gap-0.5"><ItemTitle className="line-clamp-none whitespace-nowrap">{label}</ItemTitle><span className="text-xs text-muted-foreground">{VARIANT_LABELS[block.variant]}</span></div></div>
    </ItemContent>
    <ItemActions className="relative"><div className="flex items-center gap-1">
      <span data-section-indicators="" className="flex shrink-0 items-center gap-1 text-muted-foreground">{required && <Lock className="size-3.5" aria-label="Sección obligatoria" />}{block.hidden && <><EyeOff className="size-3.5" aria-hidden="true" /><span className="sr-only">Oculta</span></>}{incomplete && <><Circle className="size-1.5 fill-current" aria-hidden="true" /><span className="sr-only">Incompleta</span></>}</span>
      <DropdownMenu><div className="relative h-10 w-9"><DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="absolute top-0 left-0 size-10" />} aria-label={`Acciones de ${label}`}><Ellipsis aria-hidden="true" /></DropdownMenuTrigger></div>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuGroup>
            <DropdownMenuItem className="min-h-10" disabled={index === 0} onClick={() => controller.dispatch({ type: "move", id: block.id, direction: -1 })}><ArrowUp aria-hidden="true" />Subir</DropdownMenuItem>
            <DropdownMenuItem className="min-h-10" disabled={index === editor.draft.blocks.length - 1} onClick={() => controller.dispatch({ type: "move", id: block.id, direction: 1 })}><ArrowDown aria-hidden="true" />Bajar</DropdownMenuItem>
            <DropdownMenuItem className="min-h-10" disabled={required || editor.draft.blocks.length >= 30} onClick={() => { const action = duplicateBlockAction(editor, block.id); if (action.type === "duplicate") controller.dispatch(action); }}><Copy aria-hidden="true" />Duplicar</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <Field orientation="horizontal" data-disabled={required} className="px-2"><FieldLabel htmlFor={switchId}>Mostrar {label}</FieldLabel><Switch id={switchId} checked={!block.hidden} disabled={required} onCheckedChange={checked => controller.dispatch({ type: "hidden", id: block.id, hidden: !checked })} /></Field>
          {required && <p className="px-2 text-xs text-muted-foreground">Siempre visible en tu sitio.</p>}
          <DropdownMenuSeparator />
          <DropdownMenuGroup><DropdownMenuItem className="min-h-10" variant="destructive" disabled={required} onClick={() => onDelete(block)}><Trash2 aria-hidden="true" />Eliminar</DropdownMenuItem></DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div></ItemActions>
    </div>
  </Item>;
}
export function SectionList(props: ListProps) {
  const { editor, controller, onAdd } = props;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const incomplete = new Set(publishIssues(editor.draft, { name: null, logo_url: null }).flatMap(issue => {
    const match = /^blocks\[(\d+)\]$/.exec(issue.field ?? ""); return match ? [Number(match[1])] : [];
  }));
  function reorder({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = editor.draft.blocks.findIndex(block => block.id === active.id);
    const to = editor.draft.blocks.findIndex(block => block.id === over.id);
    if (from < 0 || to < 0) return;
    for (let i = 0; i < Math.abs(to - from); i++) controller.dispatch({ type: "move", id: String(active.id), direction: to > from ? 1 : -1 });
  }
  const dragLabel = (id: string | number) => BLOCK_LIBRARY[editor.draft.blocks.find(block => block.id === id)?.type ?? "hero"].label;
  return <div className="flex flex-col gap-4">
    <div className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold">Tu página</h2><Badge variant="secondary">{editor.draft.blocks.length === 1 ? "1 sección" : `${editor.draft.blocks.length} secciones`}</Badge></div>
    <p className="text-sm text-muted-foreground">Dale forma a tu historia.</p>
    <DndContext sensors={sensors} onDragEnd={reorder} accessibility={{ screenReaderInstructions: { draggable: "Arrastra desde la manija. También puedes usar Subir y Bajar en el menú de acciones, o Alt y las flechas al seleccionar una sección." }, announcements: {
      onDragStart: ({ active }) => `Moviendo ${dragLabel(active.id)}.`,
      onDragOver: ({ over }) => over ? `Destino: ${dragLabel(over.id)}.` : "Fuera de la lista.",
      onDragEnd: ({ active, over }) => over ? `${dragLabel(active.id)} se movió a la posición ${editor.draft.blocks.findIndex(block => block.id === over.id) + 1}.` : "Se conservó el orden.",
      onDragCancel: () => "Movimiento cancelado.",
    } }}>
      <ItemGroup aria-label="Secciones del sitio">{editor.draft.blocks.map((block, index) => <SectionRow key={block.id} {...props} block={block} index={index} incomplete={incomplete.has(index)} />)}</ItemGroup>
    </DndContext>
    <Button variant="outline" className="min-h-10" onClick={onAdd} disabled={editor.draft.blocks.length >= 30}><Plus data-icon="inline-start" aria-hidden="true" />Agregar sección</Button>
    <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><Lock className="size-4 shrink-0" aria-hidden="true" />Portada y Vacantes siempre forman parte de tu sitio. Usa el menú para subir o bajar una sección.</p>
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
