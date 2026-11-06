import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./actions", () => ({ listAuditEventsAction: vi.fn(), loadAuditOptionsAction: vi.fn() }));
// Same boundary as date-picker-field.test: the real Base UI popover close path refocus-loops under jsdom, so the
// popover is a controlled harness while the shared DatePickerField and the real Calendar stay in play.
vi.mock("@/components/ui/popover", async () => {
  const Context = React.createContext<{ open: boolean; setOpen: (next: boolean) => void }>({ open: false, setOpen: () => {} });
  return {
    Popover: ({ open, onOpenChange, children }: { open?: boolean; onOpenChange?: (next: boolean) => void; children?: React.ReactNode }) =>
      <Context.Provider value={{ open: Boolean(open), setOpen: next => onOpenChange?.(next) }}>{children}</Context.Provider>,
    PopoverTrigger: ({ render }: { render: React.ReactElement<{ onClick?: () => void }> }) => {
      const { setOpen } = React.useContext(Context);
      return React.cloneElement(render, { onClick: () => setOpen(true) });
    },
    PopoverContent: ({ children }: { children?: React.ReactNode }) => React.useContext(Context).open ? <div role="dialog">{children}</div> : null,
  };
});
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
const openFilters = async (user = userEvent.setup()) => { await user.click(screen.getByRole("button", { name: /^Filtros/ })); return user; };
const pick = async (user: ReturnType<typeof userEvent.setup>, label: string, option: string) => {
  const field = screen.getByRole("combobox", { name: label }).closest('[data-slot="field"]') as HTMLElement;
  await user.click(within(field).getByRole("option", { name: option }));
};
// The test boundary renders each select's choices inline, so read them from the field that owns the select.
const optionsOf = (label: string) => {
  const field = screen.getByRole("combobox", { name: label }).closest('[data-slot="field"]') as HTMLElement;
  return within(field).getAllByRole("option").map(option => option.textContent);
};
const today = () => new Date();
const civil = (date: Date, day: number) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
/** Opens the shared date picker and clicks day 1 of the month it opens on (always a past or current day). */
const pickFirstOfMonth = async (user: ReturnType<typeof userEvent.setup>, label: string) => {
  await user.click(screen.getByRole("button", { name: new RegExp(`^${label}`) }));
  const cell = await waitFor(() => { const found = document.querySelector(`[data-day="${civil(today(), 1)}"] button`); expect(found).not.toBeNull(); return found as HTMLElement; });
  await user.click(cell);
  return civil(today(), 1);
};

beforeEach(() => {
  vi.resetAllMocks();
  at();
  list.mockResolvedValue({ ok: true, data: auditPage() });
  options.mockResolvedValue(okOptions);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); at(); });

describe("page shell (same as the talent base)", () => {
  it("renders in the shared page content, with the eyebrow/title/description hierarchy and a card region holding the rich table", async () => {
    const { container } = render(<AuditWorkspace />);
    await screen.findByRole("table");
    expect(container.querySelector("[data-pf-page-content]")).toHaveClass("max-w-screen-2xl", "mx-auto");
    // The shared employer header owns the single H1; the page names itself with an H2 like the talent base.
    expect(screen.queryAllByRole("heading", { level: 1 })).toHaveLength(0);
    expect(screen.getByRole("heading", { level: 2, name: "Registro de actividad" })).toHaveClass("font-heading", "text-2xl");
    expect(screen.getByText("TRAZABILIDAD DE TU EMPRESA")).toBeInTheDocument();
    const card = screen.getByRole("region", { name: "Registro de actividad" });
    expect(card).toHaveAttribute("data-slot", "card");
    expect(within(card).getByRole("region", { name: "Tabla con desplazamiento horizontal" })).toBeInTheDocument();
    expect(within(card).getByText(/registrados en tu empresa/)).toHaveTextContent("1 evento registrados en tu empresa");
  });

  it("puts «Filtros» and «Exportar CSV» in the toolbar like the talent base and shows the session note as a muted note", async () => {
    const { container } = render(<AuditWorkspace />);
    await screen.findByRole("table");
    const toolbar = container.querySelector("[data-audit-toolbar]") as HTMLElement;
    expect(within(toolbar).getByRole("button", { name: /^Filtros/ })).toHaveClass("min-h-10");
    expect(within(toolbar).getByRole("button", { name: "Exportar CSV" })).toHaveClass("min-h-10");
    expect(within(toolbar).getByRole("button", { name: "Columnas" })).toBeInTheDocument();
    expect(screen.getByTestId("audit-session-note")).toHaveClass("bg-muted", "text-muted-foreground");
  });

  it("loads with skeleton rows under the real headers, not a bare placeholder", async () => {
    const pending = deferred<Awaited<ReturnType<typeof listAuditEventsAction>>>();
    list.mockReturnValue(pending.promise);
    const { container } = render(<AuditWorkspace />);
    expect(container.querySelector("[data-audit-skeleton=table]")).toHaveAttribute("aria-hidden", "true");
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
    expect(await screen.findByText("Solo el owner de la empresa puede consultar la auditoría.")).toBeInTheDocument();
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

  it("labels an event type it has never seen generically instead of crashing", async () => {
    list.mockResolvedValue({ ok: true, data: auditPage([auditEvent({ event_type: "SomethingNew", category: "brand_new" })]) });
    render(<AuditWorkspace />);
    const row = (await screen.findAllByRole("row"))[1];
    expect(within(row).getByText("Otra acción")).toBeInTheDocument();
    expect(within(row).getByText("SomethingNew")).toBeInTheDocument();
  });

  it("is honest about sessions: «Cerró sesión» is a clicked sign-out; expiry and closed tabs are not recorded", async () => {
    list.mockResolvedValue({ ok: true, data: auditPage([auditEvent({ event_type: "SessionEnded", category: "session" })]) });
    render(<AuditWorkspace />);
    expect(await screen.findByText("Cerró sesión")).toBeInTheDocument();
    const note = screen.getByTestId("audit-session-note");
    expect(note).toHaveTextContent("«Cerró sesión» significa que la persona hizo clic en cerrar sesión");
    expect(note).toHaveTextContent("expiración o al cerrar la pestaña no se registran");
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
    await user.click(screen.getByRole("button", { name: "Quitar filtro Desde: 1 de noviembre de 2026" }));
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
  it("offers people including former members, the Annex action labels grouped by category and vacancies including deleted ones", async () => {
    render(<AuditWorkspace />);
    await screen.findByRole("table");
    await openFilters();
    await screen.findByRole("combobox", { name: "Persona" });
    await waitFor(() => expect(optionsOf("Persona")).toEqual(["Todas las personas", "Ana López", "Luis Soto (ex miembro)"]));
    expect(optionsOf("Acción")).toEqual([
      "Todas las acciones", "Inició sesión", "Cerró sesión", "Inició la descarga de un CV", "Exportó la auditoría"]);
    expect(["Sesiones", "Consultas sensibles", "Auditoría"].every(group => screen.getByText(group))).toBe(true);
    expect(optionsOf("Vacante")).toEqual(["Todas las vacantes", "Ejecutivo de ventas", "Vacante eliminada"]);
  });

  it("writes each filter to the URL and re-reads the list with it", async () => {
    render(<AuditWorkspace />);
    await screen.findByRole("table");
    const user = await openFilters();
    await waitFor(() => expect((optionsOf("Persona")).length).toBe(3));
    await pick(user, "Persona", "Ana López");
    await pick(user, "Acción", "Cerró sesión");
    await pick(user, "Vacante", "Ejecutivo de ventas");
    const day = await pickFirstOfMonth(user, "Desde");
    await pickFirstOfMonth(user, "Hasta");
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ filters: { actor_id: anaId, event_type: ["SessionEnded"], vacancy_id: vacancyId, from: day, to: day }, limit: 50 }));
    const params = new URLSearchParams(window.location.search);
    expect(params.get("actor_id")).toBe(anaId);
    expect(params.getAll("event_type")).toEqual(["SessionEnded"]);
    expect(params.get("vacancy_id")).toBe(vacancyId);
    expect(params.get("from")).toBe(day);
    expect(params.get("to")).toBe(day);
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    await user.click(screen.getAllByRole("button", { name: "Limpiar filtros" })[0]);
    expect(window.location.search).toBe("");
  });

  it("uses the shared shadcn date picker for «Desde» and «Hasta», never a native date input", async () => {
    render(<AuditWorkspace />);
    await screen.findByRole("table");
    await openFilters();
    expect(document.querySelectorAll('[data-slot="date-picker-field"]')).toHaveLength(2);
    expect(document.querySelector('input[type="date"]')).toBeNull();
    for (const label of ["Desde", "Hasta"]) expect(screen.getByLabelText(label)).toHaveTextContent("Elige una fecha");
    expect(screen.getByText("Las fechas se cuentan en hora de la Ciudad de México.")).toBeInTheDocument();
  });

  it("starts from the URL: the panel is open, controls and removable chips show it and the first read uses it", async () => {
    at(`?actor_id=${luisId}&event_type=SessionStarted&event_type=SessionEnded&from=2026-11-01`);
    render(<AuditWorkspace />);
    await screen.findByRole("table");
    expect(list).toHaveBeenCalledWith({ filters: { actor_id: luisId, event_type: ["SessionStarted", "SessionEnded"], from: "2026-11-01" }, limit: 50 });
    expect(await screen.findByRole("combobox", { name: "Persona" })).toHaveTextContent("Luis Soto (ex miembro)");
    expect(screen.getByRole("combobox", { name: "Acción" })).toHaveTextContent("Varias acciones (2)");
    expect(screen.getByLabelText("Desde")).toHaveTextContent("1 de noviembre de 2026");
    expect(screen.getByRole("button", { name: /^Filtros/ })).toHaveTextContent("4");
    await userEvent.click(screen.getByRole("button", { name: "Quitar filtro Desde: 1 de noviembre de 2026" }));
    expect(new URLSearchParams(window.location.search).get("from")).toBeNull();
    expect(new URLSearchParams(window.location.search).get("actor_id")).toBe(luisId);
  });

  it("still filters by the known Annex actions when the catalogs cannot be loaded, and says so", async () => {
    options.mockResolvedValue(failure("server_error"));
    render(<AuditWorkspace />);
    await screen.findByRole("table");
    const user = await openFilters();
    expect(await screen.findByText("No pudimos cargar las opciones de persona y vacante.")).toBeInTheDocument();
    expect(optionsOf("Acción")).toContain("Vio el detalle de un candidato");
    options.mockResolvedValue(okOptions);
    await user.click(screen.getByRole("button", { name: "Reintentar opciones" }));
    await waitFor(() => expect(optionsOf("Persona")).toContain("Luis Soto (ex miembro)"));
  });

  it("uses the generic label for a server-side type the frontend does not know", async () => {
    options.mockResolvedValue({ ...okOptions, types: [...auditTypes, { event_type: "SomethingNew", category: "brand_new" }] });
    render(<AuditWorkspace />);
    await screen.findByRole("table");
    await openFilters();
    await waitFor(() => expect(optionsOf("Acción")).toContain("Otra acción (SomethingNew)"));
    expect(screen.getByText("Otras acciones")).toBeInTheDocument();
  });
});

describe("export (owner only, requires from/to, ≤ 366 days)", () => {
  let created: Blob[];
  let downloads: string[];
  const fetchMock = vi.fn();
  beforeEach(() => {
    created = []; downloads = [];
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    URL.createObjectURL = vi.fn((blob: Blob) => { created.push(blob); return "blob:audit"; });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download); });
  });
  afterEach(() => vi.restoreAllMocks());
  const exportButton = () => screen.getByRole("button", { name: /Exportar CSV|Exportando/ });
  const csv = () => new Response("﻿occurred_at\r\n", { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="auditoria-2026-11-04.csv"' } });

  it("asks for both dates before calling anything", async () => {
    render(<AuditWorkspace />);
    await screen.findByRole("table");
    await userEvent.click(exportButton());
    expect(screen.getByRole("alert")).toHaveTextContent("Elige las fechas «Desde» y «Hasta» para exportar.");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });

  it("refuses a range over 366 days", async () => {
    at("?from=2025-01-01&to=2026-11-04");
    render(<AuditWorkspace />);
    await screen.findByRole("table");
    await userEvent.click(exportButton());
    expect(screen.getByRole("alert")).toHaveTextContent("El rango no puede pasar de 366 días.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an inverted range", async () => {
    at("?from=2026-11-05&to=2026-11-04");
    render(<AuditWorkspace />);
    await screen.findByRole("table");
    await userEvent.click(exportButton());
    expect(screen.getByRole("alert")).toHaveTextContent("La fecha «Desde» debe ser anterior o igual a «Hasta».");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs the filters to the same-origin route and downloads the CSV under the server's filename", async () => {
    at(`?actor_id=${anaId}&event_type=SessionEnded&from=2026-11-01&to=2026-11-04`);
    fetchMock.mockResolvedValue(csv());
    render(<AuditWorkspace />);
    await screen.findByRole("table");
    await userEvent.click(exportButton());
    await waitFor(() => expect(downloads).toEqual(["auditoria-2026-11-04.csv"]));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/company/audit-events/export");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ actor_id: anaId, event_types: ["SessionEnded"], from: "2026-11-01", to: "2026-11-04" });
    expect(created).toHaveLength(1);
    expect(await screen.findByText(/Exportación descargada/)).toBeInTheDocument();
  });

  it("shows the too-large message with row_count and limit and downloads nothing", async () => {
    at("?from=2026-01-01&to=2026-11-04");
    fetchMock.mockResolvedValue(Response.json({ error: "audit_export_too_large", code: "audit_export_too_large", row_count: 60123, limit: 50000 }, { status: 422 }));
    render(<AuditWorkspace />);
    await screen.findByRole("table");
    await userEvent.click(exportButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("La exportación tiene 60,123 registros y el límite es 50,000. Acorta el rango de fechas o agrega filtros; no se descargó ningún archivo.");
    expect(created).toHaveLength(0);
    expect(downloads).toHaveLength(0);
  });

  it.each([
    [403, { code: "forbidden" }, "Solo el owner de la empresa puede exportar la auditoría."],
    [503, { code: "no_response" }, "No pudimos generar la exportación. No se descargó ningún archivo"],
  ])("maps a %s to a clear message and downloads nothing", async (status, body, message) => {
    at("?from=2026-11-01&to=2026-11-04");
    fetchMock.mockResolvedValue(Response.json({ error: body.code, ...body }, { status }));
    render(<AuditWorkspace />);
    await screen.findByRole("table");
    await userEvent.click(exportButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(created).toHaveLength(0);
  });

  it("treats a network failure as an error with no download", async () => {
    at("?from=2026-11-01&to=2026-11-04");
    fetchMock.mockRejectedValue(new Error("offline"));
    render(<AuditWorkspace />);
    await screen.findByRole("table");
    await userEvent.click(exportButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("No se descargó ningún archivo");
    expect(created).toHaveLength(0);
  });

  it("blocks a second click while the export is running", async () => {
    at("?from=2026-11-01&to=2026-11-04");
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    render(<AuditWorkspace />);
    await screen.findByRole("table");
    await userEvent.click(exportButton());
    expect(exportButton()).toBeDisabled();
    await userEvent.click(exportButton());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(csv()); });
    await waitFor(() => expect(exportButton()).toBeEnabled());
  });
});
