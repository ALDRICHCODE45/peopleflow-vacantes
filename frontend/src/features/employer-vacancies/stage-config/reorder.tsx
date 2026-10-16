import { useRef, useState, type ReactNode } from "react";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, pointerWithin, useSensor, useSensors,
  type Announcements, type CollisionDetection, type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { Item, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item";
import { canMoveTo, type PipelineEditorState } from "@/features/jobs/drafts/pipeline/editor-model";

export const POSITION_MEDALLION = "size-10 rounded-full bg-primary/12 text-foreground ring-1 ring-primary/40";

/** Handle-only sensors, with keyboard movement aligned to rows rather than pixels. */
export function StageReorder({ state, disabled, onMove, children }: {
  state: PipelineEditorState;
  disabled: boolean;
  onMove: (key: string, targetIndex: number) => void;
  children: ReactNode;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const inputMode = useRef<"pointer" | "keyboard">("pointer");
  const keyboardCoordinates: KeyboardCoordinateGetter = (event, { context, currentCoordinates }) => {
    if (event.code !== "ArrowDown" && event.code !== "ArrowUp") return;
    event.preventDefault();
    const index = state.stages.findIndex(stage => stage.key === (context.over?.id ?? context.active?.id));
    const target = state.stages[index + (event.code === "ArrowDown" ? 1 : -1)];
    const rect = target && context.droppableRects.get(target.key);
    if (!rect || !context.collisionRect) return;
    return { x: currentCoordinates.x, y: currentCoordinates.y + rect.top - context.collisionRect.top };
  };
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates, scrollBehavior: "auto" }),
  );
  const collisionDetection: CollisionDetection = args => inputMode.current === "keyboard"
    ? closestCenter(args) : pointerWithin(args);
  const name = (id: string | number) => state.stages.find(stage => stage.key === String(id))?.name || "la columna";
  const position = (id: string | number) => state.stages.findIndex(stage => stage.key === String(id));
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Tomaste ${name(active.id)}`,
    onDragOver: ({ active, over }) => over?.id === active.id ? undefined : over
      ? `${name(active.id)} sobre la posición ${position(over.id) + 1}`
      : `${name(active.id)} fuera de las posiciones: no se moverá`,
    onDragEnd: ({ active, over }) => !disabled && over && canMoveTo(state, String(active.id), position(over.id))
      ? `Soltaste ${name(active.id)} en la posición ${position(over.id) + 1}`
      : `${name(active.id)} no se movió: suelta sobre una posición intermedia`,
    onDragCancel: ({ active }) => `Cancelaste el movimiento de ${name(active.id)}`,
  };
  const active = state.stages.find(stage => stage.key === activeId);
  return (
    <DndContext id="pipeline-stage-reorder" sensors={sensors} collisionDetection={collisionDetection}
      accessibility={{
        screenReaderInstructions: { draggable: "Presiona espacio o enter para tomar la columna, usa las flechas arriba y abajo y vuelve a presionar espacio o enter para soltarla. Escape cancela el movimiento." },
        announcements,
      }}
      onDragStart={event => {
        inputMode.current = event.activatorEvent.type === "keydown" ? "keyboard" : "pointer";
        setActiveId(String(event.active.id));
      }}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={({ active, over }) => {
        setActiveId(null);
        if (!disabled && over) onMove(String(active.id), position(over.id));
      }}>
      {children}
      <DragOverlay dropAnimation={null} aria-hidden="true">
        {active && <Item variant="outline" className="bg-card shadow-lg">
          <ItemMedia variant="icon" className={POSITION_MEDALLION}>{position(active.key) + 1}</ItemMedia>
          <ItemContent><ItemTitle>{active.name || "Sin nombre"}</ItemTitle></ItemContent>
        </Item>}
      </DragOverlay>
    </DndContext>
  );
}
