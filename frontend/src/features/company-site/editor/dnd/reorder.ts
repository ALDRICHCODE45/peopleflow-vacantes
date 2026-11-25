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
