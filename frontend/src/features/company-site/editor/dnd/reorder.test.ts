import { describe, expect, it } from "vitest";
import { arrayMove, clampIndex, dragMessages, insertionIndex, PORTADA_FIRST, rowShift, sectionPlacementError, type RowBox } from "./reorder";

// Five 40 px rows with an 8 px gap: tops 0, 48, 96, 144, 192; midpoints +20.
const rows: RowBox[] = [0, 48, 96, 144, 192].map(top => ({ top, height: 40 }));
const blocks = ["hero", "story", "jobs", "faq", "closing"].map(type => ({ id: type, type }));

describe("insertionIndex", () => {
  it("keeps the original index while the centre stays between its neighbours' midpoints", () => {
    expect(insertionIndex(rows, 2, 116)).toBe(2);
    expect(insertionIndex(rows, 2, 69)).toBe(2);
    expect(insertionIndex(rows, 2, 163)).toBe(2);
  });
  it("crosses a row only once the centre passes that row's midpoint", () => {
    expect(insertionIndex(rows, 2, 67)).toBe(1);
    expect(insertionIndex(rows, 2, 165)).toBe(3);
    expect(insertionIndex(rows, 0, 69)).toBe(1);
  });
  it("clamps to the ends above the first and below the last row", () => {
    expect(insertionIndex(rows, 3, -500)).toBe(0);
    expect(insertionIndex(rows, 1, 5000)).toBe(4);
  });
  it("handles rows of different heights", () => {
    const mixed: RowBox[] = [{ top: 0, height: 40 }, { top: 48, height: 200 }, { top: 256, height: 40 }];
    expect(insertionIndex(mixed, 0, 140)).toBe(0);
    expect(insertionIndex(mixed, 0, 150)).toBe(1);
  });
});

describe("rowShift", () => {
  it("opens the gap at the landing slot when moving down", () => {
    expect([0, 1, 2, 3, 4].map(i => rowShift(rows, 1, 3, i))).toEqual([0, 96, -48, -48, 0]);
  });
  it("opens the gap at the landing slot when moving up", () => {
    expect([0, 1, 2, 3, 4].map(i => rowShift(rows, 3, 1, i))).toEqual([0, 48, 48, -96, 0]);
  });
  it("moves nothing when the index is unchanged", () => {
    expect([0, 1, 2, 3, 4].map(i => rowShift(rows, 2, 2, i))).toEqual([0, 0, 0, 0, 0]);
  });
  it("lands a short row bottom-aligned with a tall target when moving down", () => {
    const mixed: RowBox[] = [{ top: 0, height: 40 }, { top: 48, height: 100 }];
    expect(rowShift(mixed, 0, 1, 0)).toBe(108);
    expect(rowShift(mixed, 0, 1, 1)).toBe(-48);
  });
});

describe("sectionPlacementError", () => {
  it("forbids anything above Portada, Vacantes included", () => {
    expect(sectionPlacementError(blocks, "jobs", 0)).toBe(PORTADA_FIRST);
    expect(sectionPlacementError(blocks, "closing", 0)).toBe(PORTADA_FIRST);
  });
  it("forbids moving Portada down", () => {
    expect(sectionPlacementError(blocks, "hero", 1)).toBe(PORTADA_FIRST);
    expect(sectionPlacementError(blocks, "hero", 4)).toBe(PORTADA_FIRST);
  });
  it("allows every other position, including Vacantes anywhere below Portada", () => {
    expect(sectionPlacementError(blocks, "jobs", 1)).toBeNull();
    expect(sectionPlacementError(blocks, "jobs", 4)).toBeNull();
    expect(sectionPlacementError(blocks, "story", 4)).toBeNull();
    expect(sectionPlacementError(blocks, "closing", 1)).toBeNull();
  });
  it("treats the same place and unknown ids as no move", () => {
    expect(sectionPlacementError(blocks, "hero", 0)).toBeNull();
    expect(sectionPlacementError(blocks, "missing", 0)).toBeNull();
  });
  it("never pushes a legacy, non-first Portada further down but lets it rise", () => {
    const legacy = ["story", "hero", "jobs"].map(type => ({ id: type, type }));
    expect(sectionPlacementError(legacy, "jobs", 0)).toBe(PORTADA_FIRST);
    expect(sectionPlacementError(legacy, "hero", 0)).toBeNull();
    expect(sectionPlacementError(legacy, "story", 2)).toBeNull();
  });
});

describe("helpers", () => {
  it("moves one element and leaves the input untouched", () => {
    const list = ["a", "b", "c", "d"];
    expect(arrayMove(list, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(arrayMove(list, 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(list).toEqual(["a", "b", "c", "d"]);
    expect(clampIndex(-1, 4)).toBe(0);
    expect(clampIndex(9, 4)).toBe(3);
  });
  it("words every outcome with the final, 1-based position", () => {
    expect(dragMessages.end("moved", "Historia", 3, 1, 6)).toBe("Historia, posición 2 de 6.");
    expect(dragMessages.end("same", "Historia", 1, 1, 6)).toBe("Historia se queda en la posición 2 de 6.");
    expect(dragMessages.end("cancelled", "Historia", 1, 4, 6)).toBe("Movimiento cancelado. Historia se queda en la posición 2 de 6.");
    expect(dragMessages.end("blocked", "Cierre", 5, 0, 6, PORTADA_FIRST)).toBe("No se puede mover ahí: Portada siempre va primero. Cierre se queda en la posición 6 de 6.");
    expect(dragMessages.over("Cierre", 0, 6, PORTADA_FIRST, false)).toBe("Posición 1 no permitida: Portada siempre va primero.");
    expect(dragMessages.over("Cierre", 2, 6, null, true)).toMatch(/Fuera de la lista/);
  });
});
