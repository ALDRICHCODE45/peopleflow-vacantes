import type { ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { RichDataTable, type RichColumnDef } from "./rich-data-table";

// Drive only the DndContext boundary: real pointer collision geometry remains a browser QA check.
const driver = vi.hoisted(() => ({
  start: undefined as undefined | ((event: { active: { id: string } }) => void),
  over: undefined as undefined | ((event: { active: { id: string }; over: { id: string } | null }) => void),
  end: undefined as undefined | ((event: { active: { id: string }; over: { id: string } | null }) => void),
  cancel: undefined as undefined | (() => void),
}));
vi.mock("@dnd-kit/core", async importOriginal => ({
  ...await importOriginal<typeof import("@dnd-kit/core")>(),
  DndContext: ({ children, onDragStart, onDragOver, onDragEnd, onDragCancel }: {
    children: ReactNode; onDragStart: typeof driver.start; onDragOver: typeof driver.over; onDragEnd: typeof driver.end; onDragCancel: typeof driver.cancel;
  }) => { driver.start = onDragStart; driver.over = onDragOver; driver.end = onDragEnd; driver.cancel = onDragCancel; return <>{children}</>; },
  DragOverlay: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
const columns: RichColumnDef<{ id: string }>[] = [
  { id: "name", size: 240, meta: { label: "Nombre" }, cell: () => "Ana" },
  { id: "city", size: 170, meta: { label: "Ciudad" }, cell: () => "CDMX" },
  { id: "actions", size: 56, meta: { label: "Acciones" }, enablePinning: false, enableHiding: false, enableReorder: false },
];
beforeEach(() => localStorage.clear());
afterEach(cleanup);
const show = () => render(<RichDataTable id="drag" columns={columns} data={[{ id: "1" }]} getRowId={row => row.id} defaultPinning={{ start: [], end: ["actions"] }} emptyState="Sin resultados" />);
const saved = () => JSON.parse(localStorage.getItem("pf.table.drag")!);
it("previews the label, indicates the insertion edge, then reorders and persists on drop", () => {
  const { container } = show();
  act(() => driver.start?.({ active: { id: "name" } }));
  expect(container.querySelector('[data-drag-preview]')).toHaveTextContent("Nombre");
  act(() => driver.over?.({ active: { id: "name" }, over: { id: "city" } }));
  expect(screen.getByRole("columnheader", { name: "Ciudad" })).toHaveAttribute("data-drop-edge", "end");
  act(() => driver.end?.({ active: { id: "name" }, over: { id: "city" } }));
  expect(saved().order).toEqual(["city", "name", "actions"]);
  expect(container.querySelector('[data-drag-preview]')).toBeNull();
  expect(container.querySelector('[data-drop-edge]')).toBeNull();
});
it("indicates the start edge for a left move and clears drag feedback on cancellation", () => {
  const { container } = show();
  act(() => driver.start?.({ active: { id: "city" } }));
  act(() => driver.over?.({ active: { id: "city" }, over: { id: "name" } }));
  expect(screen.getByRole("columnheader", { name: "Nombre" })).toHaveAttribute("data-drop-edge", "start");
  act(() => driver.cancel?.());
  expect(saved().order).toEqual(["name", "city", "actions"]);
  expect(container.querySelector('[data-drag-preview]')).toBeNull();
  expect(container.querySelector('[data-drop-edge]')).toBeNull();
});
it("never indicates or accepts a pinned/fixed target or a drop outside the table", () => {
  const { container } = show();
  act(() => driver.start?.({ active: { id: "name" } }));
  act(() => driver.over?.({ active: { id: "name" }, over: { id: "actions" } }));
  expect(container.querySelector('[data-drop-edge]')).toBeNull();
  act(() => driver.end?.({ active: { id: "name" }, over: { id: "actions" } }));
  expect(saved().order).toEqual(["name", "city", "actions"]);
  act(() => driver.start?.({ active: { id: "city" } }));
  act(() => driver.over?.({ active: { id: "city" }, over: null }));
  act(() => driver.end?.({ active: { id: "city" }, over: null }));
  expect(saved().order).toEqual(["name", "city", "actions"]);
});
