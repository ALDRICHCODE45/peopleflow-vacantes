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
    DropdownMenuContent: ({ children }: { children: ReactNode }) => React.useContext(Context) ? <div role="menu">{children}</div> : null,
    DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div role="group">{children}</div>,
    DropdownMenuLabel: ({ children }: { children: ReactNode }) => <span>{children}</span>,
    DropdownMenuItem: ({ children, disabled, onClick }: ComponentProps<"button">) => <button role="menuitem" disabled={disabled} onClick={onClick}>{children}</button>,
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

it("shows the reorder hint as a description inside the column menu, next to the existing items", () => {
  render(<ColumnOrderControls stage={stage} order={order()} drag={drag} />);
  expect(screen.queryByText(hint)).not.toBeInTheDocument();
  open();
  const menu = screen.getByRole("menu");
  expect(menu).toHaveTextContent("Reordena columnas y revisa el impacto antes de guardar");
  expect(screen.getByRole("menuitem", { name: "Mover a la izquierda" })).toBeVisible();
  expect(screen.getByRole("menuitem", { name: "Mover a la derecha" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Orden de Screening" })).toHaveAttribute("id", "column-menu-screen");
});
it("leaves the hint out while a notice is shown", () => {
  render(<ColumnOrderControls stage={stage} order={order({ notice: { tone: "info", text: "Listo" } as never })} drag={drag} />);
  open();
  expect(screen.getByRole("menu")).not.toHaveTextContent(hint);
  expect(screen.getByRole("menuitem", { name: "Mover a la derecha" })).toBeVisible();
});
it("leaves the hint out while the columns are locked (busy, unavailable or finished)", () => {
  render(<ColumnOrderControls stage={stage} order={order({ locked: true })} drag={drag} />);
  open();
  expect(screen.queryByText(hint)).not.toBeInTheDocument();
});
it.each([[0, "Nuevos: posición fija"], [3, "Placement: posición fija"]])("marks a fixed column with a focusable image that has a text alternative (a named span needs a role for axe): %s", (index, name) => {
  render(<ColumnOrderControls stage={{ ...stages[index], count: 0 } as unknown as Board["stages"][number]} order={order()} drag={drag} />);
  expect(screen.getByRole("img", { name })).toHaveAttribute("tabindex", "0");
});
