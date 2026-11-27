import type { ComponentProps, ReactElement, ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { editorFromPipeline } from "@/features/jobs/drafts/pipeline/editor-model";
import { ColumnOrderControls } from "./column-order-controls";
import type { BoardColumnOrder } from "./use-board-column-order";
import type { Board } from "./model";

// Only the portal boundary is replaced: the menu content and its callbacks are the product's.
vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  const Context = React.createContext(false);
  return {
    DropdownMenu: ({ children }: { children: ReactNode }) => { const [open, setOpen] = React.useState(false); return <Context.Provider value={open}><div onClick={() => setOpen(true)}>{children}</div></Context.Provider>; },
    DropdownMenuTrigger: ({ render, children }: { render: ReactElement; children: ReactNode }) => React.cloneElement(render, { "aria-haspopup": "menu", children } as ComponentProps<"button">),
    DropdownMenuContent: ({ children, className }: { children: ReactNode; className?: string }) => React.useContext(Context) ? <div role="menu" className={className}>{children}</div> : null,
    DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div role="group">{children}</div>,
    DropdownMenuLabel: ({ children }: { children: ReactNode }) => <span>{children}</span>,
    DropdownMenuItem: ({ children, disabled, onClick, className }: ComponentProps<"button">) => <button role="menuitem" className={className} disabled={disabled} onClick={onClick}>{children}</button>,
  };
});
afterEach(cleanup);

const stages = [
  { id: "new", kind: "new", name: "Nuevos" }, { id: "screen", kind: "screening", name: "Screening" },
  { id: "ok", kind: "screening_ok", name: "Screening OK" }, { id: "hire", kind: "placement", name: "Placement" },
] as const;
const stage = { ...stages[1], count: 0 } as unknown as Board["stages"][number];
const drag = { attributes: {}, listeners: {}, setActivatorNodeRef: () => {} } as never;
const hint = /Reordena columnas y revisa el impacto antes de guardar/;
function order(overrides: Partial<BoardColumnOrder> = {}) {
  const editor = editorFromPipeline({ version: "1", structure_locked: false, stages: stages.map(item => ({ ...item })), exit: { id: "exit", kind: "discarded", name: "Descartados" }, limits: { maxCustomStages: 5, nameMaxLength: 80 } } as never);
  return { editor, locked: false, notice: null, unavailable: false, busy: false, move: vi.fn(), ...overrides } as unknown as BoardColumnOrder;
}
const open = () => fireEvent.click(screen.getByRole("button", { name: "Orden de Screening" }));

// S3 (U3): the menu carries no explanation, and each item stays on one line.
it("S3: the column menu has no explanation text, only «Mover a la izquierda» and «Mover a la derecha», each on one line", () => {
  render(<ColumnOrderControls stage={stage} order={order()} drag={drag} />);
  open();
  const menu = screen.getByRole("menu");
  expect(menu).not.toHaveTextContent(hint);
  expect(screen.getAllByRole("menuitem").map(item => item.textContent)).toEqual(["Mover a la izquierda", "Mover a la derecha"]);
  for (const item of screen.getAllByRole("menuitem")) {
    expect(item).toHaveClass("whitespace-nowrap", "min-h-10");
    expect(item.querySelector("svg")).not.toBeNull();
  }
  // The content sizes to its items instead of to the 40 px trigger.
  expect(menu).toHaveClass("w-auto");
  expect(screen.getByRole("button", { name: "Orden de Screening" })).toHaveAttribute("id", "column-menu-screen");
});
it.each([
  ["a notice", { notice: { tone: "info", text: "Listo" } }],
  ["locked columns", { locked: true }],
] as const)("S3: no explanation text with %s either", (_name, overrides) => {
  render(<ColumnOrderControls stage={stage} order={order(overrides as never)} drag={drag} />);
  open();
  expect(screen.queryByText(hint)).not.toBeInTheDocument();
});
it("moves the column one step left or right, and disables the move past an edge column", () => {
  const current = order();
  render(<ColumnOrderControls stage={stage} order={current} drag={drag} />);
  open();
  expect(screen.getByRole("menuitem", { name: "Mover a la izquierda" })).toBeDisabled(); // Nuevos is fixed on its left
  fireEvent.click(screen.getByRole("menuitem", { name: "Mover a la derecha" }));
  expect(current.move).toHaveBeenCalledWith("screen", 2);
});
it.each([[0, "Nuevos: posición fija"], [3, "Placement: posición fija"]])("marks a fixed column with a focusable image that has a text alternative (a named span needs a role for axe): %s", (index, name) => {
  render(<ColumnOrderControls stage={{ ...stages[index], count: 0 } as unknown as Board["stages"][number]} order={order()} drag={drag} />);
  expect(screen.getByRole("img", { name })).toHaveAttribute("tabindex", "0");
});
