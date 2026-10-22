import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { RichDataTable, type RichColumnDef } from "@/components/data-table/rich-data-table";
import { TruncatedText } from "./truncated-text";
vi.mock("@/components/ui/dropdown-menu", async () => (await import("./test-menu")).menuDouble);
vi.mock("@/components/ui/tooltip", async () => (await import("./test-menu")).tooltipDouble);

type Person = { id: string; name: string };
const columns: RichColumnDef<Person>[] = [
  { id: "name", accessorKey: "name", size: 240, meta: { label: "Nombre" } },
  { id: "city", cell: () => "Ciudad", size: 170, meta: { label: "Ciudad" } },
  { id: "actions", cell: () => "Acciones", size: 80, meta: { label: "Acciones" }, enablePinning: false, enableHiding: false, enableReorder: false },
];
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const show = () => render(<RichDataTable id="test" columns={columns} data={[{ id: "1", name: "Ana" }]} getRowId={(row: Person) => row.id} defaultPinning={{ start: [], end: ["actions"] }} emptyState="Sin resultados" />);
const saved = () => JSON.parse(localStorage.getItem("pf.table.test")!);
async function menu(label = "Nombre") { await userEvent.click(screen.getByRole("button", { name: `Opciones de ${label}` })); }
it("pins and unpins with real widths, writing storage", async () => {
  show(); await menu();
  await userEvent.click(screen.getByRole("menuitem", { name: "Fijar a la izquierda" }));
  await waitFor(() => expect(saved().pinning.start).toEqual(["name"]));
  expect(screen.getByRole("columnheader", { name: /Nombre/u })).toHaveStyle({ position: "sticky", left: "0px", width: "240px" });
  await menu(); await userEvent.click(screen.getByRole("menuitem", { name: "Desfijar" }));
  await waitFor(() => expect(saved().pinning.start).toEqual([]));
  await menu(); await userEvent.click(screen.getByRole("menuitem", { name: "Fijar a la derecha" }));
  await waitFor(() => expect(saved().pinning.end).toEqual(["actions", "name"]));
  expect(screen.getByRole("columnheader", { name: /Acciones/u })).toHaveStyle({ right: "240px" });
});
it("moves columns using the keyboard menu alternative and hides/restores them", async () => {
  show(); await menu();
  const move = screen.getByRole("menuitem", { name: "Mover a la derecha" });
  move.focus(); await userEvent.keyboard("{Enter}");
  await waitFor(() => expect(saved().order).toEqual(["city", "name", "actions"]));
  expect(screen.getAllByRole("columnheader")[0]).toHaveTextContent("Ciudad");
  await menu(); await userEvent.click(screen.getByRole("menuitem", { name: "Mover a la izquierda" }));
  await waitFor(() => expect(saved().order[0]).toBe("name"));
  await menu(); await userEvent.click(screen.getByRole("menuitem", { name: "Ocultar columna" }));
  await waitFor(() => expect(saved().visibility.name).toBe(false));
  expect(screen.queryByRole("columnheader", { name: /Nombre/u })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Columnas/u }));
  expect(screen.queryByRole("menuitemcheckbox", { name: "Acciones" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Nombre" }));
  await userEvent.keyboard("{Escape}");
  await userEvent.click(screen.getByRole("button", { name: "Restablecer vista" }));
  expect(saved().order).toEqual(["name", "city", "actions"]);
});
it("omits configuration and drag controls for fixed/action columns", () => {
  show();
  expect(screen.queryByRole("button", { name: "Opciones de Acciones" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Arrastrar Acciones" })).not.toBeInTheDocument();
});
it("drags from the label, reserves the menu width and gives the header only its label as accessible name", () => {
  show();
  const header = screen.getByRole("columnheader", { name: "Nombre" });
  const label = header.querySelector('[data-header-label]')!;
  expect(label).toHaveClass("truncate", "cursor-grab");
  expect(label).not.toHaveAttribute("role", "button");
  expect(screen.queryByRole("button", { name: "Arrastrar Nombre" })).not.toBeInTheDocument();
  const controls = header.querySelector('[data-header-controls]')!;
  expect(controls).toHaveClass("shrink-0", "opacity-0", "group-hover/header:opacity-100", "group-focus-within/header:opacity-100");
  expect(controls).not.toHaveClass("absolute");
  expect(screen.getByRole("button", { name: "Opciones de Nombre" })).toBeInTheDocument();
});
it("groups icon-labelled pin/move/hide menu items and marks pinned headers", async () => {
  show(); await menu();
  expect(screen.getAllByRole("separator")).toHaveLength(2);
  expect(screen.getAllByRole("group")).toHaveLength(3);
  for (const item of screen.getAllByRole("menuitem")) expect(item.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  await userEvent.click(screen.getByRole("menuitem", { name: "Fijar a la izquierda" }));
  expect(screen.getByRole("columnheader", { name: "Nombre" }).querySelector('[data-pinned-indicator]')).toHaveClass("text-muted-foreground");
});
it("disables reset only when the effective layout matches defaults", async () => {
  show();
  const reset = screen.getByRole("button", { name: "Restablecer vista" });
  expect(reset).toBeDisabled();
  await menu(); await userEvent.click(screen.getByRole("menuitem", { name: "Ocultar columna" }));
  expect(reset).toBeEnabled();
  await userEvent.click(screen.getByRole("button", { name: /Columnas/u }));
  await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Nombre" }));
  expect(reset).toBeDisabled();
});
it("grows exactly one visible column to fill the viewport and keeps pinned offsets in sync", async () => {
  const growing = columns.map(column => ({ ...column, meta: { ...column.meta, grow: column.id === "city" } }));
  render(<RichDataTable id="test" columns={growing} data={[]} getRowId={(row: Person) => row.id} defaultPinning={{ start: [], end: ["actions"] }} emptyState="Vacío" />);
  const viewport = screen.getByRole("region", { name: "Tabla con desplazamiento horizontal" });
  Object.defineProperty(viewport, "clientWidth", { value: 800, configurable: true });
  fireEvent(window, new Event("resize"));
  expect(screen.getByRole("table")).toHaveStyle({ width: "800px" });
  expect(screen.getByRole("columnheader", { name: "Nombre" })).toHaveStyle({ width: "240px" });
  expect(screen.getByRole("columnheader", { name: "Ciudad" })).toHaveStyle({ width: "480px" });
  await menu("Ciudad"); await userEvent.click(screen.getByRole("menuitem", { name: "Fijar a la derecha" }));
  expect(screen.getByRole("columnheader", { name: "Acciones" })).toHaveStyle({ right: "480px" });
  await menu("Ciudad"); await userEvent.click(screen.getByRole("menuitem", { name: "Ocultar columna" }));
  expect(screen.getByRole("table")).toHaveStyle({ width: "800px" });
  expect(screen.getByRole("columnheader", { name: "Nombre" })).toHaveStyle({ width: "720px" });
  Object.defineProperty(viewport, "clientWidth", { value: 200, configurable: true });
  fireEvent(window, new Event("resize"));
  expect(screen.getByRole("table")).toHaveStyle({ width: "320px" });
  expect(screen.getByRole("columnheader", { name: "Nombre" })).toHaveStyle({ width: "240px" });
});
it("repairs persisted preferences that hide or unpin fixed columns", () => {
  localStorage.setItem("pf.table.test", JSON.stringify({ v: 1, order: ["name", "city"], pinning: { start: [], end: [] }, visibility: { actions: false } }));
  show();
  expect(screen.getByRole("columnheader", { name: /Acciones/u })).toHaveAttribute("data-pinned", "end");
  expect(saved().pinning.end).toEqual(["actions"]);
  expect(saved().visibility.actions).not.toBe(false);
});
it("uses actual visible pinned widths and shows edge shadows only on the scrolled-under edge", async () => {
  localStorage.setItem("pf.table.test", JSON.stringify({ v: 1, order: ["name", "city", "actions"], pinning: { start: ["name", "city"], end: ["actions"] }, visibility: {} }));
  show();
  const city = screen.getByRole("columnheader", { name: /Ciudad/u });
  expect(city).toHaveStyle({ left: "240px" });
  const scroll = screen.getByRole("region", { name: "Tabla con desplazamiento horizontal" });
  Object.defineProperties(scroll, { scrollWidth: { value: 900 }, clientWidth: { value: 400 }, scrollLeft: { value: 0, writable: true } });
  fireEvent.scroll(scroll);
  expect(city).not.toHaveAttribute("data-shadow");
  expect(screen.getByRole("columnheader", { name: /Acciones/u })).toHaveAttribute("data-shadow", "end");
  scroll.scrollLeft = 500; fireEvent.scroll(scroll);
  expect(city).toHaveAttribute("data-shadow", "start");
  expect(screen.getByRole("columnheader", { name: /Acciones/u })).not.toHaveAttribute("data-shadow");
  await menu(); await userEvent.click(screen.getByRole("menuitem", { name: "Ocultar columna" }));
  expect(city).toHaveStyle({ left: "0px" });
});
it.each([false, true])("reveals full text only when overflowing (%s), including keyboard focus", async overflow => {
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(overflow ? 200 : 80);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
  render(<TruncatedText text="Un texto completo" />);
  const text = screen.getByText("Un texto completo");
  expect(text).toHaveClass("truncate");
  if (overflow) { fireEvent.focus(text); expect(await screen.findByRole("tooltip")).toHaveTextContent("Un texto completo"); }
  else { fireEvent.mouseEnter(text); expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(); expect(text).not.toHaveAttribute("tabindex"); }
});
it("rechecks overflow when resized", async () => {
  let width = 200;
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
  render(<TruncatedText text="Texto" />);
  expect(screen.getByText("Texto")).toHaveAttribute("tabindex", "0");
  width = 80; fireEvent(window, new Event("resize"));
  await waitFor(() => expect(screen.getByText("Texto")).not.toHaveAttribute("tabindex"));
});
