"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DndContext, DragOverlay, PointerSensor, TouchSensor, pointerWithin, useDroppable, useSensor, useSensors, type DragEndEvent, type DragMoveEvent, type DragStartEvent, type DropAnimation, type PointerSensorOptions } from "@dnd-kit/core";
import { AUTO_SCROLL, canAutoScroll, clampIndex, dragMessages, insertionIndex, partedShift, pointerOutside, type DragOutcome, type Point, type RowBox, type Zone } from "./reorder";

export type DragSession = { id: string; from: number; to: number; mode: "pointer" | "keyboard"; outside: boolean; blocked: string | null };
type Options = {
  /** Current order; must not change while a drag is in progress. */
  ids: string[];
  /** Name read by screen readers («Historia», a FAQ question…). */
  label: (id: string) => string;
  /** Reason the row can't land at `to`, or null when allowed. */
  blockedReason?: (id: string, to: number) => string | null;
  /** Called exactly once per successful drop, never for a no-op or cancel. */
  onMove: (id: string, to: number) => void;
  onSessionChange?: (session: DragSession | null) => void;
  instructions: string;
};

/** Mouse and pen start after 6 px; touch is left to the long-press sensor so a
 * swipe over a handle still scrolls the page. */
class FinePointerSensor extends PointerSensor {
  static activators = [{
    eventName: "onPointerDown" as const,
    handler: (event: ReactPointerEvent, options: PointerSensorOptions) => event.nativeEvent.pointerType !== "touch" && PointerSensor.activators[0].handler(event, options),
  }];
}
const LIST_ID = "pf-sortable-list";
const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
const DROP: DropAnimation = { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };
const silent = { onDragStart: () => undefined, onDragOver: () => undefined, onDragEnd: () => undefined, onDragCancel: () => undefined };
const viewport = (): Zone => ({ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight });
/** The list's nearest scrolling ancestor (the editor panel), else the viewport. */
function scrollZone(node: HTMLElement | null): Zone {
  for (let element = node?.parentElement; element && element !== document.body; element = element.parentElement) {
    if (/(auto|scroll|overlay)/.test(getComputedStyle(element).overflowY)) { const rect = element.getBoundingClientRect(); if (rect.height > 0) return rect; }
  }
  return viewport();
}
const zoneOf = (element: Element): Zone => element === document.scrollingElement || element === document.documentElement ? viewport() : element.getBoundingClientRect();
function pointOf(event: Event | null | undefined): Point | null {
  if (!event) return null;
  if ("touches" in event) { const touch = (event as TouchEvent).touches[0] ?? (event as TouchEvent).changedTouches[0]; return touch ? { x: touch.clientX, y: touch.clientY } : null; }
  return "clientX" in event ? { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY } : null;
}
const sameSession = (a: DragSession | null, b: DragSession | null) => a === b || (!!a && !!b && a.id === b.id && a.to === b.to && a.outside === b.outside && a.blocked === b.blocked && a.mode === b.mode);

/** Sortable feedback on top of @dnd-kit/core: rows part around a placeholder at
 * the landing index (pointer, touch and keyboard), the list announces each step
 * in Spanish and a drop commits through one `onMove`. */
export function useListDrag({ ids, label, blockedReason, onMove, onSessionChange, instructions }: Options) {
  const [session, setSessionState] = useState<DragSession | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const sessionRef = useRef<DragSession | null>(null);
  const layout = useRef<RowBox[]>([]);
  const anchor = useRef(0);
  const startOrder = useRef("");
  const list = useRef<HTMLElement | null>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  const grips = useRef(new Map<string, HTMLElement>());
  const refocus = useRef<{ id: string; order: string } | null>(null);
  // Pointer drags: the live pointer (viewport coordinates) and the drop zone it may leave.
  const pointer = useRef<Point | null>(null);
  const zone = useRef<Zone | null>(null);
  const stopTracking = useRef<(() => void) | null>(null);
  const order = ids.join("|");
  const sensors = useSensors(useSensor(FinePointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }));

  const setSession = useCallback((next: DragSession | null) => {
    if (sameSession(sessionRef.current, next)) return;
    sessionRef.current = next; setSessionState(next); onSessionChange?.(next);
  }, [onSessionChange]);
  const announce = useCallback((text: string) => setAnnouncement(text), []);

  function measure(active: string) {
    const top = list.current?.getBoundingClientRect().top ?? 0;
    layout.current = ids.map(id => { const rect = rows.current.get(id)?.getBoundingClientRect(); return { top: (rect?.top ?? 0) - top, height: rect?.height ?? 0 }; });
    // The pointer holds the handle: its centre (not the centre of a tall, open
    // row) is what crosses the neighbours' midpoints.
    const handle = grips.current.get(active)?.getBoundingClientRect();
    const row = layout.current[ids.indexOf(active)];
    anchor.current = handle && handle.height ? handle.top - top + handle.height / 2 : row ? row.top + row.height / 2 : 0;
  }
  function track(start: Event | null | undefined) {
    stopTracking.current?.();
    pointer.current = pointOf(start); zone.current = scrollZone(list.current);
    // Capture on window runs before dnd-kit's document listeners, so a move sees the fresh pointer.
    const follow = (event: Event) => { pointer.current = pointOf(event) ?? pointer.current; };
    const options = { capture: true, passive: true };
    window.addEventListener("pointermove", follow, options); window.addEventListener("touchmove", follow, options);
    stopTracking.current = () => { window.removeEventListener("pointermove", follow, options); window.removeEventListener("touchmove", follow, options); stopTracking.current = null; };
  }
  const outsideNow = () => !!pointer.current && !!zone.current && pointerOutside(pointer.current, zone.current);
  function begin(id: string, mode: DragSession["mode"], start?: Event) {
    const from = ids.indexOf(id); if (from < 0) return;
    refocus.current = null; startOrder.current = order; measure(id);
    if (mode === "pointer") track(start);
    setSession({ id, from, to: from, mode, outside: false, blocked: null });
    announce(dragMessages.start(label(id), from, ids.length));
  }
  function update(to: number, outside: boolean) {
    const current = sessionRef.current; if (!current) return;
    const target = outside ? current.from : to;
    const blocked = target === current.from ? null : blockedReason?.(current.id, target) ?? null;
    const next = { ...current, to: target, outside, blocked };
    if (sameSession(current, next)) return;
    setSession(next);
    announce(dragMessages.over(label(current.id), target, ids.length, blocked, outside));
  }
  function finish(cancelled: boolean) {
    const current = sessionRef.current; if (!current) return;
    stopTracking.current?.(); pointer.current = null;
    setSession(null);
    const outcome: DragOutcome = cancelled ? "cancelled" : current.outside ? "outside" : current.to === current.from ? "same" : current.blocked ? "blocked" : "moved";
    if (current.mode === "keyboard") refocus.current = { id: current.id, order };
    if (outcome === "moved") onMove(current.id, current.to);
    announce(dragMessages.end(outcome, label(current.id), current.from, current.to, ids.length, current.blocked));
  }

  // The list changed under a live drag (undo, a server reload…): its measured
  // slots no longer match, so the drag is cancelled rather than misplaced.
  useEffect(() => { if (sessionRef.current && startOrder.current !== order) finish(true); });
  // Keep the keyboard focus on the moved row's handle once the new order renders.
  useEffect(() => {
    const pending = refocus.current; if (!pending || session) return;
    const grip = grips.current.get(pending.id);
    if (grip && document.activeElement !== grip) grip.focus();
    if (pending.order !== order) refocus.current = null;
  }, [order, session]);
  useEffect(() => () => stopTracking.current?.(), []);
  // Pointer drags show grabbing / not-allowed wherever the pointer is.
  const cursor = session?.mode === "pointer" ? (session.blocked || session.outside ? "not-allowed" : "grabbing") : null;
  useEffect(() => {
    if (!cursor) return;
    const previous = document.body.style.cursor; document.body.style.cursor = cursor;
    return () => { document.body.style.cursor = previous; };
  }, [cursor]);

  const contextProps = {
    sensors, collisionDetection: pointerWithin,
    autoScroll: { ...AUTO_SCROLL, canScroll: (element: Element) => canAutoScroll(pointer.current, zoneOf(element)) },
    accessibility: { announcements: silent, screenReaderInstructions: { draggable: instructions } },
    onDragStart: ({ active, activatorEvent }: DragStartEvent) => begin(String(active.id), "pointer", activatorEvent ?? undefined),
    // `delta` includes auto-scroll; the index is clamped to the ends, so a pointer
    // below the last row lands last and above the first lands first.
    onDragMove: ({ delta }: DragMoveEvent) => {
      const current = sessionRef.current; if (!current) return;
      update(insertionIndex(layout.current, current.from, anchor.current + delta.y), outsideNow());
    },
    onDragEnd: ({ delta }: DragEndEvent) => {
      const current = sessionRef.current;
      if (current) update(insertionIndex(layout.current, current.from, anchor.current + delta.y), outsideNow());
      finish(false);
    },
    onDragCancel: () => finish(true),
  };

  function gripProps(id: string) {
    const keyboard = session?.mode === "keyboard" && session.id === id;
    return {
      ref: (node: HTMLElement | null) => { if (node) grips.current.set(id, node); else grips.current.delete(id); },
      "aria-pressed": keyboard || (session?.mode === "pointer" && session.id === id),
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        const current = sessionRef.current;
        if (!current) {
          if (event.key === " " || event.key === "Enter") { event.preventDefault(); begin(id, "keyboard"); }
          return;
        }
        if (current.mode !== "keyboard" || current.id !== id) return;
        const step: Record<string, number> = { ArrowUp: current.to - 1, ArrowDown: current.to + 1, Home: 0, End: ids.length - 1 };
        if (event.key in step) { event.preventDefault(); update(clampIndex(step[event.key], ids.length), false); }
        else if (event.key === " " || event.key === "Enter") { event.preventDefault(); finish(false); }
        else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); event.nativeEvent.stopImmediatePropagation?.(); finish(true); }
      },
      onBlur: () => { const current = sessionRef.current; if (current?.mode === "keyboard" && current.id === id) finish(true); },
    };
  }
  /** Row element: measured on start, translated while a drag is in progress. */
  function rowProps(id: string): { ref: (node: HTMLElement | null) => void; style?: CSSProperties; "data-drag"?: "placeholder" | "lifted"; "data-drag-blocked"?: "true"; "data-dragging-list"?: "" } {
    const ref = (node: HTMLElement | null) => { if (node) rows.current.set(id, node); else rows.current.delete(id); };
    if (!session) return { ref };
    const index = ids.indexOf(id);
    const shift = partedShift(layout.current, session.from, session.to, session.blocked, index);
    const active = session.id === id;
    return {
      ref, style: shift ? { transform: `translate3d(0, ${shift}px, 0)` } : undefined, "data-dragging-list": "",
      ...(active ? { "data-drag": session.mode === "pointer" ? "placeholder" as const : "lifted" as const, ...(session.blocked ? { "data-drag-blocked": "true" as const } : {}) } : {}),
    };
  }
  const listRef = (node: HTMLElement | null) => { list.current = node; };
  const region = <div data-drag-announcer="" role="status" aria-live="assertive" aria-atomic="true" className="sr-only">{announcement}</div>;
  /** Speak through the list's live region (e.g. Subir/Bajar shortcuts outside a drag). */
  return { session, contextProps, gripProps, rowProps, listRef, region, announce };
}

/** Moving rows only animate while a drag is live, so the committed reorder
 * renders in place instead of sliding back from the parted positions. */
export const DRAG_ROW_MOTION = "motion-safe:data-dragging-list:transition-transform motion-safe:data-dragging-list:duration-200 motion-safe:data-dragging-list:ease-[cubic-bezier(0.22,1,0.36,1)]";

/** The DndContext, a list-wide droppable and the floating
 * overlay, portaled so transformed ancestors can't offset it. */
export function SortableList({ drag, overlay, children }: { drag: ReturnType<typeof useListDrag>; overlay: (session: DragSession) => ReactNode; children: ReactNode }) {
  return <DndContext {...drag.contextProps}>
    <ListDroppable listRef={drag.listRef}>{children}</ListDroppable>
    {drag.region}
    {typeof document !== "undefined" && createPortal(<DragOverlay dropAnimation={reducedMotion() ? null : DROP} zIndex={60}>{drag.session?.mode === "pointer" ? overlay(drag.session) : null}</DragOverlay>, document.body)}
  </DndContext>;
}
function ListDroppable({ listRef, children }: { listRef: (node: HTMLElement | null) => void; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: LIST_ID });
  return <div ref={node => { setNodeRef(node); listRef(node); }} className="relative">{children}</div>;
}
