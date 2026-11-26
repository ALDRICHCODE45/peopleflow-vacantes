"use client";

import { useEffect, useId, useRef, useState, type ComponentType, type ReactNode, type SVGProps } from "react";
import { useDraggable } from "@dnd-kit/core";
import { ArrowDown, ArrowUp, Ellipsis, GripVertical, Plus, Trash2 } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SectionEmpty } from "@/components/feedback/state-card";
import { FieldError } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { DRAG_ROW_MOTION, SortableList, useListDrag } from "../dnd/use-list-drag";
import { CompleteTarget } from "./fields";

type Drag = ReturnType<typeof useListDrag>;
const INSTRUCTIONS = "Para mover un elemento, pulsa Espacio o Enter en su manija, usa las flechas arriba y abajo y vuelve a pulsar Espacio o Enter para soltarlo; Escape cancela. También puedes usar Subir y Bajar en el menú de acciones.";

function Row({ id, title, index, count, min, move, remove, drag, children }: { id: string; title: string; index: number; count: number; min: number; move: (from: number, to: number) => void; remove: (index: number) => void; drag: Drag; children: ReactNode }) {
  const draggable = useDraggable({ id, attributes: { roleDescription: "manija de arrastre" } });
  const { ref: rowRef, ...rowAttrs } = drag.rowProps(id);
  const { ref: gripRef, ...grip } = drag.gripProps(id);
  return <AccordionItem value={id} ref={rowRef} {...rowAttrs} data-item-index={index}
    className={cn("relative", DRAG_ROW_MOTION,
      "data-[drag=placeholder]:rounded-xl data-[drag=placeholder]:border-transparent data-[drag=placeholder]:bg-primary/5 data-[drag=placeholder]:outline-2 data-[drag=placeholder]:outline-primary/50 data-[drag=placeholder]:outline-dashed data-[drag=placeholder]:*:opacity-0",
      "data-[drag=lifted]:z-10 data-[drag=lifted]:rounded-xl data-[drag=lifted]:bg-card data-[drag=lifted]:shadow-lg data-[drag=lifted]:ring-2 data-[drag=lifted]:ring-primary dark:data-[drag=lifted]:ring-primary-text")}>
    {/* The drag handle and action menu are siblings, never nested in the disclosure button.
        The header row is the drag node, so the floating copy is one row tall even when open. */}
    <div ref={draggable.setNodeRef} className="flex min-w-0 items-center gap-2">
      <Button type="button" variant="ghost" size="icon" ref={node => { draggable.setActivatorNodeRef(node); gripRef(node); }} {...draggable.listeners} {...draggable.attributes} {...grip} aria-label={`Arrastrar elemento ${index + 1}`}
        className="size-10 shrink-0 cursor-grab touch-manipulation text-muted-foreground select-none [-webkit-touch-callout:none] active:cursor-grabbing"><GripVertical aria-hidden="true" /></Button>
      <span title={title} className="min-w-0 flex-1 line-clamp-2 break-words text-sm font-medium">{title}</span>
      <DropdownMenu><DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" className="size-10 shrink-0" />} aria-label={`Acciones de elemento ${index + 1}`}><Ellipsis aria-hidden="true" /></DropdownMenuTrigger>
        <DropdownMenuContent align="end"><DropdownMenuGroup>
          <DropdownMenuItem className="min-h-10" disabled={index === 0} onClick={() => move(index, index - 1)}><ArrowUp aria-hidden="true" />Subir</DropdownMenuItem>
          <DropdownMenuItem className="min-h-10" disabled={index === count - 1} onClick={() => move(index, index + 1)}><ArrowDown aria-hidden="true" />Bajar</DropdownMenuItem>
          <DropdownMenuItem className="min-h-10" variant="destructive" disabled={count <= min} onClick={() => remove(index)}><Trash2 aria-hidden="true" />Eliminar</DropdownMenuItem>
        </DropdownMenuGroup></DropdownMenuContent>
      </DropdownMenu>
      {/* Icon-only disclosure retains the installed trigger's native geometry.
          Its own slot keeps the menu outside the title and chevron hit area. */}
      <div className="shrink-0"><AccordionTrigger aria-label={title} /></div>
    </div>
    {/* pt-1: the panel clips its overflow, so the first control's focus ring needs room. */}
    <AccordionContent><div className="flex min-w-0 flex-col gap-5 pt-1">{children}</div></AccordionContent>
  </AccordionItem>;
}
/** Floating copy of the header row that follows the pointer. */
function ItemOverlay({ title }: { title: string }) {
  return <div data-drag-overlay="" className="flex size-full cursor-grabbing items-center gap-2 rounded-xl bg-card pr-3 shadow-lg ring-1 ring-border motion-safe:scale-[1.02] dark:ring-foreground/15">
    <span className="flex size-10 shrink-0 items-center justify-center text-muted-foreground"><GripVertical className="size-4" aria-hidden="true" /></span>
    <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
  </div>;
}
/** Wire items have no ids. Local identities travel with the item on moves and
 * removals so disclosure, focus, and buffered fields don't attach to another item. */
export function ItemList<T>({ items, onChange, create, summary, children, min, max, error, empty, countHint, reveal }: { reveal?: { item: number; nonce: number } | null; countHint?: string; empty?: { title: string; description: string; action: string; icon: ComponentType<SVGProps<SVGSVGElement>> };  items: T[]; onChange: (items: T[]) => void; create: () => T; summary: (item: T, index: number) => string; children: (item: T, index: number) => ReactNode; min: number; max: number; error?: string }) {
  const prefix = useId(); const serial = useRef(items.length);
  const [keys, setKeys] = useState(() => items.map((_, i) => `${prefix}-${i}`));
  const [open, setOpen] = useState<string[]>(() => keys.slice(0, 1));
  // A canonical server response can change the count without an item action.
  let ids = keys;
  if (keys.length !== items.length) {
    ids = items.map((_, i) => keys[i] ?? `${prefix}-${serial.current++}`);
    setKeys(ids);
  }
  function move(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || to >= items.length) return;
    const next = [...items]; const nextKeys = [...ids];
    next.splice(to, 0, next.splice(from, 1)[0]); nextKeys.splice(to, 0, nextKeys.splice(from, 1)[0]);
    setKeys(nextKeys); onChange(next);
  }
  function remove(index: number) {
    if (items.length <= min) return;
    const remaining = ids.filter((_, i) => i !== index);
    setKeys(remaining); setOpen(remaining[Math.min(index, remaining.length - 1)] ? [remaining[Math.min(index, remaining.length - 1)]] : []);
    onChange(items.filter((_, i) => i !== index));
  }
  const titleOf = (id: string) => { const index = ids.indexOf(id); return index < 0 ? "Elemento" : summary(items[index], index); };
  // «Completar sección»: open the item whose field is missing (one request per nonce).
  const revealKey = reveal ? ids[reveal.item] : undefined;
  useEffect(() => { if (revealKey) setOpen(current => current.includes(revealKey) ? current : [...current, revealKey]); }, [reveal?.nonce, revealKey]);
  const drag = useListDrag({ ids, label: titleOf, instructions: INSTRUCTIONS, onMove: (id, to) => move(ids.indexOf(id), to) });
  function add() {
    if (items.length >= max) return;
    const key = `${prefix}-${serial.current++}`;
    setKeys([...ids, key]); setOpen([key]); onChange([...items, create()]);
  }
  return <div className="flex min-w-0 flex-col gap-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-muted-foreground">{countHint ?? `Para publicar: de ${min} a ${max} elementos.`}</p><Badge variant="secondary">{items.length}/{max}</Badge></div>
    {error && <FieldError>{error}</FieldError>}
    {items.length === 0 && empty ? <CompleteTarget name="items-add"><SectionEmpty icon={empty.icon} tone="info" title={empty.title} description={empty.description} primaryAction={{ label: empty.action, onClick: add, disabled: items.length >= max, "aria-describedby": `${prefix}-limit` }} /></CompleteTarget> :
      <SortableList drag={drag} overlay={session => <ItemOverlay title={titleOf(session.id)} />}>
        <Accordion value={open} onValueChange={setOpen}>{items.map((item, index) => <Row key={ids[index]} id={ids[index]} title={summary(item, index)} index={index} count={items.length} min={min} move={move} remove={remove} drag={drag}>{children(item, index)}</Row>)}</Accordion>
      </SortableList>}
    {(items.length > 0 || !empty) && <Button type="button" data-complete-target="items-add" variant="outline" className="min-h-10" disabled={items.length >= max} aria-describedby={`${prefix}-limit`} onClick={add}><Plus aria-hidden="true" data-icon="inline-start" />Agregar</Button>}
    <p id={`${prefix}-limit`} className="text-xs text-muted-foreground">{items.length >= max ? `Llegaste al límite de ${max} elementos.` : items.length <= min && items.length > 0 ? `Conserva al menos ${min} ${min === 1 ? "elemento" : "elementos"} para publicar.` : "Puedes cambiar el orden con la manija o desde el menú de cada elemento."}</p>
  </div>;
}
