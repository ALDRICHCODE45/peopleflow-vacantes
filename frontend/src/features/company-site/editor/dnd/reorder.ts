/** Pure reorder math shared by the section list and the form item lists.
 * Positions are measured once when a drag starts, relative to the list's top,
 * so they stay valid while the list (or an ancestor) auto-scrolls. */
export type RowBox = { top: number; height: number };

export function arrayMove<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length) return next;
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

/** Final index of the dragged row: how many of the other rows have their
 * midpoint above the dragged row's centre. Never "the row under the pointer". */
export function insertionIndex(rows: readonly RowBox[], from: number, centerY: number): number {
  let index = 0;
  rows.forEach((row, i) => { if (i !== from && row.top + row.height / 2 < centerY) index++; });
  return index;
}

/** Vertical gap between consecutive rows (uniform in our lists). */
function rowGap(rows: readonly RowBox[]): number {
  return rows.length > 1 ? Math.max(0, rows[1].top - (rows[0].top + rows[0].height)) : 0;
}

/** Translation of row `i` so the list shows the dragged row (`from`) already
 * sitting at `to`: rows in between part by the dragged row's stride. */
export function rowShift(rows: readonly RowBox[], from: number, to: number, i: number): number {
  const active = rows[from]; const row = rows[i];
  if (!active || !row || from === to) return 0;
  if (i === from) {
    const target = rows[to];
    return to > from ? (target.top + target.height) - (active.top + active.height) : target.top - active.top;
  }
  const stride = active.height + rowGap(rows);
  if (from < i && i <= to) return -stride;
  if (to <= i && i < from) return stride;
  return 0;
}

/** Like `rowShift`, but a forbidden landing slot opens no gap: every row,
 * the dragged one included, stays at rest while the overlay says why. */
export function partedShift(rows: readonly RowBox[], from: number, to: number, blocked: string | null, i: number): number {
  return rowShift(rows, from, blocked ? from : to, i);
}

export type Point = { x: number; y: number };
export type Zone = { left: number; top: number; right: number; bottom: number };
/** Slack around the drop zone: a hand that wobbles past the panel's side or
 * overshoots after auto-scroll is still dropping in the list. */
const OUTSIDE_SLACK = { x: 24, y: 96 };
/** The drop zone is the list's whole scroll container (rows, the space below
 * them, the list's add button): the landing index is clamped to the ends, so
 * only a pointer that leaves it sideways or goes far away cancels. */
export function pointerOutside(point: Point, zone: Zone): boolean {
  return point.x < zone.left - OUTSIDE_SLACK.x || point.x > zone.right + OUTSIDE_SLACK.x || point.y < zone.top - OUTSIDE_SLACK.y || point.y > zone.bottom + OUTSIDE_SLACK.y;
}

/** dnd-kit auto-scroll: a narrow band at the container's top and bottom edge,
 * at most `acceleration` px every `interval` ms (≤ 500 px/s). */
export const AUTO_SCROLL = { threshold: { x: 0, y: 0.1 }, acceleration: 4, interval: 10 } as const;
/** dnd-kit's speed grows without limit as the pointer moves past a container's
 * edge; scrolling only while the pointer is inside it keeps the speed bounded. */
export function canAutoScroll(point: Point | null, zone: Zone): boolean {
  return !point || (point.x >= zone.left && point.x <= zone.right && point.y >= zone.top && point.y <= zone.bottom);
}

export const clampIndex = (index: number, count: number) => Math.max(0, Math.min(count - 1, index));

/** Reason a section can't land at `to`, or null when the move is allowed: the
 * reducer's own rule (`placementError`), so the list can never disagree with it. */
export { placementError as sectionPlacementError, PORTADA_FIRST } from "../../editor-state";

export const positionText = (label: string, index: number, count: number) => `${label}, posición ${index + 1} de ${count}.`;
const stays = (label: string, index: number, count: number) => `${label} se queda en la posición ${index + 1} de ${count}.`;
export type DragOutcome = "moved" | "same" | "blocked" | "outside" | "cancelled";
/** Spanish screen-reader copy for every step of a drag. */
export const dragMessages = {
  start: (label: string, index: number, count: number) => `Moviendo ${label}, posición ${index + 1} de ${count}. Usa las flechas arriba y abajo para moverla, Espacio o Enter para soltarla y Escape para cancelar.`,
  over: (label: string, index: number, count: number, blocked: string | null, outside: boolean) =>
    outside ? "Fuera de la lista: al soltar se cancela el movimiento." : blocked ? `Posición ${index + 1} no permitida: ${blocked}` : positionText(label, index, count),
  end: (outcome: DragOutcome, label: string, from: number, to: number, count: number, blocked: string | null = null) => {
    switch (outcome) {
      case "moved": return positionText(label, to, count);
      case "same": return stays(label, from, count);
      case "blocked": return `No se puede mover ahí: ${blocked ?? ""} ${stays(label, from, count)}`.replace(/\s+/g, " ");
      case "outside": return `Fuera de la lista. ${stays(label, from, count)}`;
      case "cancelled": return `Movimiento cancelado. ${stays(label, from, count)}`;
    }
  },
};
