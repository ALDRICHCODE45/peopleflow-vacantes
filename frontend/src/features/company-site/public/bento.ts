/** One bento card: desktop span on a 6-column grid (`col` × `row`) and whether it
 * takes the full row of the 2-column tablet grid. Phones always stack. */
export type BentoCell = { col: 2 | 3 | 4 | 6; row: 1 | 2; wide: boolean };

const cell = (col: BentoCell["col"], row: BentoCell["row"] = 1): BentoCell => ({ col, row, wide: false });
/** Hand-tuned mosaics from the approved design (02) for the common counts. */
const SMALL: Record<number, BentoCell[]> = {
  1: [cell(6)],
  2: [cell(3), cell(3)],
  3: [cell(3, 2), cell(3), cell(3)],
  4: [cell(4), cell(2), cell(2), cell(4)],
  5: [cell(3, 2), cell(3), cell(3), cell(3), cell(3)],
  6: [cell(4, 2), cell(2), cell(2), cell(2), cell(2), cell(2)],
};

/** The layout is chosen by item count so no desktop row is left half empty (a single
 * item spans the full row). From 7 items: the 6-item lead block, then rows of three,
 * closing with two halves (or two rows of halves) when the remainder needs it. */
export function bentoLayout(count: number): BentoCell[] {
  if (count <= 0) return [];
  const desktop = SMALL[count] ?? (() => {
    const rest = count - 3;
    const tail = rest % 3 === 2 ? 2 : rest % 3 === 1 ? 4 : 0;
    return [cell(4, 2), cell(2), cell(2), ...Array.from({ length: rest }, (_, index) => index >= rest - tail ? cell(3) : cell(2))];
  })();
  // Tablet: pairs, with the lead card on its own row when the count is odd.
  return desktop.map((item, index) => ({ ...item, wide: count === 1 || (count % 2 === 1 && index === 0) }));
}

const COL = { 2: "lg:col-span-2", 3: "lg:col-span-3", 4: "lg:col-span-4", 6: "lg:col-span-6" } as const;
/** Static class names (Tailwind must see each literal). */
export function bentoCellClass(item: BentoCell): string {
  return [COL[item.col], item.row === 2 && "lg:row-span-2", item.wide && "sm:col-span-2"].filter(Boolean).join(" ");
}
