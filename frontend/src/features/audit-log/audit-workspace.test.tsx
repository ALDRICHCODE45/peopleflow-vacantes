import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./actions", () => ({ listAuditEventsAction: vi.fn(), loadAuditOptionsAction: vi.fn() }));
// The real Base UI popover close path refocus-loops under jsdom (see test-popover.tsx); the panels, the shared DatePickerField and
// the real Calendar stay in play.
vi.mock("@/components/ui/popover", async () => (await import("./test-popover")).popoverModule());
// Keep real Select selection behavior; jsdom has no popup positioning geometry (shared primitive/browser tests own it).
vi.mock("@/components/ui/select", async importOriginal => {
  const actual = await importOriginal<typeof import("@/components/ui/select")>();
  return { ...actual, SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});
import { listAuditEventsAction, loadAuditOptionsAction } from "./actions";
import { AuditWorkspace } from "./audit-workspace";
import type { AuditFailure } from "./model";
import { anaId, auditActors, auditEvent, auditPage, auditTypes, auditVacancies, deletedVacancyId, luisId, vacancyId } from "./test-fixtures";

const list = vi.mocked(listAuditEventsAction);
const options = vi.mocked(loadAuditOptionsAction);
const failure = (reason: AuditFailure["reason"], extra: Partial<AuditFailure> = {}): AuditFailure => ({ ok: false, reason, reference: {}, ...extra });
const okOptions = { ok: true as const, types: auditTypes, actors: auditActors, vacancies: auditVacancies };
const rowsOf = () => screen.getAllByRole("row").slice(1);
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const at = (search = "") => window.history.replaceState(null, "", `/empresa/auditoria${search}`);
const openPanel = async (user: ReturnType<typeof userEvent.setup>, name: RegExp) => { await user.click(screen.getByRole("button", { name })); return screen.findByRole("dialog"); };

beforeEach(() => {
  vi.stubGlobal("PointerEvent", MouseEvent); // Base UI radios and checkboxes read it; jsdom has none
  vi.resetAllMocks();
  at();
  list.mockResolvedValue({ ok: true, data: auditPage() });
  options.mockResolvedValue(okOptions);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); at(); });


describe("page shell (same as the talent base)", () => {
  it("renders in the shared page content: title with «Solo el dueño» beside it, the description and a card region holding the rich table", async () => {
    const { container } = render(<AuditWorkspace />);
    await screen.findByRole("table");
    expect(container.querySelector("[data-pf-page-content]")).toHaveClass("max-w-screen-2xl", "mx-auto");
    // The shared employer header owns the single H1; the page names itself with an H2 like the talent base.
    expect(screen.queryAllByRole("heading", { level: 1 })).toHaveLength(0);
    const title = screen.getByRole("heading", { level: 2, name: "Registro de actividad" });
    expect(title).toHaveClass("font-heading", "text-2xl");
    const header = container.querySelector("[data-audit-header]") as HTMLElement;
    expect(within(header).getByText("Solo el dueño")).toHaveAttribute("data-slot", "badge");
    expect(title.closest("[data-audit-title-row]")).toContainElement(within(header).getByText("Solo el dueño"));
    expect(within(header).getByText("Quién hizo qué en tu empresa, cuándo y desde dónde. Los registros no se pueden editar.")).toBeInTheDocument();
    expect(screen.queryByText("TRAZABILIDAD DE TU EMPRESA")).toBeNull();
    const card = screen.getByRole("region", { name: "Registro de actividad" });
    expect(card).toHaveAttribute("data-slot", "card");
    expect(within(card).getByRole("region", { name: "Tabla con desplazamiento horizontal" })).toBeInTheDocument();
    expect(within(card).getByText(/registrados en tu empresa/)).toHaveTextContent("1 evento registrados en tu empresa");
  });

  it("puts the filter bar, the date range, «Columnas» and the view reset in the toolbar and «Exportar CSV» beside the title", async () => {
    const { container } = render(<AuditWorkspace />);
    await screen.findByRole("table");
    const toolbar = container.querySelector("[data-audit-toolbar]") as HTMLElement;
    for (const name of [/^Persona(?!lizado)/, /^Acción/, /^Vacante/, "Columnas"]) expect(within(toolbar).getByRole("button", { name })).toHaveClass("min-h-10");
    expect(within(toolbar).getByRole("group", { name: "Rango de fechas" })).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: "Restablecer vista" })).toBeInTheDocument();
    expect(within(toolbar).queryByRole("button", { name: /^Filtros/ })).toBeNull();
    expect(within(container.querySelector("[data-audit-header]") as HTMLElement).getByRole("button", { name: "Exportar CSV" })).toBeEnabled();
  });

  it("explains what is recorded on demand, in a help popover that keeps the sessions note", async () => {
    const user = userEvent.setup();
    render(<AuditWorkspace />);
    await screen.findByRole("table");
    expect(screen.queryByTestId("audit-session-note")).toBeNull();
    const panel = await openPanel(user, /^¿Qué se registra\?/);
    expect(within(panel).getByTestId("audit-session-note")).toHaveTextContent("«Cerró sesión» significa que la persona hizo clic en cerrar sesión");
    expect(within(panel).getByText(/Los registros no se pueden editar/)).toBeInTheDocument();
  });

  it("loads with skeleton rows under the real headers while the filter bar and the title are already there", async () => {
    const pending = deferred<Awaited<ReturnType<typeof listAuditEventsAction>>>();
    list.mockReturnValue(pending.promise);
    const { container } = render(<AuditWorkspace />);
    expect(container.querySelector("[data-audit-skeleton=table]")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("heading", { level: 2, name: "Registro de actividad" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Persona(?!lizado)/ })).toBeInTheDocument();
    await act(async () => { pending.resolve({ ok: true, data: auditPage() }); });
    await screen.findByRole("table");
    expect(container.querySelector("[data-audit-skeleton]")).toBeNull();
  });
});

describe("states", () => {
  it("shows a loading state first and reads the first page with no filters", async () => {
    const pending = deferred<Awaited<ReturnType<typeof listAuditEventsAction>>>();
    list.mockReturnValue(pending.promise);
    render(<AuditWorkspace />);
    expect(screen.getByRole("status", { name: /Cargando/ })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(list).toHaveBeenCalledWith({ filters: {}, limit: 50 });
    await act(async () => { pending.resolve({ ok: true, data: auditPage() }); });
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("explains an empty audit without filters", async () => {
    list.mockResolvedValue({ ok: true, data: auditPage([]) });
    render(<AuditWorkspace />);
    expect(await screen.findByText("Todavía no hay actividad registrada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Limpiar filtros" })).not.toBeInTheDocument();
  });

  it("explains an empty filtered result and clears the filters from the URL", async () => {
    at("?from=2026-11-01");
    list.mockResolvedValueOnce({ ok: true, data: auditPage([]) });
    render(<AuditWorkspace />);
    expect(await screen.findByText("Sin resultados")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Limpiar filtros" })[0]);
    expect(window.location.search).toBe("");
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("shows a retryable error and retries", async () => {
    list.mockResolvedValueOnce(failure("server_error"));
    render(<AuditWorkspace />);
    expect(await screen.findByText("No pudimos consultar la auditoría. Puedes volver a intentarlo.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("shows forbidden (the API said the caller is not the owner) with no retry and no rows", async () => {
    list.mockResolvedValue(failure("forbidden", { reference: { status: 403 } }));
    render(<AuditWorkspace />);
    expect(await screen.findByText("Solo el dueño de la empresa puede consultar la auditoría.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
  });

  it("asks to sign in again when the session expired", async () => {
    list.mockResolvedValue(failure("unauthenticated"));
    render(<AuditWorkspace />);
    expect(await screen.findByText(/Tu sesión expiró/)).toBeInTheDocument();
  });

  it("offers to clear filters when the API rejects them", async () => {
    at("?from=2026-11-05&to=2026-11-04");
    list.mockResolvedValueOnce(failure("invalid_filter", { fields: [{ field: "from", code: "range" }] }));
    render(<AuditWorkspace />);
    expect(await screen.findByText("La fecha «Desde» debe ser anterior o igual a «Hasta».")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Limpiar filtros" })[0]);
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });
});

describe("rows", () => {
  it("shows when (America/Mexico_City), who, action, entity, vacancy, IP and browser", async () => {
    render(<AuditWorkspace />);
    const row = (await screen.findAllByRole("row"))[1];
    expect(within(row).getByText(/11:03:12/)).toBeInTheDocument();
    expect(within(row).getByText("Ana López")).toBeInTheDocument();
    expect(within(row).getByText("ana@empresa.mx")).toBeInTheDocument();
    expect(within(row).getByText("Inició la descarga de un CV")).toBeInTheDocument();
    expect(within(row).getByText("María Pérez")).toBeInTheDocument();
    expect(within(row).getByText("Ejecutivo de ventas")).toBeInTheDocument();
    expect(within(row).getByText("201.141.12.7")).toBeInTheDocument();
    expect(within(row).getByText("Safari · macOS")).toBeInTheDocument();
    expect(within(row).queryByText("IP no verificada")).not.toBeInTheDocument();
    expect(within(row).queryByText("Ex miembro")).not.toBeInTheDocument();
  });

  it("marks a peer IP as «IP no verificada» and keeps a verified IP unmarked", async () => {
    list.mockResolvedValue({ ok: true, data: auditPage([auditEvent({ ip_source: "peer", ip: "10.0.0.5" }), auditEvent({ id: "50000000-0000-4000-8000-000000000002" })]) });
    render(<AuditWorkspace />);
    await screen.findByRole("table");
    const [peer, bff] = rowsOf();
    expect(within(peer).getByText("IP no verificada")).toBeInTheDocument();
    expect(within(peer).getByText("10.0.0.5")).toBeInTheDocument();
    expect(within(bff).queryByText("IP no verificada")).not.toBeInTheDocument();
  });

  it("names the nulls honestly: «Usuario eliminado», «Ex miembro», «Sistema», no entity label, no vacancy, «Vacante eliminada»", async () => {
    list.mockResolvedValue({ ok: true, data: auditPage([
      auditEvent({ id: "50000000-0000-4000-8000-000000000011", actor: { type: "user", user_id: luisId, name: null, email: null, is_current_member: false }, entity: { type: "company_candidate", id: "e", label: null } }),
      auditEvent({ id: "50000000-0000-4000-8000-000000000012", actor: { type: "user", user_id: luisId, name: "Luis Soto", email: "luis@empresa.mx", is_current_member: false } }),
      auditEvent({ id: "50000000-0000-4000-8000-000000000013", actor: { type: "system" }, vacancy: null, ip: null, ip_source: null, user_agent: null, event_type: "AuditLogExported", category: "audit" }),
      auditEvent({ id: "50000000-0000-4000-8000-000000000014", vacancy: { id: deletedVacancyId, title: null } }),
    ]) });
    render(<AuditWorkspace />);
    await screen.findByRole("table");
    const [deleted, former, system, goneVacancy] = rowsOf();
    expect(within(deleted).getByText("Usuario eliminado")).toBeInTheDocument();
    expect(within(deleted).getByText("Ex miembro")).toBeInTheDocument();
    expect(within(deleted).getByText("Sin etiqueta")).toBeInTheDocument();
    expect(within(former).getByText("Luis Soto")).toBeInTheDocument();
    expect(within(former).getByText("Ex miembro")).toBeInTheDocument();
    expect(within(system).getByText("Sistema")).toBeInTheDocument();
    expect(within(system).queryByText("Ex miembro")).not.toBeInTheDocument();
    expect(within(system).getByText("Exportó la auditoría")).toBeInTheDocument();
    expect(within(system).queryByText("Ejecutivo de ventas")).not.toBeInTheDocument();
    expect(within(goneVacancy).getByText("Vacante eliminada")).toBeInTheDocument();
  });

  it("shows no «Ex miembro» for a candidate who applied (never a member of the company)", async () => {
    list.mockResolvedValue({ ok: true, data: auditPage([
      auditEvent({ id: "50000000-0000-4000-8000-000000000021", event_type: "VacancyApplicationSubmitted", category: "candidate", actor: { type: "user", user_id: luisId, name: "Marta Ruiz", email: "marta@correo.mx", is_current_member: false } }),
    ]) });
    render(<AuditWorkspace />);
    await screen.findByRole("table");
    const [applied] = rowsOf();
    expect(within(applied).getByText("Marta Ruiz")).toBeInTheDocument();
    expect(within(applied).queryByText("Ex miembro")).not.toBeInTheDocument();
  });

  it("labels an event type it has never seen generically instead of crashing", async () => {
    list.mockResolvedValue({ ok: true, data: auditPage([auditEvent({ event_type: "SomethingNew", category: "brand_new" })]) });
    render(<AuditWorkspace />);
    const row = (await screen.findAllByRole("row"))[1];
    expect(within(row).getByText("Otra acción")).toBeInTheDocument();
    expect(within(row).getByText("SomethingNew")).toBeInTheDocument();
  });

  it("wraps the cells up to three lines instead of truncating, with the full text on hover", async () => {
    const title = "Supervisor de Producción Turno Nocturno — Planta Apodaca (reemplazo temporal por incapacidad)";
    list.mockResolvedValue({ ok: true, data: auditPage([auditEvent({ vacancy: { id: vacancyId, title }, entity: { type: "company_candidate", id: "e", label: "María Fernanda Guerrero Salinas de la Cruz" } })]) });
    render(<AuditWorkspace />);
    const [row] = await waitFor(() => { const found = rowsOf(); expect(found).toHaveLength(1); return found; });
    for (const text of [title, "María Fernanda Guerrero Salinas de la Cruz", "Inició la descarga de un CV"]) {
      const cell = within(row).getByText(text);
      expect(cell).toHaveClass("line-clamp-3", "whitespace-normal", "[overflow-wrap:anywhere]");
      expect(cell).not.toHaveClass("truncate");
      expect(cell).toHaveAttribute("title", text);
    }
    expect(within(row).getByText("Ana López")).toHaveClass("line-clamp-3");
  });

  it("opens the event detail sheet when the row is clicked and returns to the table when it is closed", async () => {
    const user = userEvent.setup();
    render(<AuditWorkspace />);
    const [row] = await waitFor(() => { const found = rowsOf(); expect(found).toHaveLength(1); return found; });
    await user.click(within(row).getByText("María Pérez"));
    const sheet = await screen.findByRole("dialog", { name: "Inició la descarga de un CV" });
    expect(within(sheet).getByText("201.141.12.7")).toBeInTheDocument();
    expect(within(sheet).getByText(/hora de la Ciudad de México/)).toBeInTheDocument();
    await user.click(within(sheet).getAllByRole("button", { name: "Cerrar" })[0]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("opens the same sheet with Enter on a focused row and never from a click on a control inside the row", async () => {
    const user = userEvent.setup();
    render(<AuditWorkspace />);
    const [row] = await waitFor(() => { const found = rowsOf(); expect(found).toHaveLength(1); return found; });
    expect(row).toHaveAttribute("tabindex", "0");
    row.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("dialog", { name: "Inició la descarga de un CV" })).toBeInTheDocument();
  });

  it("keeps the «Sobre» rule in the sheet too: «—» when the entity is the vacancy", async () => {
    list.mockResolvedValue({ ok: true, data: auditPage([auditEvent({ entity: { type: "job_draft", id: vacancyId, label: "Ejecutivo de ventas" } })]) });
    const user = userEvent.setup();
    render(<AuditWorkspace />);
    const [row] = await waitFor(() => { const found = rowsOf(); expect(found).toHaveLength(1); return found; });
    await user.click(within(row).getByText("Ana López"));
    const sheet = await screen.findByRole("dialog");
    expect(within(screen.getByText("Sobre", { selector: "dt" }).closest("div") as HTMLElement).queryByText("Ejecutivo de ventas")).toBeNull();
    expect(within(sheet).getAllByText("Ejecutivo de ventas")).toHaveLength(1);
  });
});

describe("pagination (cursor, previous/next)", () => {
  const nav = () => screen.getByRole("navigation", { name: "Paginación" });
  const button = (name: string) => within(nav()).getByRole("button", { name });
  const page = (next: string | null, id: string) => ({ ok: true as const, data: auditPage([auditEvent({ id })], { total: 120, next_cursor: next }) });
  /** Three pages of 50 for 120 events: no cursor → c1 → c2 → end. */
  const threePages = () => list.mockImplementation(async input => input?.cursor === "c2" ? page(null, "50000000-0000-4000-8000-000000000033")
    : input?.cursor === "c1" ? page("c2", "50000000-0000-4000-8000-000000000032") : page("c1", "50000000-0000-4000-8000-000000000031"));

  it("reads 50 rows per page by default and shows the range, «Página 1 de N» and the shared controls without a last-page jump", async () => {
    threePages();
    render(<AuditWorkspace />);
    await screen.findByRole("table");
    expect(list).toHaveBeenCalledWith({ filters: {}, limit: 50 });
    expect(screen.getByText("Mostrando 1–1 de 120 eventos")).toBeInTheDocument();
    expect(within(nav()).getByText("Página 1 de 3")).toBeInTheDocument();
    expect(within(nav()).getByRole("combobox", { name: "Filas por página" })).toHaveTextContent("50");
    expect(within(nav()).getAllByRole("option").map(option => option.textContent)).toEqual(["10", "20", "30", "40", "50"]);
    expect(button("Ir a la primera página")).toBeDisabled();
    expect(button("Ir a la página anterior")).toBeDisabled();
    expect(button("Ir a la página siguiente")).toBeEnabled();
    expect(screen.queryByRole("button", { name: /última página/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cargar más" })).not.toBeInTheDocument();
  });

  it("goes forward with next_cursor, back to the previous cursor and to the first page, disabling the controls at the edges", async () => {
    threePages();
    const user = userEvent.setup();
    render(<AuditWorkspace />);
    await screen.findByRole("table");
    await user.click(button("Ir a la página siguiente"));
    await waitFor(() => expect(within(nav()).getByText("Página 2 de 3")).toBeInTheDocument());
    expect(list).toHaveBeenLastCalledWith({ filters: {}, limit: 50, cursor: "c1" });
    expect(screen.getByText("Mostrando 51–51 de 120 eventos")).toBeInTheDocument();
    expect(rowsOf()).toHaveLength(1);
    expect(button("Ir a la primera página")).toBeEnabled();
    expect(button("Ir a la página anterior")).toBeEnabled();
    await user.click(button("Ir a la página siguiente"));
    await waitFor(() => expect(within(nav()).getByText("Página 3 de 3")).toBeInTheDocument());
    expect(list).toHaveBeenLastCalledWith({ filters: {}, limit: 50, cursor: "c2" });
    expect(button("Ir a la página siguiente")).toBeDisabled();
    await user.click(button("Ir a la página anterior"));
    await waitFor(() => expect(within(nav()).getByText("Página 2 de 3")).toBeInTheDocument());
    expect(list).toHaveBeenLastCalledWith({ filters: {}, limit: 50, cursor: "c1" });
    await user.click(button("Ir a la primera página"));
    await waitFor(() => expect(within(nav()).getByText("Página 1 de 3")).toBeInTheDocument());
    expect(list).toHaveBeenLastCalledWith({ filters: {}, limit: 50 });
    expect(button("Ir a la primera página")).toBeDisabled();
    expect(button("Ir a la página anterior")).toBeDisabled();
    expect(list).toHaveBeenCalledTimes(5);
  });

  it("changes the request limit from the rows-per-page select and starts again from page 1", async () => {
    threePages();
    const user = userEvent.setup();
    render(<AuditWorkspace />);
    await screen.findByRole("table");
    await user.click(button("Ir a la página siguiente"));
    await waitFor(() => expect(within(nav()).getByText("Página 2 de 3")).toBeInTheDocument());
    await user.click(within(nav()).getByRole("option", { name: "20" }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ filters: {}, limit: 20 }));
    await waitFor(() => expect(within(nav()).getByText("Página 1 de 6")).toBeInTheDocument());
    expect(within(nav()).getByRole("combobox", { name: "Filas por página" })).toHaveTextContent("20");
    expect(button("Ir a la página anterior")).toBeDisabled();
    await user.click(button("Ir a la página siguiente"));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ filters: {}, limit: 20, cursor: "c1" }));
  });

  it("starts again from page 1 when a filter changes", async () => {
    at("?from=2026-11-01");
    threePages();
    const user = userEvent.setup();
    render(<AuditWorkspace />);
    await screen.findByRole("table");
    await user.click(button("Ir a la página siguiente"));
    await waitFor(() => expect(within(nav()).getByText("Página 2 de 3")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Quitar filtro Fecha: Desde el 1 de noviembre de 2026" }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ filters: {}, limit: 50 }));
    await waitFor(() => expect(within(nav()).getByText("Página 1 de 3")).toBeInTheDocument());
    expect(button("Ir a la página anterior")).toBeDisabled();
  });

  it("disables the controls and shows the skeleton while a page loads", async () => {
    const pending = deferred<Awaited<ReturnType<typeof listAuditEventsAction>>>();
    list.mockResolvedValueOnce(page("c1", "50000000-0000-4000-8000-000000000031"));
    list.mockReturnValueOnce(pending.promise);
    const user = userEvent.setup();
    const { container } = render(<AuditWorkspace />);
    await screen.findByRole("table");
    await user.click(button("Ir a la página siguiente"));
    expect(container.querySelector("[data-audit-skeleton=table]")).not.toBeNull();
    for (const name of ["Ir a la primera página", "Ir a la página anterior", "Ir a la página siguiente"]) expect(button(name)).toBeDisabled();
    expect(within(nav()).getByRole("combobox", { name: "Filas por página" })).toBeDisabled();
    expect(screen.getByRole("region", { name: "Registro de actividad" })).toHaveAttribute("aria-busy", "true");
    await act(async () => { pending.resolve(page(null, "50000000-0000-4000-8000-000000000032")); });
    await waitFor(() => expect(within(nav()).getByText("Página 2 de 3")).toBeInTheDocument());
    expect(container.querySelector("[data-audit-skeleton]")).toBeNull();
    expect(button("Ir a la página siguiente")).toBeDisabled();
  });

  it("keeps the previous page with the error copy and a retry when a page fails", async () => {
    list.mockResolvedValueOnce(page("c1", "50000000-0000-4000-8000-000000000031"));
    list.mockResolvedValueOnce(failure("no_response"));
    list.mockResolvedValueOnce(page(null, "50000000-0000-4000-8000-000000000032"));
    const user = userEvent.setup();
    render(<AuditWorkspace />);
    await screen.findByRole("table");
    await user.click(button("Ir a la página siguiente"));
    expect(await screen.findByText("No pudimos consultar la auditoría. Puedes volver a intentarlo.")).toBeInTheDocument();
    expect(rowsOf()).toHaveLength(1);
    expect(within(nav()).getByText("Página 1 de 3")).toBeInTheDocument();
    expect(button("Ir a la página siguiente")).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(within(nav()).getByText("Página 2 de 3")).toBeInTheDocument());
    expect(list).toHaveBeenLastCalledWith({ filters: {}, limit: 50, cursor: "c1" });
    expect(screen.queryByText("No pudimos consultar la auditoría. Puedes volver a intentarlo.")).not.toBeInTheDocument();
  });

  it("returns to the first page with a notice when the cursor is no longer valid", async () => {
    list.mockResolvedValueOnce(page("stale", "50000000-0000-4000-8000-000000000031"));
    list.mockResolvedValueOnce(failure("invalid_cursor"));
    list.mockResolvedValueOnce(page("c1", "50000000-0000-4000-8000-000000000034"));
    render(<AuditWorkspace />);
    await screen.findByRole("table");
    await userEvent.click(button("Ir a la página siguiente"));
    expect(await screen.findByText("La lista se actualizó. Volvimos a la primera página.")).toBeInTheDocument();
    await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
    expect(list).toHaveBeenLastCalledWith({ filters: {}, limit: 50 });
    await waitFor(() => expect(within(nav()).getByText("Página 1 de 3")).toBeInTheDocument());
  });
});

describe("edge inset", () => {
  it("insets the first and last header and body cells by the card spacing, in the table and in its skeleton", async () => {
    const pending = deferred<Awaited<ReturnType<typeof listAuditEventsAction>>>();
    list.mockReturnValue(pending.promise);
    const { container } = render(<AuditWorkspace />);
    const inset = ["[&_tr>*:first-child]:pl-(--card-spacing)", "[&_tr>*:last-child]:pr-(--card-spacing)"];
    expect(container.querySelector("[data-audit-skeleton=table]")).toHaveClass(...inset);
    await act(async () => { pending.resolve({ ok: true, data: auditPage() }); });
    const table = await screen.findByRole("table");
    expect(table.closest("[data-audit-table]")).toHaveClass(...inset);
  });
});

describe("filters (in the URL)", () => {
  it("offers people including former members, the Annex actions grouped by category and vacancies including deleted ones", async () => {
    const user = userEvent.setup();
    render(<AuditWorkspace />);
    await screen.findByRole("table");
    await waitFor(() => expect(screen.getByRole("button", { name: /^Persona(?!lizado)/ })).toBeEnabled());
    const persons = await openPanel(user, /^Persona(?!lizado)/);
    await waitFor(() => expect(within(persons).getAllByRole("radio").map(radio => radio.textContent)).toHaveLength(3));
    expect(within(persons).getByRole("radio", { name: "Luis Soto" })).toHaveTextContent("Ex miembro");
    await user.click(within(persons).getByRole("radio", { name: "Ana López" }));
    const actions = await openPanel(user, /^Acción/);
    for (const group of [/^Sesiones/, /^Consultas sensibles/, /^Auditoría/]) expect(within(actions).getByRole("group", { name: group })).toBeInTheDocument();
    await user.click(within(actions).getByRole("checkbox", { name: "Cerró sesión" }));
    await user.click(screen.getByRole("button", { name: /^Acción/ }));
    const vacancies = await openPanel(user, /^Vacante/);
    expect(within(vacancies).getAllByRole("radio").map(radio => radio.textContent?.replace(/Identificador.*/, ""))).toEqual(["Todas las vacantes", "Ejecutivo de ventas", "Vacante eliminada"]);
    expect(within(vacancies).getByText(`Identificador #${deletedVacancyId.slice(0, 8)}`)).toBeInTheDocument();
  });

  it("writes each filter to the URL and re-reads the list with it, date presets included", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-25T03:30:00Z"));
    const user = userEvent.setup();
    render(<AuditWorkspace />);
    await screen.findByRole("table");
    await waitFor(() => expect(options).toHaveBeenCalled());
    let panel = await openPanel(user, /^Persona(?!lizado)/);
    await user.click(await within(panel).findByRole("radio", { name: "Ana López" }));
    panel = await openPanel(user, /^Acción/);
    await user.click(within(panel).getByRole("checkbox", { name: "Cerró sesión" }));
    panel = await openPanel(user, /^Vacante/);
    await user.click(await within(panel).findByRole("radio", { name: "Ejecutivo de ventas" }));
    await user.click(screen.getByRole("button", { name: "7 días" }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ filters: { actor_id: anaId, event_type: ["SessionEnded"], vacancy_id: vacancyId, from: "2026-11-18", to: "2026-11-24" }, limit: 50 }));
    const params = new URLSearchParams(window.location.search);
    expect(params.get("actor_id")).toBe(anaId);
    expect(params.getAll("event_type")).toEqual(["SessionEnded"]);
    expect(params.get("vacancy_id")).toBe(vacancyId);
    expect(params.get("from")).toBe("2026-11-18");
    expect(params.get("to")).toBe("2026-11-24");
    await user.click(screen.getAllByRole("button", { name: "Limpiar filtros" })[0]);
    expect(window.location.search).toBe("");
    vi.useRealTimers();
  });

  it("starts from the URL: chips, selector counts and the preset show it, the first read uses it and a chip removes one filter", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-25T03:30:00Z"));
    at(`?actor_id=${luisId}&event_type=SessionStarted&event_type=SessionEnded&from=2026-11-18&to=2026-11-24`);
    const user = userEvent.setup();
    render(<AuditWorkspace />);
    await screen.findByRole("table");
    expect(list).toHaveBeenCalledWith({ filters: { actor_id: luisId, event_type: ["SessionStarted", "SessionEnded"], from: "2026-11-18", to: "2026-11-24" }, limit: 50 });
    const chips = screen.getByRole("group", { name: "Filtros activos" });
    expect(await within(chips).findByText("Luis Soto (ex miembro)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Acción/ })).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: "7 días" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(chips).getByRole("button", { name: /^Quitar filtro Fecha:/ }));
    expect(new URLSearchParams(window.location.search).get("from")).toBeNull();
    expect(new URLSearchParams(window.location.search).get("to")).toBeNull();
    expect(new URLSearchParams(window.location.search).get("actor_id")).toBe(luisId);
    vi.useRealTimers();
  });

  it("keeps a URL with only «from» working: an open-ended range is a chip and a custom range", async () => {
    at("?from=2026-11-01");
    render(<AuditWorkspace />);
    await screen.findByRole("table");
    expect(list).toHaveBeenCalledWith({ filters: { from: "2026-11-01" }, limit: 50 });
    expect(screen.getByRole("button", { name: "Quitar filtro Fecha: Desde el 1 de noviembre de 2026" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Personalizado" })).toHaveAttribute("aria-pressed", "true");
  });

  it("still filters by the known Annex actions when the catalogs cannot be loaded, and says so", async () => {
    options.mockResolvedValue(failure("server_error"));
    const user = userEvent.setup();
    render(<AuditWorkspace />);
    await screen.findByRole("table");
    expect(await screen.findByText("No pudimos cargar las opciones de persona y vacante.")).toBeInTheDocument();
    const panel = await openPanel(user, /^Acción/);
    expect(within(panel).getByRole("checkbox", { name: "Vio el detalle de un candidato" })).toBeInTheDocument();
    options.mockResolvedValue(okOptions);
    await user.click(screen.getByRole("button", { name: "Reintentar opciones" }));
    await waitFor(() => expect(screen.queryByText("No pudimos cargar las opciones de persona y vacante.")).toBeNull());
  });

  it("keeps the filters and offers «Limpiar filtros» when nothing matches", async () => {
    at(`?actor_id=${luisId}`);
    list.mockResolvedValueOnce({ ok: true, data: auditPage([]) });
    const user = userEvent.setup();
    render(<AuditWorkspace />);
    expect(await screen.findByText("Sin resultados")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Filtros activos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Persona(?!lizado)/ })).toHaveTextContent("1");
    await user.click(screen.getAllByRole("button", { name: "Limpiar filtros" }).at(-1)!);
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });
});

describe("export from the workspace", () => {
  it("keeps «Exportar CSV» enabled with no dates and exports the URL's range from the panel", async () => {
    at(`?actor_id=${anaId}&from=2026-11-01&to=2026-11-04`);
    const fetchMock = vi.fn().mockResolvedValue(new Response("﻿occurred_at\r\n", { headers: { "content-type": "text/csv", "content-disposition": 'attachment; filename="auditoria-2026-11-04.csv"' } }));
    vi.stubGlobal("fetch", fetchMock);
    URL.createObjectURL = vi.fn(() => "blob:audit"); URL.revokeObjectURL = vi.fn();
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this.download); });
    const user = userEvent.setup();
    render(<AuditWorkspace />);
    await screen.findByRole("table");
    const panel = await openPanel(user, /^Exportar CSV/);
    await user.click(within(panel).getByRole("button", { name: "Descargar CSV" }));
    await waitFor(() => expect(clicked).toEqual(["auditoria-2026-11-04.csv"]));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ actor_id: anaId, from: "2026-11-01", to: "2026-11-04" });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/company/audit-events/export");
    vi.restoreAllMocks();
  });

  it("does not shift the toolbar: the requirement is a hint on its own line and the validation errors live in the panel", async () => {
    at("?from=2026-11-01");
    const user = userEvent.setup();
    const { container } = render(<AuditWorkspace />);
    await screen.findByRole("table");
    const toolbar = container.querySelector("[data-audit-toolbar]") as HTMLElement;
    expect(screen.getByRole("button", { name: "Exportar CSV" })).toBeEnabled();
    expect(container.querySelectorAll("[data-pf-audit-export-slot]")).toHaveLength(1);
    const panel = await openPanel(user, /^Exportar CSV/);
    expect(within(panel).getByRole("alert")).toHaveTextContent("Elige las fechas «Desde» y «Hasta» para exportar.");
    expect(within(panel).getByRole("button", { name: "Descargar CSV" })).toBeDisabled();
    expect(toolbar.textContent).not.toContain("Elige las fechas");
    expect(container.querySelectorAll("[data-pf-audit-export-slot]")).toHaveLength(1);
  });
});
