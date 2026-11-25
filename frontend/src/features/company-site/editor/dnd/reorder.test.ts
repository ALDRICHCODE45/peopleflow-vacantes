import { describe, expect, it } from "vitest";
import { arrayMove, AUTO_SCROLL, canAutoScroll, clampIndex, dragMessages, insertionIndex, partedShift, pointerOutside, PORTADA_FIRST, rowShift, sectionPlacementError, type RowBox } from "./reorder";
import { canReorder } from "../../editor-state";
import { defaultBlock } from "../../defaults";
import type { BlockType } from "../../model";

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

describe("partedShift", () => {
  const all = [0, 1, 2, 3, 4];
  it("parts the rows exactly like rowShift while the landing slot is allowed", () => {
    expect(all.map(i => partedShift(rows, 3, 1, null, i))).toEqual(all.map(i => rowShift(rows, 3, 1, i)));
  });
  it("keeps every row at rest, the dragged one included, while the prospective slot is forbidden", () => {
    expect(all.map(i => partedShift(rows, 2, 0, PORTADA_FIRST, i))).toEqual([0, 0, 0, 0, 0]);
    expect(all.map(i => partedShift(rows, 0, 3, PORTADA_FIRST, i))).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("drop zone", () => {
  // The list's scroll container (the panel): rows, the space below them and «Agregar sección» all live inside it.
  const zone = { left: 0, top: 100, right: 280, bottom: 900 };
  it("counts the whole scroll container as inside, below the last row and over the add button included", () => {
    expect(pointerOutside({ x: 140, y: 880 }, zone)).toBe(false);
    expect(pointerOutside({ x: 140, y: 120 }, zone)).toBe(false);
    expect(pointerOutside({ x: 279, y: 500 }, zone)).toBe(false);
  });
  it("forgives a pointer a little past the panel's edges (auto-scroll overshoot, a shaky hand)", () => {
    expect(pointerOutside({ x: 140, y: 960 }, zone)).toBe(false);
    expect(pointerOutside({ x: 140, y: 50 }, zone)).toBe(false);
    expect(pointerOutside({ x: 295, y: 500 }, zone)).toBe(false);
  });
  it("only calls it outside once the pointer leaves the container sideways or goes far away", () => {
    expect(pointerOutside({ x: 340, y: 500 }, zone)).toBe(true);
    expect(pointerOutside({ x: -40, y: 500 }, zone)).toBe(true);
    expect(pointerOutside({ x: 140, y: 1100 }, zone)).toBe(true);
    expect(pointerOutside({ x: 140, y: -100 }, zone)).toBe(true);
  });
  it("lands below the last row at the last position and above the first at the first", () => {
    expect(insertionIndex(rows, 1, 260)).toBe(4);
    expect(insertionIndex(rows, 3, -20)).toBe(0);
  });
});

describe("auto-scroll", () => {
  const zone = { left: 0, top: 100, right: 280, bottom: 900 };
  it("is gentle: a narrow edge band and at most 500 px per second", () => {
    expect(AUTO_SCROLL.threshold.y).toBeLessThanOrEqual(0.12);
    expect(AUTO_SCROLL.threshold.x).toBe(0);
    expect(AUTO_SCROLL.acceleration * (1000 / AUTO_SCROLL.interval)).toBeLessThanOrEqual(500);
  });
  it("is bounded: it only scrolls a container while the pointer is inside it, never racing from beyond its edge", () => {
    expect(canAutoScroll({ x: 140, y: 890 }, zone)).toBe(true);
    expect(canAutoScroll({ x: 140, y: 105 }, zone)).toBe(true);
    expect(canAutoScroll({ x: 140, y: 920 }, zone)).toBe(false);
    expect(canAutoScroll({ x: 140, y: 80 }, zone)).toBe(false);
    expect(canAutoScroll({ x: 300, y: 500 }, zone)).toBe(false);
    expect(canAutoScroll(null, zone)).toBe(true);
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

describe("one placement rule", () => {
  const draft = (types: BlockType[]) => types.map(type => defaultBlock(type));
  it.each<[string, BlockType[]]>([
    ["a regular draft", ["hero", "story", "faq", "jobs", "closing"]],
    ["Vacantes right after Portada", ["hero", "jobs", "values", "gallery"]],
    ["a legacy order with Portada not first", ["story", "hero", "faq", "jobs"]],
    ["a legacy order with Vacantes above Portada", ["jobs", "story", "hero", "closing"]],
  ])("the list drag and the reducer agree on every (section, index) for %s", (_name, types) => {
    const blocks = draft(types);
    for (const block of blocks) for (let to = -1; to <= blocks.length; to++) {
      const inRange = to >= 0 && to < blocks.length;
      expect({ type: block.type, to, allowed: canReorder(blocks, block.id, to) }).toEqual({ type: block.type, to, allowed: inRange && sectionPlacementError(blocks, block.id, to) === null });
    }
  });
  it("forbids pushing a legacy, non-first Portada further down even without Vacantes involved", () => {
    const blocks = draft(["story", "hero", "faq"]);
    expect(canReorder(blocks, blocks[2].id, 0)).toBe(false);
    expect(sectionPlacementError(blocks, blocks[2].id, 0)).toBe(PORTADA_FIRST);
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
