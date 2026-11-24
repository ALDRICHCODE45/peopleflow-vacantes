import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { loadStakeholderVacanciesAction } from "./actions";
import { stakeholderVacanciesSchema, type StakeholderVacancy } from "./model";
import { StakeholderVacanciesPage } from "./stakeholder-vacancies-page";
import { activeRow, closedRow, draftRow, ids, pausedRow, replacementRow } from "./test-fixtures";

vi.mock("./actions", () => ({ loadStakeholderVacanciesAction: vi.fn() }));
const load = vi.mocked(loadStakeholderVacanciesAction);
const rows = (...wire: Record<string, unknown>[]): StakeholderVacancy[] => stakeholderVacanciesSchema.parse({ items: wire, next_cursor: null }).items;
const page = (items: StakeholderVacancy[], nextCursor: string | null = null) => ({ ok: true as const, items, nextCursor });
const failure = (reason: string) => ({ ok: false as const, reason, reference: {} }) as never;
const everything = () => rows(closedRow(), draftRow(), activeRow(), pausedRow(), replacementRow());
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

const list = () => screen.getByRole("list", { name: "Vacantes" });
const row = (name: string) => within(list()).getByRole("link", { name }).closest("li") as HTMLElement;

// S12: the stakeholder's own read-only «Vacantes» list.
it("shows a loading state and asks for the first page only once", async () => {
  load.mockReturnValue(new Promise(() => {}));
  render(<StakeholderVacanciesPage />);
  expect(screen.getByRole("status", { name: "Cargando vacantes" })).toBeVisible();
  expect(load).toHaveBeenCalledExactlyOnceWith();
});

it("lists each vacancy with its title, state, tags and documents count, each one linking to its Documentos tab", async () => {
  load.mockResolvedValue(page(everything()));
  render(<StakeholderVacanciesPage />);
  expect(await screen.findByRole("list", { name: "Vacantes" })).toBeVisible();
  const links = within(list()).getAllByRole("link");
  expect(links).toHaveLength(5);
  expect(row("Analista contable").querySelector("a")).toHaveAttribute("href", `/empresa/vacantes/${ids.closed}/documentos`);
  expect(within(row("Sin título")).getByRole("link", { name: "Sin título" })).toHaveAttribute("href", `/empresa/vacantes/${ids.draft}/documentos`);
  expect(within(row("Desarrollador(a) backend")).getByRole("link")).toHaveAttribute("href", `/empresa/vacantes/${ids.active}/documentos`);
  // The closed one reads its result with the coverage it closed with; the draft is «Borrador»; the replacement keeps its tags.
  const closed = row("Analista contable");
  expect(within(closed).getByText("Cerrada · Cubierta")).toHaveAttribute("data-slot", "badge");
  expect(within(closed).getByText("7 documentos")).toBeVisible();
  expect(within(row("Sin título")).getByText("Borrador")).toHaveAttribute("data-slot", "badge");
  expect(within(row("Sin título")).getByText("1 documento")).toBeVisible();
  expect(within(row("Desarrollador(a) backend")).getByText("Activa")).toBeVisible();
  expect(within(row("Desarrollador(a) backend")).getByText("Sin documentos")).toBeVisible();
  expect(within(row("Diseñador(a) UX")).getByText("Pausada")).toBeVisible();
  const replacement = row("Auxiliar administrativo");
  expect(within(replacement).getByText("Privada")).toBeVisible();
  expect(within(closed).queryByText("Reemplazo")).toBeNull();
});

it("reads «Cerrada · Cubierta al cierre» when the coverage fell below the required places", async () => {
  load.mockResolvedValue(page(rows(closedRow({ coverage: { covered: 1, required: 2 } }))));
  render(<StakeholderVacanciesPage />);
  expect(await screen.findByText("Cerrada · Cubierta al cierre")).toHaveAttribute("data-slot", "badge");
});

it("offers read-only rows: no create, publish or edit action anywhere", async () => {
  load.mockResolvedValue(page(everything()));
  render(<StakeholderVacanciesPage />);
  await screen.findByRole("list", { name: "Vacantes" });
  expect(screen.queryByRole("button", { name: /Nueva vacante|Crear|Publicar|Editar|Pipeline/ })).toBeNull();
  expect(screen.queryByRole("link", { name: /Nueva vacante|Pipeline|Configuración/ })).toBeNull();
});

it("filters on the client: Todas, Borradores, Activas, Pausadas and Cerradas, with the counts of what is loaded", async () => {
  const user = userEvent.setup();
  load.mockResolvedValue(page(everything()));
  render(<StakeholderVacanciesPage />);
  await screen.findByRole("list", { name: "Vacantes" });
  const filters = within(screen.getByRole("tablist", { name: "Filtrar por estado" }));
  expect(filters.getAllByRole("tab").map(tab => tab.textContent)).toEqual(["Todas5", "Borradores1", "Activas2", "Pausadas1", "Cerradas1"]);
  const titles = () => within(list()).getAllByRole("link").map(link => link.textContent);
  await user.click(filters.getByRole("tab", { name: /Borradores/ }));
  expect(titles()).toEqual(["Sin título"]);
  await user.click(filters.getByRole("tab", { name: /Activas/ }));
  expect(titles()).toEqual(["Desarrollador(a) backend", "Auxiliar administrativo"]);
  await user.click(filters.getByRole("tab", { name: /Pausadas/ }));
  expect(titles()).toEqual(["Diseñador(a) UX"]);
  await user.click(filters.getByRole("tab", { name: /Cerradas/ }));
  expect(titles()).toEqual(["Analista contable"]);
  await user.click(filters.getByRole("tab", { name: /Todas/ }));
  expect(titles()).toHaveLength(5);
  expect(load).toHaveBeenCalledTimes(1);
});

it("says so when a filter matches nothing and lets the person go back to Todas", async () => {
  const user = userEvent.setup();
  load.mockResolvedValue(page(rows(closedRow())));
  render(<StakeholderVacanciesPage />);
  await screen.findByRole("list", { name: "Vacantes" });
  await user.click(screen.getByRole("tab", { name: /Pausadas/ }));
  expect(screen.getByRole("heading", { name: "Sin resultados" })).toBeVisible();
  expect(screen.queryByRole("list", { name: "Vacantes" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Mostrar todas" }));
  expect(screen.getByRole("list", { name: "Vacantes" })).toBeVisible();
});

it("shows an empty state when the company has no vacancies", async () => {
  load.mockResolvedValue(page([]));
  render(<StakeholderVacanciesPage />);
  expect(await screen.findByRole("heading", { name: "Todavía no hay vacantes" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
});

it("loads the next page with the keyset cursor on «Cargar más», appends it once and hides the button at the end", async () => {
  const user = userEvent.setup();
  load.mockResolvedValueOnce(page(rows(closedRow(), draftRow()), "cursor-1")).mockResolvedValueOnce(page(rows(draftRow(), activeRow()), null));
  render(<StakeholderVacanciesPage />);
  await screen.findByRole("list", { name: "Vacantes" });
  expect(within(list()).getAllByRole("link")).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "Cargar más" }));
  await waitFor(() => expect(within(list()).getAllByRole("link")).toHaveLength(3));
  expect(load).toHaveBeenNthCalledWith(2, { cursor: "cursor-1" });
  expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
});

it("S12 (T3e): while more pages exist the counts read «N+» and the list says «Mostrando N vacantes»; once everything is loaded they are exact", async () => {
  const user = userEvent.setup();
  load.mockResolvedValueOnce(page(rows(closedRow(), draftRow(), activeRow()), "cursor-1")).mockResolvedValueOnce(page(rows(pausedRow()), null));
  render(<StakeholderVacanciesPage />);
  await screen.findByRole("list", { name: "Vacantes" });
  const tabs = () => within(screen.getByRole("tablist", { name: "Filtrar por estado" })).getAllByRole("tab").map(tab => tab.textContent);
  expect(tabs()).toEqual(["Todas3+", "Borradores1+", "Activas1+", "Pausadas0+", "Cerradas1+"]);
  expect(screen.getByText(/Mostrando 3 vacantes/)).toHaveTextContent("Mostrando 3 vacantes · hay más por cargar");
  await user.click(screen.getByRole("button", { name: "Cargar más" }));
  await waitFor(() => expect(tabs()).toEqual(["Todas4", "Borradores1", "Activas1", "Pausadas1", "Cerradas1"]));
  expect(screen.getByText(/Mostrando 4 vacantes/)).toHaveTextContent(/^Mostrando 4 vacantes$/);
  await user.click(screen.getByRole("tab", { name: /Cerradas/ }));
  expect(screen.getByText(/Mostrando 1 vacante/)).toHaveTextContent(/^Mostrando 1 vacante$/);
});

it("keeps «Cargar más» while a filter is on, because the next page can hold more of that state", async () => {
  const user = userEvent.setup();
  load.mockResolvedValue(page(rows(closedRow()), "cursor-1"));
  render(<StakeholderVacanciesPage />);
  await screen.findByRole("list", { name: "Vacantes" });
  await user.click(screen.getByRole("tab", { name: /Activas/ }));
  expect(screen.getByRole("heading", { name: "Sin resultados" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Cargar más" })).toBeVisible();
});

it("keeps the loaded rows and offers a retry when the next page fails", async () => {
  const user = userEvent.setup();
  load.mockResolvedValueOnce(page(rows(closedRow()), "cursor-1")).mockResolvedValueOnce(failure("no_response")).mockResolvedValueOnce(page(rows(activeRow()), null));
  render(<StakeholderVacanciesPage />);
  await screen.findByRole("list", { name: "Vacantes" });
  await user.click(screen.getByRole("button", { name: "Cargar más" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar más vacantes");
  expect(within(list()).getAllByRole("link")).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Cargar más" }));
  await waitFor(() => expect(within(list()).getAllByRole("link")).toHaveLength(2));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(load).toHaveBeenNthCalledWith(3, { cursor: "cursor-1" });
});

it.each([
  ["no_response", /Revisa tu conexión/],
  ["server_error", /problema en el servidor/],
  ["forbidden", /No tienes permiso/],
  ["unauthenticated", /sesión expiró/],
  ["unrecognized_response", /No pudimos leer/],
  ["invalid_request", /No pudimos completar/],
])("shows an error with a retry when the first read fails (%s)", async (reason, message) => {
  const user = userEvent.setup();
  load.mockResolvedValueOnce(failure(reason)).mockResolvedValueOnce(page(rows(closedRow())));
  render(<StakeholderVacanciesPage />);
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("No pudimos cargar las vacantes");
  expect(alert).toHaveTextContent(message);
  expect(screen.queryByRole("list", { name: "Vacantes" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Reintentar" }));
  expect(await screen.findByRole("list", { name: "Vacantes" })).toBeVisible();
  expect(load).toHaveBeenCalledTimes(2);
});

it("turns a thrown action into the no-response error instead of a blank page", async () => {
  load.mockRejectedValue(new Error("boom"));
  render(<StakeholderVacanciesPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Revisa tu conexión");
});

it("D20: the first page's counts_by_status gives exact tab counts, without «+», even while more pages exist and after «Cargar más»", async () => {
  const user = userEvent.setup();
  const countsByStatus = { all: 9, draft: 1, active: 5, paused: 1, closed: 2 };
  load.mockResolvedValueOnce({ ...page(rows(closedRow(), draftRow(), activeRow()), "cursor-1"), countsByStatus }).mockResolvedValueOnce({ ...page(rows(pausedRow()), null), countsByStatus: null });
  render(<StakeholderVacanciesPage />);
  await screen.findByRole("list", { name: "Vacantes" });
  const tabs = () => within(screen.getByRole("tablist", { name: "Filtrar por estado" })).getAllByRole("tab").map(tab => tab.textContent);
  expect(tabs()).toEqual(["Todas9", "Borradores1", "Activas5", "Pausadas1", "Cerradas2"]);
  expect(screen.getByText(/Mostrando 3 vacantes/)).toHaveTextContent("Mostrando 3 vacantes · hay más por cargar");
  await user.click(screen.getByRole("button", { name: "Cargar más" }));
  await screen.findByText(/Mostrando 4 vacantes/);
  expect(tabs()).toEqual(["Todas9", "Borradores1", "Activas5", "Pausadas1", "Cerradas2"]);
});
it("D20: a null or absent counts_by_status keeps the «N+» tab counts", async () => {
  load.mockResolvedValueOnce({ ...page(rows(closedRow(), draftRow()), "cursor-1"), countsByStatus: null });
  render(<StakeholderVacanciesPage />);
  await screen.findByRole("list", { name: "Vacantes" });
  expect(within(screen.getByRole("tablist", { name: "Filtrar por estado" })).getAllByRole("tab").map(tab => tab.textContent)).toEqual(["Todas2+", "Borradores1+", "Activas0+", "Pausadas0+", "Cerradas1+"]);
});
