import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { DraftBenefitsField } from "./draft-benefits-field";
import { BENEFITS } from "../lists";
import { benefitLabel } from "./draft-labels";

beforeEach(() => { vi.stubGlobal("PointerEvent", MouseEvent); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Harness({ initial = [], spy }: { initial?: string[]; spy?: (next: string[]) => void }) {
  const [selected, setSelected] = useState(initial);
  return <DraftBenefitsField selected={selected} onChange={next => { setSelected(next); spy?.(next); }} />;
}

describe("DraftBenefitsField", () => {
  it("is a labelled group of one checkbox row per catalog benefit, in catalog order, plus «Seleccionar todo»", () => {
    render(<Harness initial={[BENEFITS[1]]} />);
    const group = screen.getByRole("group", { name: "Prestaciones" });
    const rows = within(group).getAllByRole("checkbox");
    expect(rows.map(row => row.textContent)).toEqual(["Seleccionar todo1 de 8 elegidas", ...BENEFITS.map(benefitLabel)]);
    expect(within(group).getByRole("checkbox", { name: "Seleccionar todo" })).toBeInTheDocument();
    for (const code of BENEFITS) expect(within(group).getByRole("checkbox", { name: benefitLabel(code) })).toHaveAttribute("aria-checked", code === BENEFITS[1] ? "true" : "false");
    expect(group.querySelector("input[type='checkbox']:not([aria-hidden])")).toBeNull();
  });
  it("toggles one benefit keeping the submitted order and never adds unknown codes", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness initial={[BENEFITS[2], BENEFITS[0]]} spy={spy} />);
    await user.click(screen.getByRole("checkbox", { name: benefitLabel(BENEFITS[1]) }));
    expect(spy).toHaveBeenLastCalledWith([BENEFITS[2], BENEFITS[0], BENEFITS[1]]);
    await user.click(screen.getByRole("checkbox", { name: benefitLabel(BENEFITS[2]) }));
    expect(spy).toHaveBeenLastCalledWith([BENEFITS[0], BENEFITS[1]]);
    expect((spy.mock.lastCall?.[0] as string[]).every(code => (BENEFITS as readonly string[]).includes(code))).toBe(true);
  });
  it("selects and clears the whole catalog from the first row", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    await user.click(screen.getByRole("checkbox", { name: "Seleccionar todo" }));
    expect(spy).toHaveBeenLastCalledWith([...BENEFITS]);
    await user.click(screen.getByRole("checkbox", { name: "Seleccionar todo" }));
    expect(spy).toHaveBeenLastCalledWith([]);
  });
});
