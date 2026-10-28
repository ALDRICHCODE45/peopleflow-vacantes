"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { ArrowDown, ArrowUp, Ellipsis, GripVertical, Plus, Trash2 } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { FieldError } from "@/components/ui/field";
import { cn } from "@/lib/utils";

function Row({ id, title, index, count, min, move, remove, children }: { id: string; title: string; index: number; count: number; min: number; move: (from: number, to: number) => void; remove: (index: number) => void; children: ReactNode }) {
  const drag = useDraggable({ id }); const drop = useDroppable({ id });
  return <AccordionItem value={id} ref={node => { drag.setNodeRef(node); drop.setNodeRef(node); }} className={cn(drag.isDragging && "opacity-50", drop.isOver && "ring-2 ring-inset ring-ring")}>
    {/* The drag handle and action menu are siblings, never nested in the disclosure button. */}
    <div className="flex items-center gap-1">
      <Button type="button" variant="ghost" size="icon" className="size-10 shrink-0 touch-none" ref={drag.setActivatorNodeRef} {...drag.listeners} {...drag.attributes} aria-label={`Arrastrar elemento ${index + 1}`}><GripVertical aria-hidden="true" /></Button>
      <div className="min-w-0 flex-1"><AccordionTrigger><span className="min-w-0 truncate">{title}</span></AccordionTrigger></div>
      <DropdownMenu><DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" className="size-10 shrink-0" />} aria-label={`Acciones de elemento ${index + 1}`}><Ellipsis aria-hidden="true" /></DropdownMenuTrigger>
        <DropdownMenuContent align="end"><DropdownMenuGroup>
          <DropdownMenuItem className="min-h-10" disabled={index === 0} onClick={() => move(index, index - 1)}><ArrowUp aria-hidden="true" />Subir</DropdownMenuItem>
          <DropdownMenuItem className="min-h-10" disabled={index === count - 1} onClick={() => move(index, index + 1)}><ArrowDown aria-hidden="true" />Bajar</DropdownMenuItem>
          <DropdownMenuItem className="min-h-10" variant="destructive" disabled={count <= min} onClick={() => remove(index)}><Trash2 aria-hidden="true" />Eliminar</DropdownMenuItem>
        </DropdownMenuGroup></DropdownMenuContent>
      </DropdownMenu>
    </div>
    <AccordionContent><div className="flex min-w-0 flex-col gap-5">{children}</div></AccordionContent>
  </AccordionItem>;
}
/** Wire items have no ids. Local identities travel with the item on moves and
 * removals so disclosure, focus, and buffered fields don't attach to another item. */
export function ItemList<T>({ items, onChange, create, summary, children, min, max, error }: { items: T[]; onChange: (items: T[]) => void; create: () => T; summary: (item: T, index: number) => string; children: (item: T, index: number) => ReactNode; min: number; max: number; error?: string }) {
  const prefix = useId(); const serial = useRef(items.length);
  const [keys, setKeys] = useState(() => items.map((_, i) => `${prefix}-${i}`));
  const [open, setOpen] = useState<string[]>(() => keys.slice(0, 1));
  // A canonical server response can change the count without an item action.
  let ids = keys;
  if (keys.length !== items.length) {
    ids = items.map((_, i) => keys[i] ?? `${prefix}-${serial.current++}`);
    setKeys(ids);
  }
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
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
  function drop({ active, over }: DragEndEvent) { if (over) move(ids.indexOf(String(active.id)), ids.indexOf(String(over.id))); }
  return <div className="flex min-w-0 flex-col gap-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-muted-foreground">Para publicar: de {min} a {max} elementos.</p><Badge variant="secondary">{items.length}/{max}</Badge></div>
    {error && <FieldError>{error}</FieldError>}
    {items.length === 0 ? <Empty><EmptyHeader><EmptyTitle>Cuenta más sobre tu empresa</EmptyTitle><EmptyDescription>Agrega tu primer elemento para empezar.</EmptyDescription></EmptyHeader></Empty> :
      <DndContext sensors={sensors} onDragEnd={drop} accessibility={{ screenReaderInstructions: { draggable: "Arrastra desde la manija o usa Subir y Bajar en el menú de acciones." }, announcements: {
        onDragStart: ({ active }) => `Moviendo elemento ${ids.indexOf(String(active.id)) + 1}.`,
        onDragOver: ({ over }) => over ? `Destino: posición ${ids.indexOf(String(over.id)) + 1}.` : "Fuera de la lista.",
        onDragEnd: ({ over }) => over ? `Nueva posición: ${ids.indexOf(String(over.id)) + 1}.` : "Se conservó el orden.",
        onDragCancel: () => "Movimiento cancelado.",
      } }}>
        <Accordion value={open} onValueChange={setOpen}>{items.map((item, index) => <Row key={ids[index]} id={ids[index]} title={summary(item, index)} index={index} count={items.length} min={min} move={move} remove={remove}>{children(item, index)}</Row>)}</Accordion>
      </DndContext>}
    <Button type="button" variant="outline" className="min-h-10" disabled={items.length >= max} aria-describedby={`${prefix}-limit`} onClick={() => { if (items.length >= max) return; const key = `${prefix}-${serial.current++}`; setKeys([...ids, key]); setOpen([key]); onChange([...items, create()]); }}><Plus aria-hidden="true" data-icon="inline-start" />Agregar</Button>
    <p id={`${prefix}-limit`} className="text-xs text-muted-foreground">{items.length >= max ? `Llegaste al límite de ${max} elementos.` : items.length <= min && items.length > 0 ? `Conserva al menos ${min} ${min === 1 ? "elemento" : "elementos"} para publicar.` : "Puedes cambiar el orden con la manija o desde el menú de cada elemento."}</p>
  </div>;
}
