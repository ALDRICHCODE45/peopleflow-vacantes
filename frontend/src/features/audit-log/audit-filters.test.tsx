import { useState } from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/components/ui/popover", async () => (await import("./test-popover")).popoverModule());
import { AuditFiltersBar } from "./audit-filters";
import type { AuditOptions } from "./model";
import { anaId, auditActors, auditTypes, auditVacancies, deletedVacancyId, luisId, vacancyId } from "./test-fixtures";
import { normalizeFilters, type AuditFilters } from "./url-state";

const carlosId = "10000000-0000-4000-8000-000000000009";
const longName = "Carlos Eduardo Ramírez Tamez";
const longVacancyId = "40000000-0000-4000-8000-000000000009";
const longTitle = "Supervisor de Producción Turno Nocturno — Planta Apodaca (reemplazo temporal por incapacidad)";
const options: AuditOptions = {
  types: [...auditTypes, { event_type: "CompanyCandidateViewed", category: "sensitive_read" }],
  actors: [...auditActors, { user_id: carlosId, name: longName, email: "carlos@empresa.mx", is_current_member: false }],
  vacancies: [...auditVacancies, { vacancy_id: longVacancyId, title: longTitle }],
};

const onChange = vi.fn();
const onClear = vi.fn();
const onRetry = vi.fn();
/** Controlled the way the workspace does it: the patch merges into the filters and is normalized like the URL. */
function Harness({ initial = {}, withOptions = options, failed = false }: { initial?: AuditFilters; withOptions?: AuditOptions | null; failed?: boolean }) {
  const [filters, setFilters] = useState<AuditFilters>(initial);
  return <AuditFiltersBar filters={filters} options={withOptions} optionsFailed={failed} onRetryOptions={onRetry}
    onChange={patch => { onChange(patch); setFilters(current => normalizeFilters({ ...current, ...patch })); }}
    onClear={() => { onClear(); setFilters({}); }} />;
}
const setup = (props: Parameters<typeof Harness>[0] = {}) => { render(<Harness {...props} />); return userEvent.setup(); };
const open = async (user: ReturnType<typeof userEvent.setup>, name: RegExp) => { await user.click(screen.getByRole("button", { name })); return screen.findByRole("dialog"); };

beforeEach(() => { vi.stubGlobal("PointerEvent", MouseEvent); vi.clearAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-25T03:30:00Z")); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("person panel", () => {
  it("shows every name in full (wrapping, never truncated) with «Ex miembro» as a quiet secondary badge and the email under it", async () => {
    const user = setup();
    const panel = await open(user, /^Persona(?!lizado)/);
    expect(panel).toHaveAttribute("aria-label", "Filtrar por persona");
    const name = within(panel).getByText(longName);
    expect(name.className).not.toMatch(/truncate|line-clamp|text-ellipsis/);
    expect(name.className).toContain("[overflow-wrap:anywhere]");
    expect(within(panel).getByRole("radio", { name: longName })).toBeInTheDocument();
    expect(within(panel).getByText("carlos@empresa.mx")).toBeInTheDocument();
    expect(within(panel).getAllByText("Ex miembro")).toHaveLength(2);
    expect(within(panel).queryByText(/\(ex miembro\)/)).toBeNull();
    expect(within(panel).getByRole("radio", { name: "Todas las personas" })).toBeChecked();
    expect(within(panel).getByText("3 de 3 personas · incluye a quienes ya no son miembros")).toBeInTheDocument();
  });

  it("searches by name or email, ignoring accents and case, and explains an empty search", async () => {
    const user = setup();
    const panel = await open(user, /^Persona(?!lizado)/);
    const search = within(panel).getByRole("searchbox", { name: "Buscar persona" });
    await user.type(search, "LOPEZ");
    expect(within(panel).getAllByRole("radio")).toHaveLength(1);
    expect(within(panel).getByRole("radio", { name: "Ana López" })).toBeInTheDocument();
    await user.clear(search); await user.type(search, "luis@");
    expect(within(panel).getByRole("radio", { name: "Luis Soto" })).toBeInTheDocument();
    expect(within(panel).queryByRole("radio", { name: "Ana López" })).toBeNull();
    await user.clear(search); await user.type(search, "zzz");
    expect(within(panel).getByText("Sin coincidencias para «zzz».")).toBeInTheDocument();
    expect(within(panel).queryAllByRole("radio")).toHaveLength(0);
  });

  it("picks a person: patches actor_id, closes the panel, counts it on the selector and adds a chip with «(ex miembro)»", async () => {
    const user = setup();
    const panel = await open(user, /^Persona(?!lizado)/);
    await user.click(within(panel).getByRole("radio", { name: longName }));
    expect(onChange).toHaveBeenCalledWith({ actor_id: carlosId });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /^Persona(?!lizado)/ })).toHaveTextContent("1");
    const chips = screen.getByRole("group", { name: "Filtros activos" });
    expect(within(chips).getByText(`${longName} (ex miembro)`)).toBeInTheDocument();
    const panelAgain = await open(user, /^Persona(?!lizado)/);
    await user.click(within(panelAgain).getByRole("radio", { name: "Todas las personas" }));
    expect(onChange).toHaveBeenLastCalledWith({ actor_id: undefined });
    expect(screen.queryByRole("group", { name: "Filtros activos" })).toBeNull();
  });

  it("keeps a person from the URL selectable while the catalogs are not loaded", async () => {
    const user = setup({ initial: { actor_id: luisId }, withOptions: null, failed: true });
    expect(screen.getByRole("group", { name: "Filtros activos" })).toHaveTextContent("Persona seleccionada");
    const panel = await open(user, /^Persona(?!lizado)/);
    expect(within(panel).getByRole("radio", { name: "Persona seleccionada" })).toBeChecked();
  });
});

describe("single-choice panels: arrow keys move, Enter / click / «Aplicar» commit", () => {
  const radio = (panel: HTMLElement, name: string) => within(panel).getByRole("radio", { name });

  it("moves the person selection with the arrow keys without patching or closing, and Enter applies it and closes", async () => {
    const user = setup();
    const panel = await open(user, /^Persona(?!lizado)/);
    radio(panel, "Todas las personas").focus();
    await user.keyboard("{ArrowDown}");
    expect(radio(panel, "Ana López")).toBeChecked();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{ArrowDown}");
    expect(radio(panel, "Luis Soto")).toBeChecked();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Persona(?!lizado)/ })).not.toHaveTextContent("1");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ actor_id: luisId });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /^Persona(?!lizado)/ })).toHaveTextContent("1");
  });

  it("applies the person chosen with the arrow keys from the explicit «Aplicar» button", async () => {
    const user = setup();
    const panel = await open(user, /^Persona(?!lizado)/);
    radio(panel, "Todas las personas").focus();
    await user.keyboard("{ArrowDown}");
    expect(onChange).not.toHaveBeenCalled();
    await user.click(within(panel).getByRole("button", { name: "Aplicar" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ actor_id: anaId });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("moves the vacancy selection with the arrow keys without closing and applies it with Enter or «Aplicar»", async () => {
    const user = setup();
    let panel = await open(user, /^Vacante/);
    radio(panel, "Todas las vacantes").focus();
    await user.keyboard("{ArrowDown}");
    expect(radio(panel, "Ejecutivo de ventas")).toBeChecked();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ vacancy_id: vacancyId });
    expect(screen.queryByRole("dialog")).toBeNull();
    panel = await open(user, /^Vacante/);
    radio(panel, "Ejecutivo de ventas").focus();
    await user.keyboard("{ArrowDown}");
    expect(onChange).toHaveBeenCalledTimes(1);
    await user.click(within(panel).getByRole("button", { name: "Aplicar" }));
    expect(onChange).toHaveBeenLastCalledWith({ vacancy_id: deletedVacancyId });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("still commits and closes at once on a click", async () => {
    const user = setup();
    const panel = await open(user, /^Vacante/);
    await user.click(radio(panel, "Ejecutivo de ventas"));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ vacancy_id: vacancyId });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("single-choice panels: keyboard from the search", () => {
  const radio = (panel: HTMLElement, name: string) => within(panel).getByRole("radio", { name });

  it("ArrowDown from the person search moves into the list: onto the chosen row, or the first match once the search narrows it", async () => {
    const user = setup();
    const panel = await open(user, /^Persona(?!lizado)/);
    const search = within(panel).getByRole("searchbox", { name: "Buscar persona" });
    search.focus();
    await user.keyboard("{ArrowDown}");
    expect(radio(panel, "Todas las personas")).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
    search.focus();
    await user.type(search, "luis");
    await user.keyboard("{ArrowDown}");
    expect(radio(panel, "Luis Soto")).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ actor_id: luisId });
  });

  it("Enter in the person search commits the first match and closes the panel", async () => {
    const user = setup();
    const panel = await open(user, /^Persona(?!lizado)/);
    await user.type(within(panel).getByRole("searchbox", { name: "Buscar persona" }), "carlos{Enter}");
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ actor_id: carlosId });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Enter in the vacancy search commits the first match, and does nothing when nothing matches", async () => {
    const user = setup();
    const panel = await open(user, /^Vacante/);
    const search = within(panel).getByRole("searchbox", { name: "Buscar vacante" });
    await user.type(search, "zzz{Enter}");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, "apodaca{Enter}");
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ vacancy_id: longVacancyId });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows an initials avatar on every person row, and the users icon on «Todas las personas»", async () => {
    const user = setup();
    const panel = await open(user, /^Persona(?!lizado)/);
    expect(within(panel).getByText("AL")).toHaveAttribute("data-slot", "avatar-fallback");
    expect(within(panel).getByText("LS")).toHaveAttribute("data-slot", "avatar-fallback");
    expect(within(panel).getByText("CE")).toBeInTheDocument();
    expect(within(radio(panel, "Todas las personas")).queryByText(/^[A-Z]{2}$/)).toBeNull();
    expect(radio(panel, "Todas las personas").querySelector("[data-slot=avatar] svg")).not.toBeNull();
  });
});

describe("action panel", () => {
  it("groups the actions by category, searches them and counts how many are chosen per group", async () => {
    const user = setup({ initial: { event_type: ["SessionEnded"] } });
    const panel = await open(user, /^Acción/);
    expect(panel).toHaveAttribute("aria-label", "Filtrar por acción");
    for (const group of [/^Sesiones/, /^Consultas sensibles/, /^Auditoría/]) expect(within(panel).getByRole("group", { name: group })).toBeInTheDocument();
    expect(within(within(panel).getByRole("group", { name: /^Sesiones/ })).getByRole("checkbox", { name: "Cerró sesión" })).toBeChecked();
    expect(within(panel).getByRole("group", { name: /^Sesiones/ })).toHaveAccessibleName("Sesiones 1 de 2");
    await user.type(within(panel).getByRole("searchbox", { name: "Buscar acción" }), "descarga");
    expect(within(panel).getByRole("checkbox", { name: "Inició la descarga de un CV" })).toBeInTheDocument();
    expect(within(panel).queryByRole("checkbox", { name: "Cerró sesión" })).toBeNull();
    expect(within(panel).queryByRole("group", { name: /^Sesiones/ })).toBeNull();
  });

  it("toggles several actions without closing, patches event_type and shows one removable chip per action", async () => {
    const user = setup();
    const panel = await open(user, /^Acción/);
    await user.click(within(panel).getByRole("checkbox", { name: "Cerró sesión" }));
    await user.click(within(panel).getByRole("checkbox", { name: "Exportó la auditoría" }));
    expect(onChange).toHaveBeenLastCalledWith({ event_type: ["SessionEnded", "AuditLogExported"] });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Acción/ })).toHaveTextContent("2");
    expect(within(panel).getByText("2 acciones elegidas")).toBeInTheDocument();
    const chips = screen.getByRole("group", { name: "Filtros activos" });
    expect(within(chips).getByText("Cerró sesión")).toBeInTheDocument();
    expect(within(chips).getByText("Exportó la auditoría")).toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: "Limpiar acciones" }));
    expect(onChange).toHaveBeenLastCalledWith({ event_type: undefined });
  });

  it("chooses a whole category from a compact «Elegir todas» link in the group heading and shows it as one category chip", async () => {
    const user = setup();
    const panel = await open(user, /^Acción/);
    const sessions = within(panel).getByRole("group", { name: /^Sesiones/ });
    // No full-width «Seleccionar todo» row any more: the link sits in the heading (artboard audit-log-redesign/01).
    expect(within(panel).queryByRole("checkbox", { name: "Seleccionar todo" })).toBeNull();
    const link = within(panel).getByRole("button", { name: "Elegir todas las acciones de Sesiones" });
    expect(link).toHaveTextContent("Elegir todas");
    expect(link.closest("[data-audit-group-heading]")).toHaveTextContent("Sesiones");
    expect(link.closest("[data-audit-group-heading]")).toHaveTextContent("0 de 2");
    await user.click(link);
    expect(onChange).toHaveBeenLastCalledWith({ event_type: ["SessionStarted", "SessionEnded"] });
    expect(within(sessions).getAllByRole("checkbox").every(box => box.getAttribute("aria-checked") === "true")).toBe(true);
    const chips = screen.getByRole("group", { name: "Filtros activos" });
    expect(within(chips).getByText("Sesiones (2 acciones)")).toBeInTheDocument();
    const undo = within(panel).getByRole("button", { name: "Quitar todas las acciones de Sesiones" });
    expect(undo).toHaveTextContent("Quitar todas");
    await user.click(undo);
    expect(onChange).toHaveBeenLastCalledWith({ event_type: undefined });
    expect(screen.queryByRole("group", { name: "Filtros activos" })).toBeNull();
  });

  it("«Elegir todas» completes a partly chosen category and keeps the other categories as they were", async () => {
    const user = setup({ initial: { event_type: ["SessionEnded", "AuditLogExported"] } });
    const panel = await open(user, /^Acción/);
    await user.click(within(panel).getByRole("button", { name: "Elegir todas las acciones de Sesiones" }));
    expect(onChange).toHaveBeenLastCalledWith({ event_type: ["AuditLogExported", "SessionStarted", "SessionEnded"] });
  });

  it("has one tab stop for the whole list: the arrow keys move between options across groups, Home and End jump, Space toggles", async () => {
    const user = setup();
    const panel = await open(user, /^Acción/);
    const boxes = within(panel).getAllByRole("checkbox");
    expect(boxes).toHaveLength(5);
    expect(boxes.filter(box => box.tabIndex === 0)).toHaveLength(1);
    boxes[0].focus();
    await user.keyboard("{ArrowDown}");
    expect(boxes[1]).toHaveFocus();
    expect(boxes.map(box => box.tabIndex)).toEqual([-1, 0, -1, -1, -1]);
    await user.keyboard("{ArrowDown}");
    expect(boxes[2]).toHaveFocus(); // first option of the next group
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(boxes[0]).toHaveFocus();
    await user.keyboard("{End}");
    expect(boxes[4]).toHaveFocus();
    await user.keyboard("{Home}");
    expect(boxes[0]).toHaveFocus();
    await user.keyboard("{ArrowDown}{ArrowDown} ");
    expect(onChange).toHaveBeenLastCalledWith({ event_type: ["CompanyCandidateCVDownloaded"] });
    expect(boxes[2]).toHaveAttribute("aria-checked", "true");
    await user.keyboard(" ");
    expect(onChange).toHaveBeenLastCalledWith({ event_type: undefined });
    // The tab stop follows the focus, so Shift+Tab / Tab do not walk 76 rows.
    expect(boxes.filter(box => box.tabIndex === 0)).toEqual([boxes[2]]);
  });

  it("moves from the search into the list with ArrowDown", async () => {
    const user = setup();
    const panel = await open(user, /^Acción/);
    within(panel).getByRole("searchbox", { name: "Buscar acción" }).focus();
    await user.keyboard("{ArrowDown}");
    expect(within(panel).getAllByRole("checkbox")[0]).toHaveFocus();
  });

  it("labels a type it does not know generically, with its code, under «Otras acciones»", async () => {
    const user = setup({ withOptions: { ...options, types: [...options.types, { event_type: "SomethingNew", category: "brand_new" }] } });
    const panel = await open(user, /^Acción/);
    expect(within(within(panel).getByRole("group", { name: /^Otras acciones/ })).getByRole("checkbox", { name: "Otra acción (SomethingNew)" })).toBeInTheDocument();
  });
});

describe("vacancy panel", () => {
  it("shows full titles that wrap, tells a deleted vacancy apart with its identifier and picks one", async () => {
    const user = setup();
    const panel = await open(user, /^Vacante/);
    expect(panel).toHaveAttribute("aria-label", "Filtrar por vacante");
    const title = within(panel).getByText(longTitle);
    expect(title.className).not.toMatch(/truncate|line-clamp|text-ellipsis/);
    expect(within(panel).getByRole("radio", { name: "Vacante eliminada" })).toBeInTheDocument();
    expect(within(panel).getByText(`Identificador #${deletedVacancyId.slice(0, 8)}`)).toBeInTheDocument();
    await user.type(within(panel).getByRole("searchbox", { name: "Buscar vacante" }), "apodaca");
    expect(within(panel).queryByRole("radio", { name: "Ejecutivo de ventas" })).toBeNull();
    await user.click(within(panel).getByRole("radio", { name: longTitle }));
    expect(onChange).toHaveBeenCalledWith({ vacancy_id: longVacancyId });
    expect(within(screen.getByRole("group", { name: "Filtros activos" })).getByText(longTitle)).toBeInTheDocument();
  });
});

describe("chips", () => {
  const all: AuditFilters = { actor_id: luisId, event_type: ["SessionEnded"], vacancy_id: vacancyId, from: "2026-11-01", to: "2026-11-15" };

  it("shows each active value as a chip with a 40 px «Quitar» target and removes only that one", async () => {
    const user = setup({ initial: all });
    const chips = screen.getByRole("group", { name: "Filtros activos" });
    const remove = within(chips).getByRole("button", { name: "Quitar filtro Persona: Luis Soto (ex miembro)" });
    expect(remove).toHaveClass("size-10");
    expect(remove).toHaveAttribute("title", "Quitar");
    await user.click(remove);
    expect(onChange).toHaveBeenLastCalledWith({ actor_id: undefined });
    expect(within(chips).queryByText(/Luis Soto/)).toBeNull();
    for (const name of ["Quitar filtro Acción: Cerró sesión", "Quitar filtro Vacante: Ejecutivo de ventas", "Quitar filtro Fecha: Del 1 de noviembre de 2026 al 15 de noviembre de 2026"])
      expect(within(chips).getByRole("button", { name })).toBeInTheDocument();
  });

  it("lets a chip wrap its full text over several lines", () => {
    setup({ initial: { vacancy_id: longVacancyId } });
    const chip = screen.getByText(longTitle).closest("[data-slot=audit-chip]");
    expect(chip).toHaveClass("max-w-full");
    expect(screen.getByText(longTitle).className).toContain("[overflow-wrap:anywhere]");
    expect(chip?.className).not.toMatch(/truncate/);
  });

  it("clears everything with «Limpiar filtros» and offers it only while something is active", async () => {
    const user = setup({ initial: all });
    await user.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Limpiar filtros" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Filtros activos" })).toBeNull();
  });

  it("shows a category from the URL as its own removable chip", async () => {
    const user = setup({ initial: { category: "session" } });
    await user.click(screen.getByRole("button", { name: "Quitar filtro Categoría: Sesiones" }));
    expect(onChange).toHaveBeenLastCalledWith({ category: undefined });
  });
});

describe("focus after removing chips", () => {
  const all: AuditFilters = { actor_id: luisId, event_type: ["SessionEnded"], vacancy_id: vacancyId, from: "2026-11-01", to: "2026-11-15" };
  const remove = (name: string) => screen.getByRole("button", { name: `Quitar filtro ${name}` });

  it("moves to the next chip when one is removed", async () => {
    const user = setup({ initial: all });
    await user.click(remove("Acción: Cerró sesión"));
    expect(remove("Vacante: Ejecutivo de ventas")).toHaveFocus();
  });

  it("moves to the last remaining chip when the final one is removed", async () => {
    const user = setup({ initial: all });
    await user.click(remove("Fecha: Del 1 de noviembre de 2026 al 15 de noviembre de 2026"));
    expect(remove("Vacante: Ejecutivo de ventas")).toHaveFocus();
  });

  it("moves to the filter bar's first control when no chip remains, never to the body", async () => {
    const user = setup({ initial: { vacancy_id: vacancyId } });
    await user.click(remove("Vacante: Ejecutivo de ventas"));
    expect(screen.queryByRole("group", { name: "Filtros activos" })).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByRole("button", { name: /^Persona(?!lizado)/ })).toHaveFocus();
  });

  it("«Limpiar filtros» also lands on the first control", async () => {
    const user = setup({ initial: all });
    await user.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByRole("button", { name: /^Persona(?!lizado)/ })).toHaveFocus();
  });
});

describe("date range (Mexico City days)", () => {
  const pressed = (name: string) => screen.getByRole("button", { name });

  it.each([
    ["Hoy", { from: "2026-11-24", to: "2026-11-24" }],
    ["7 días", { from: "2026-11-18", to: "2026-11-24" }],
    ["30 días", { from: "2026-10-26", to: "2026-11-24" }],
  ])("«%s» writes the API's own from/to params for the Mexico City day (UTC is already the 25th)", async (label, range) => {
    const user = setup();
    expect(screen.getByRole("group", { name: "Rango de fechas" })).toBeInTheDocument();
    await user.click(pressed(label));
    expect(onChange).toHaveBeenLastCalledWith(range);
    expect(pressed(label)).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByRole("group", { name: "Filtros activos" })).getByRole("button", { name: /^Quitar filtro Fecha:/ })).toBeInTheDocument();
  });

  it("marks the preset that the URL range matches and clears the range when it is pressed again", async () => {
    const user = setup({ initial: { from: "2026-11-18", to: "2026-11-24" } });
    expect(pressed("7 días")).toHaveAttribute("aria-pressed", "true");
    expect(pressed("Hoy")).toHaveAttribute("aria-pressed", "false");
    await user.click(pressed("7 días"));
    expect(onChange).toHaveBeenLastCalledWith({ from: undefined, to: undefined });
    expect(pressed("7 días")).toHaveAttribute("aria-pressed", "false");
  });

  it("opens «Personalizado» as one panel with Desde and Hasta, the time zone hint and no native date input", async () => {
    const user = setup({ initial: { from: "2026-11-01", to: "2026-11-15" } });
    expect(pressed("Personalizado")).toHaveAttribute("aria-pressed", "true");
    const panel = await open(user, /^Personalizado/);
    expect(panel).toHaveAttribute("aria-label", "Rango personalizado");
    // The fields use the short day of the artboard, so nothing is cut off in a 360 px panel.
    expect(within(panel).getByLabelText("Desde")).toHaveTextContent("1 nov 2026");
    expect(within(panel).getByLabelText("Hasta")).toHaveTextContent("15 nov 2026");
    expect(within(panel).getByLabelText("Desde")).not.toHaveTextContent("noviembre");
    expect(within(panel).getByText("Las fechas se cuentan en hora de la Ciudad de México.")).toBeInTheDocument();
    expect(document.querySelector('input[type="date"]')).toBeNull();
    await user.click(within(panel).getByRole("button", { name: "Quitar rango" }));
    expect(onChange).toHaveBeenLastCalledWith({ from: undefined, to: undefined });
  });

  it("writes a picked custom day and refuses a range that ends before it starts, saying why", async () => {
    const user = setup({ initial: { from: "2026-11-20" } });
    const panel = await open(user, /^Personalizado/);
    await user.click(within(panel).getByLabelText("Hasta"));
    const day = async (iso: string) => user.click(await waitFor(() => { const found = document.querySelector(`[data-day="${iso}"] button`); expect(found).not.toBeNull(); return found as HTMLElement; }));
    await day("2026-11-10");
    expect(await screen.findByRole("alert")).toHaveTextContent("La fecha «Desde» debe ser anterior o igual a «Hasta».");
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ to: "2026-11-10" }));
    await user.click(within(panel).getByLabelText("Hasta"));
    await day("2026-11-22");
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ from: "2026-11-20", to: "2026-11-22" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("catalog failure", () => {
  it("says the person and vacancy options could not load and retries them", async () => {
    const user = setup({ withOptions: null, failed: true });
    expect(screen.getByText("No pudimos cargar las opciones de persona y vacante.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reintentar opciones" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    const panel = await open(user, /^Acción/);
    expect(within(panel).getByRole("checkbox", { name: "Vio el detalle de un candidato" })).toBeInTheDocument();
  });
});
