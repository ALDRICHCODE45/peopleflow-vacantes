import { useRef, useState, type ReactNode } from "react";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, pointerWithin, useSensor, useSensors,
  type Announcements, type CollisionDetection, type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { Item, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item";
import { canMoveTo, type SubstatesEditorState } from "@/features/jobs/drafts/pipeline/substates-model";
import { POSITION_MEDALLION } from "../stage-config/reorder";

/** Unlike columns, every substate can occupy either endpoint. */
export function SubstatesReorder({ state, disabled, onMove, children }: {
  state: SubstatesEditorState; disabled: boolean; onMove: (key: string, targetIndex: number) => void; children: ReactNode;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const inputMode = useRef<"pointer" | "keyboard">("pointer");
  const keyboardCoordinates: KeyboardCoordinateGetter = (event, { context, currentCoordinates }) => {
    if (event.code !== "ArrowDown" && event.code !== "ArrowUp") return;
    event.preventDefault();
    const index = state.entries.findIndex(entry => entry.key === (context.over?.id ?? context.active?.id));
    const target = state.entries[index + (event.code === "ArrowDown" ? 1 : -1)];
    const rect = target && context.droppableRects.get(target.key);
    if (!rect || !context.collisionRect) return;
    return { x: currentCoordinates.x, y: currentCoordinates.y + rect.top - context.collisionRect.top };
  };
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates, scrollBehavior: "auto" }));
  const collisionDetection: CollisionDetection = args => inputMode.current === "keyboard" ? closestCenter(args) : pointerWithin(args);
  const name = (id: string | number) => state.entries.find(entry => entry.key === String(id))?.name || "el subestado";
  const position = (id: string | number) => state.entries.findIndex(entry => entry.key === String(id));
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Tomaste ${name(active.id)}`,
    onDragOver: ({ active, over }) => over?.id === active.id ? undefined : over ? `${name(active.id)} sobre la posición ${position(over.id) + 1}` : `${name(active.id)} fuera de las posiciones: no se moverá`,
    onDragEnd: ({ active, over }) => !disabled && over && canMoveTo(state, String(active.id), position(over.id)) ? `Soltaste ${name(active.id)} en la posición ${position(over.id) + 1}` : `${name(active.id)} no se movió: suelta sobre otra posición`,
    onDragCancel: ({ active }) => `Cancelaste el movimiento de ${name(active.id)}`,
  };
  const active = state.entries.find(entry => entry.key === activeId);
  return <DndContext id="pipeline-substates-reorder" sensors={sensors} collisionDetection={collisionDetection}
    accessibility={{ screenReaderInstructions: { draggable: "Presiona espacio o enter para tomar el subestado, usa las flechas arriba y abajo y vuelve a presionar espacio o enter para soltarlo. Escape cancela el movimiento." }, announcements }}
    onDragStart={event => { inputMode.current = event.activatorEvent.type === "keydown" ? "keyboard" : "pointer"; setActiveId(String(event.active.id)); }}
    onDragCancel={() => setActiveId(null)}
    onDragEnd={({ active, over }) => { setActiveId(null); if (!disabled && over) onMove(String(active.id), position(over.id)); }}>
    {children}
    <DragOverlay dropAnimation={null} aria-hidden="true">
      {active && <Item variant="outline" className="bg-card shadow-lg"><ItemMedia variant="icon" className={POSITION_MEDALLION}>{position(active.key) + 1}</ItemMedia><ItemContent><ItemTitle>{active.name || "Sin nombre"}</ItemTitle></ItemContent></Item>}
    </DragOverlay>
  </DndContext>;
}
