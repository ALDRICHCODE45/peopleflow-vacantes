import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./actions", () => ({ listAuditEventsAction: vi.fn(), loadAuditOptionsAction: vi.fn() }));
vi.mock("@/components/ui/popover", async () => (await import("./test-popover")).popoverModule());
vi.mock("@/components/ui/select", async importOriginal => {
  const actual = await importOriginal<typeof import("@/components/ui/select")>();
  return { ...actual, SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});
import { listAuditEventsAction, loadAuditOptionsAction } from "./actions";
import { AuditWorkspace } from "./audit-workspace";
import { anaId, auditActors, auditEvent, auditPage, auditTypes, auditVacancies, luisId, vacancyId } from "./test-fixtures";

const list = vi.mocked(listAuditEventsAction);
const options = vi.mocked(loadAuditOptionsAction);
const okOptions = { ok: true as const, types: auditTypes, actors: auditActors, vacancies: auditVacancies };
const at = (search = "") => window.history.replaceState(null, "", `/empresa/auditoria${search}`);
const events = () => within(screen.getByRole("list", { name: "Eventos registrados" })).getAllByRole("listitem");
const filtersButton = () => screen.getByRole("button", { name: /^Filtros/ });
const sheet = (name: string) => screen.findByRole("dialog", { name });

/** `matches: true` for every query: the phone layout (< sm). */
function stubPhone(matches: boolean) {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches, media: "", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: () => false })));
}

beforeEach(() => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  // jsdom has no Web Animations; the drawer only asks whether something is animating.
  Object.defineProperty(HTMLElement.prototype, "getAnimations", { configurable: true, value: () => [] });
  vi.resetAllMocks();
  stubPhone(true);
  at();
  list.mockResolvedValue({ ok: true, data: auditPage([
    auditEvent(),
    auditEvent({ id: "50000000-0000-4000-8000-000000000002", event_type: "AuditLogExported", category: "audit", actor: { type: "user", user_id: luisId, name: "Luis Soto", email: "luis@empresa.mx", is_current_member: false }, entity: { type: "audit_log", id: "e", label: null }, vacancy: null }),
    auditEvent({ id: "50000000-0000-4000-8000-000000000003", entity: { type: "job_draft", id: vacancyId, label: "Ejecutivo de ventas" } }),
  ]) });
  options.mockResolvedValue(okOptions);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete (HTMLElement.prototype as { getAnimations?: unknown }).getAnimations; at(); });

describe("phone: events as cards", () => {
  it("replaces the sideways-scrolling table with one tappable card per event: action, who, when, «Sobre» and vacancy", async () => {
    const { container } = render(<AuditWorkspace />);
    await screen.findByRole("list", { name: "Eventos registrados" });
    expect(screen.queryByRole("table")).toBeNull();
    expect(container.querySelector("[data-audit-table]")).toBeNull();
    expect(screen.queryByRole("region", { name: "Tabla con desplazamiento horizontal" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Columnas" })).toBeNull();
    expect(events()).toHaveLength(3);
    const [first, former, vacancyItself] = events();
    expect(within(first).getByText("Inició la descarga de un CV")).toBeInTheDocument();
    expect(within(first).getByText("Ana López")).toBeInTheDocument();
    expect(within(first).getByText(/11:03:12/)).toBeInTheDocument();
    expect(within(first).getByText(/4 nov 2026/)).toBeInTheDocument();
    expect(within(first).getByText("María Pérez")).toBeInTheDocument();
    expect(within(first).getByText("Sobre ·")).toBeInTheDocument();
    expect(within(first).getByText("Ejecutivo de ventas")).toBeInTheDocument();
    expect(within(first).getByText("Vacante ·")).toBeInTheDocument();
    expect(within(former).getByText("Ex miembro")).toBeInTheDocument();
    // No label: the artboard shows a dash, as the table does.
    expect(within(former).getByText("—")).toBeInTheDocument();
    expect(within(former).queryByText("Sin etiqueta")).toBeNull();
    expect(within(former).queryByText("Vacante ·")).toBeNull();
    // «Sobre» repeats «Vacante» when the event is about the vacancy itself: only the vacancy line is shown.
    expect(within(vacancyItself).queryByText("Sobre ·")).toBeNull();
    expect(within(vacancyItself).getAllByText("Ejecutivo de ventas")).toHaveLength(1);
  });

  it("wraps long text (up to three lines, full text on hover) and gives each card a 44 px target that announces the detail", async () => {
    const title = "Supervisor de Producción Turno Nocturno — Planta Apodaca (reemplazo temporal por incapacidad)";
    list.mockResolvedValue({ ok: true, data: auditPage([auditEvent({ vacancy: { id: vacancyId, title } })]) });
    render(<AuditWorkspace />);
    const [card] = await waitFor(() => { const found = events(); expect(found).toHaveLength(1); return found; });
    const text = within(card).getByText(title);
    expect(text).toHaveClass("line-clamp-3", "[overflow-wrap:anywhere]");
    expect(text).toHaveAttribute("title", title);
    const button = within(card).getByRole("button");
    expect(button).toHaveClass("min-h-[76px]", "w-full");
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(button).toHaveAccessibleName(/^Ver el detalle: Inició la descarga de un CV, Ana López, /);
  });

  it("opens the existing detail sheet as a bottom sheet when a card is tapped and closes it back to the list", async () => {
    const user = userEvent.setup();
    render(<AuditWorkspace />);
    await screen.findByRole("list", { name: "Eventos registrados" });
    await user.click(within(events()[0]).getByRole("button"));
    const detail = await sheet("Inició la descarga de un CV");
    expect(detail).toHaveAttribute("data-side", "bottom");
    expect(detail).toHaveClass("data-[side=bottom]:rounded-t-3xl");
    expect(within(detail).getByText("201.141.12.7")).toBeInTheDocument();
    expect(within(detail).getByText("IP", { selector: "dt" })).toBeInTheDocument();
    await user.click(within(detail).getAllByRole("button", { name: "Cerrar" })[0]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("list", { name: "Eventos registrados" })).toBeInTheDocument();
  });

  it("loads with card-shaped skeletons and keeps the table's skeleton for desktop only", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof listAuditEventsAction>>) => void;
    list.mockReturnValue(new Promise(r => { resolve = r; }));
    const { container } = render(<AuditWorkspace />);
    expect(container.querySelector("[data-audit-skeleton=list]")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("[data-audit-skeleton=table]")).toBeNull();
    resolve({ ok: true, data: auditPage() });
    await screen.findByRole("list", { name: "Eventos registrados" });
    expect(container.querySelector("[data-audit-skeleton]")).toBeNull();
  });

  it("keeps the desktop table when the viewport is not a phone", async () => {
    stubPhone(false);
    const { container } = render(<AuditWorkspace />);
    await screen.findByRole("table");
    expect(screen.queryByRole("list", { name: "Eventos registrados" })).toBeNull();
    expect(container.querySelector("[data-audit-toolbar]")).toContainElement(screen.getByRole("button", { name: /^Persona(?!lizado)/ }));
    expect(screen.queryByRole("button", { name: /^Filtros/ })).toBeNull();
  });

  it("drops «Filas por página» on a phone and keeps the page controls", async () => {
    list.mockResolvedValue({ ok: true, data: auditPage([auditEvent()], { total: 120, next_cursor: "c1" }) });
    render(<AuditWorkspace />);
    await screen.findByRole("list", { name: "Eventos registrados" });
    const nav = screen.getByRole("navigation", { name: "Paginación" });
    expect(within(nav).queryByRole("combobox", { name: "Filas por página" })).toBeNull();
    expect(within(nav).getByText("Página 1 de 3")).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "Ir a la página siguiente" })).toBeEnabled();
  });
});

describe("phone: «Filtros (n)» and the date presets", () => {
  it("shows one «Filtros» button with the number of active filters and the date presets, instead of the desktop selectors", async () => {
    at(`?actor_id=${anaId}&event_type=SessionEnded&from=2026-11-18&to=2026-11-24`);
    const { container } = render(<AuditWorkspace />);
    await screen.findByRole("list", { name: "Eventos registrados" });
    const toolbar = container.querySelector("[data-audit-toolbar]") as HTMLElement;
    const button = within(toolbar).getByRole("button", { name: /^Filtros/ });
    expect(button).toHaveClass("min-h-11");
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(button).toHaveTextContent("3");
    for (const name of [/^Persona(?!lizado)/, /^Acción/, /^Vacante/]) expect(within(toolbar).queryByRole("button", { name })).toBeNull();
    const presets = within(toolbar).getByRole("group", { name: "Rango de fechas" });
    for (const label of ["Hoy", "7 días", "30 días", "Personalizado"]) expect(within(presets).getByRole("button", { name: label })).toBeInTheDocument();
    expect(within(toolbar).queryByRole("button", { name: "Restablecer vista" })).toBeNull();
  });

  it("applies a date preset straight from the bar, with no drawer", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-25T03:30:00Z"));
    const user = userEvent.setup();
    render(<AuditWorkspace />);
    await screen.findByRole("list", { name: "Eventos registrados" });
    await user.click(screen.getByRole("button", { name: "7 días" }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ filters: { from: "2026-11-18", to: "2026-11-24" }, limit: 50 }));
    expect(screen.getByRole("button", { name: "7 días" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(filtersButton()).toHaveTextContent("1");
    vi.useRealTimers();
  });

  it("opens «Personalizado» in the filters drawer with Desde and Hasta", async () => {
    const user = userEvent.setup();
    render(<AuditWorkspace />);
    await screen.findByRole("list", { name: "Eventos registrados" });
    await user.click(screen.getByRole("button", { name: "Personalizado" }));
    const drawer = await sheet("Filtros");
    expect(within(drawer).getByLabelText("Desde")).toBeInTheDocument();
    expect(within(drawer).getByLabelText("Hasta")).toBeInTheDocument();
    expect(within(drawer).getByText("Las fechas se cuentan en hora de la Ciudad de México.")).toBeInTheDocument();
  });

  it("keeps the chips above the list, wrapping, and removes one from there", async () => {
    at(`?actor_id=${luisId}&event_type=SessionEnded`);
    const user = userEvent.setup();
    render(<AuditWorkspace />);
    await screen.findByRole("list", { name: "Eventos registrados" });
    const chips = screen.getByRole("group", { name: "Filtros activos" });
    expect(chips).toHaveClass("flex-wrap");
    expect(chips.compareDocumentPosition(screen.getByRole("list", { name: "Eventos registrados" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await within(chips).findByText("Luis Soto (ex miembro)")).toBeInTheDocument();
    await user.click(within(chips).getByRole("button", { name: "Quitar filtro Acción: Cerró sesión" }));
    expect(new URLSearchParams(window.location.search).get("event_type")).toBeNull();
    expect(new URLSearchParams(window.location.search).get("actor_id")).toBe(luisId);
  });
});

describe("phone: result count, date pill and Escape", () => {
  it("keeps the result count and the ⓘ help on one row: the text takes the free width and the help never wraps below it", async () => {
    render(<AuditWorkspace />);
    await screen.findByRole("list", { name: "Eventos registrados" });
    const count = screen.getByText(/registrados en tu empresa/).closest("[role=status]") as HTMLElement;
    expect(count).toHaveClass("min-w-0", "flex-1");
    const row = count.parentElement as HTMLElement;
    expect(row).toHaveClass("flex-nowrap");
    expect(within(row).getByRole("button", { name: "¿Qué se registra?" })).toHaveClass("shrink-0");
    // The long tail goes on a phone; the artboard reads «N eventos · Más recientes primero».
    expect(screen.getByText(/registrados en tu empresa/)).toHaveClass("max-sm:hidden");
  });

  it("sizes the date presets by their text so «Personalizado» stays inside its pill, on the bar and in the drawer", async () => {
    const user = userEvent.setup();
    render(<AuditWorkspace />);
    await screen.findByRole("list", { name: "Eventos registrados" });
    for (const label of ["Hoy", "7 días", "30 días", "Personalizado"]) {
      expect(screen.getByRole("button", { name: label })).toHaveClass("flex-auto");
      expect(screen.getByRole("button", { name: label })).not.toHaveClass("flex-1");
    }
    await user.click(filtersButton());
    const drawer = await sheet("Filtros");
    expect(within(within(drawer).getByRole("group", { name: "Rango de fechas" })).getByRole("button", { name: "Personalizado" })).toHaveClass("flex-auto");
  });

  it("Escape inside a sub-panel goes back to the drawer's main view; Escape there closes the drawer", async () => {
    const user = userEvent.setup();
    render(<AuditWorkspace />);
    await screen.findByRole("list", { name: "Eventos registrados" });
    await user.click(filtersButton());
    await user.click(within(await sheet("Filtros")).getByRole("button", { name: /^Persona(?!lizado)/ }));
    await sheet("Persona");
    await user.keyboard("{Escape}");
    expect(await sheet("Filtros")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Persona" })).toBeNull();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Escape in the «Acción» sub-panel also returns to the main view and keeps what was chosen", async () => {
    const user = userEvent.setup();
    render(<AuditWorkspace />);
    await screen.findByRole("list", { name: "Eventos registrados" });
    await user.click(filtersButton());
    await user.click(within(await sheet("Filtros")).getByRole("button", { name: /^Acción/ }));
    const drawer = await sheet("Acción");
    await user.click(within(drawer).getByRole("checkbox", { name: "Cerró sesión" }));
    await user.keyboard("{Escape}");
    expect(within(await sheet("Filtros")).getByRole("button", { name: /^Acción/ })).toHaveTextContent("Cerró sesión");
  });

  it("returns focus to the filters button after removing the last chip, never to the body", async () => {
    at(`?event_type=SessionEnded`);
    const user = userEvent.setup();
    render(<AuditWorkspace />);
    await screen.findByRole("list", { name: "Eventos registrados" });
    await user.click(screen.getByRole("button", { name: "Quitar filtro Acción: Cerró sesión" }));
    expect(document.activeElement).not.toBe(document.body);
    expect(filtersButton()).toHaveFocus();
  });
});

describe("phone: the filters drawer", () => {
  it("opens a bottom drawer with Persona, Acción and Vacante rows that show their current value, and the date range", async () => {
    at(`?vacancy_id=${vacancyId}`);
    const user = userEvent.setup();
    render(<AuditWorkspace />);
    await screen.findByRole("list", { name: "Eventos registrados" });
    await user.click(filtersButton());
    const drawer = await sheet("Filtros");
    expect(drawer).toHaveAttribute("data-slot", "drawer-popup");
    expect(within(drawer).getByText("1 activo")).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: /^Persona(?!lizado)/ })).toHaveTextContent("Todas las personas");
    expect(within(drawer).getByRole("button", { name: /^Acción/ })).toHaveTextContent("Todas las acciones");
    await waitFor(() => expect(within(drawer).getByRole("button", { name: /^Vacante/ })).toHaveTextContent("Ejecutivo de ventas"));
    for (const row of [/^Persona(?!lizado)/, /^Acción/, /^Vacante/]) expect(within(drawer).getByRole("button", { name: row })).toHaveClass("min-h-16");
    expect(within(drawer).getByRole("group", { name: "Rango de fechas" })).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "Limpiar filtros" })).toBeInTheDocument();
  });

  it("picks a person in the same panel, comes back to the main view with the value and shows the chip once closed", async () => {
    const user = userEvent.setup();
    render(<AuditWorkspace />);
    await screen.findByRole("list", { name: "Eventos registrados" });
    await user.click(filtersButton());
    let drawer = await sheet("Filtros");
    expect(within(drawer).getByText("Ninguno activo")).toBeInTheDocument();
    await user.click(within(drawer).getByRole("button", { name: /^Persona(?!lizado)/ }));
    drawer = await sheet("Persona");
    expect(within(drawer).getByRole("searchbox", { name: "Buscar persona" })).toBeInTheDocument();
    await user.click(await within(drawer).findByRole("radio", { name: "Ana López" }));
    drawer = await sheet("Filtros");
    expect(within(drawer).getByRole("button", { name: /^Persona(?!lizado)/ })).toHaveTextContent("Ana López");
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ filters: { actor_id: anaId }, limit: 50 }));
    await user.click(within(drawer).getByRole("button", { name: /^Ver \d+ eventos?$/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(within(screen.getByRole("group", { name: "Filtros activos" })).getByText("Ana López")).toBeInTheDocument();
    expect(filtersButton()).toHaveTextContent("1");
  });

  it("keeps the arrow-key rule in the drawer: arrows move the person selection, «Aplicar» commits and returns", async () => {
    const user = userEvent.setup();
    render(<AuditWorkspace />);
    await screen.findByRole("list", { name: "Eventos registrados" });
    await user.click(filtersButton());
    await user.click(within(await sheet("Filtros")).getByRole("button", { name: /^Persona(?!lizado)/ }));
    const drawer = await sheet("Persona");
    const radio = await within(drawer).findByRole("radio", { name: "Todas las personas" });
    radio.focus();
    await user.keyboard("{ArrowDown}");
    expect(within(drawer).getByRole("radio", { name: "Ana López" })).toBeChecked();
    expect(screen.getByRole("dialog", { name: "Persona" })).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("actor_id")).toBeNull();
    await user.click(within(drawer).getByRole("button", { name: "Aplicar" }));
    expect((await sheet("Filtros"))).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("actor_id")).toBe(anaId);
  });

  it("chooses several actions in the drawer and goes back with «Listo»", async () => {
    const user = userEvent.setup();
    render(<AuditWorkspace />);
    await screen.findByRole("list", { name: "Eventos registrados" });
    await user.click(filtersButton());
    await user.click(within(await sheet("Filtros")).getByRole("button", { name: /^Acción/ }));
    const drawer = await sheet("Acción");
    await user.click(within(drawer).getByRole("checkbox", { name: "Cerró sesión" }));
    await user.click(within(drawer).getByRole("checkbox", { name: "Exportó la auditoría" }));
    expect(screen.getByRole("dialog", { name: "Acción" })).toBeInTheDocument();
    await user.click(within(drawer).getByRole("button", { name: "Listo" }));
    const main = await sheet("Filtros");
    expect(within(main).getByRole("button", { name: /^Acción/ })).toHaveTextContent("Cerró sesión");
    expect(within(main).getByRole("button", { name: /^Acción/ })).toHaveTextContent("Exportó la auditoría");
    expect(new URLSearchParams(window.location.search).getAll("event_type")).toEqual(["SessionEnded", "AuditLogExported"]);
  });

  it("goes back from a sub-view with the back button and clears everything from the drawer", async () => {
    at(`?actor_id=${anaId}&from=2026-11-01&to=2026-11-04`);
    const user = userEvent.setup();
    render(<AuditWorkspace />);
    await screen.findByRole("list", { name: "Eventos registrados" });
    await user.click(filtersButton());
    await user.click(within(await sheet("Filtros")).getByRole("button", { name: /^Vacante/ }));
    const sub = await sheet("Vacante");
    await user.click(within(sub).getByRole("button", { name: "Volver a Filtros" }));
    const main = await sheet("Filtros");
    await user.click(within(main).getByRole("button", { name: "Limpiar filtros" }));
    expect(window.location.search).toBe("");
    expect(within(await sheet("Filtros")).getByText("Ninguno activo")).toBeInTheDocument();
  });

  it("states how many events the filters show on the closing button", async () => {
    list.mockResolvedValue({ ok: true, data: auditPage([auditEvent()], { total: 1234 }) });
    const user = userEvent.setup();
    render(<AuditWorkspace />);
    await screen.findByRole("list", { name: "Eventos registrados" });
    await user.click(filtersButton());
    expect(within(await sheet("Filtros")).getByRole("button", { name: "Ver 1,234 eventos" })).toBeInTheDocument();
  });
});

describe("phone: export", () => {
  it("keeps «Exportar CSV» reachable and opens its panel as a bottom drawer that downloads with the range", async () => {
    at(`?actor_id=${anaId}&from=2026-11-01&to=2026-11-04`);
    const fetchMock = vi.fn().mockResolvedValue(new Response("﻿occurred_at\r\n", { headers: { "content-type": "text/csv", "content-disposition": 'attachment; filename="auditoria-2026-11-04.csv"' } }));
    vi.stubGlobal("fetch", fetchMock);
    URL.createObjectURL = vi.fn(() => "blob:audit"); URL.revokeObjectURL = vi.fn();
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this.download); });
    const user = userEvent.setup();
    render(<AuditWorkspace />);
    await screen.findByRole("list", { name: "Eventos registrados" });
    const trigger = screen.getByRole("button", { name: "Exportar CSV" });
    expect(trigger).toHaveClass("min-h-11", "max-sm:w-full");
    await user.click(trigger);
    const drawer = await sheet("Exportar a CSV");
    expect(drawer).toHaveAttribute("data-slot", "drawer-popup");
    const range = within(drawer).getByRole("group", { name: "Rango de la exportación" });
    expect(within(range).getByRole("button", { name: "Personalizado" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(drawer).getByRole("button", { name: "Descargar CSV" }));
    await waitFor(() => expect(clicked).toEqual(["auditoria-2026-11-04.csv"]));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ actor_id: anaId, from: "2026-11-01", to: "2026-11-04" });
    vi.restoreAllMocks();
  });
});
