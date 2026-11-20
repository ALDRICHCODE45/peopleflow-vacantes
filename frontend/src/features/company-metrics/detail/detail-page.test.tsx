import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../actions", () => ({ loadMetricsAccessAction: vi.fn(), loadDetailAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { loadDetailAction, loadMetricsAccessAction } from "../actions";
import type { DetailPage, MetricsResult } from "../model";
import { applicationList, candidateList, clientId, deliveryList, deliveryListRow, draftId, jorge, jorgeId, placementList, reassignmentList, replacementKeys, vacancyList } from "../test-fixtures";
import { MetricsDetailPage } from "./detail-page";

const access = vi.mocked(loadMetricsAccessAction);
const load = vi.mocked(loadDetailAction);
const period = "from=2026-08-01&to=2026-10-31";
const at = (search: string) => window.history.replaceState(null, "", `/empresa/metricas/detalle?${search}`);
const search = () => Object.fromEntries(new URLSearchParams(window.location.search));
const ok = (data: DetailPage): MetricsResult<DetailPage> => ({ ok: true, data });
const deliveries = (overrides: Parameters<typeof deliveryList>[0] = {}) => ok({ kind: "deliveries", page: deliveryList(overrides) });
const lastCall = () => load.mock.calls.at(-1)![0];
/** The summary line holds bold parts, so it is matched as one paragraph. */
const summaryText = (text: string) => screen.findByText((_, node) => node?.tagName === "P" && node.textContent === text);

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-07T18:00:00Z"));
  access.mockResolvedValue({ kind: "allowed", role: "owner" });
  load.mockResolvedValue(deliveries());
  at(`kind=deliveries&${period}&recruiter_id=${jorgeId}&result=late`);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("metrics detail page (artboard 08)", () => {
  it("names the figure from the kind, the filters and the resolved names, with chips and a way back to the board", async () => {
    render(<MetricsDetailPage />);
    expect(await screen.findByRole("heading", { level: 2, name: "Entregas tarde · Jorge Paredes" })).toBeInTheDocument();
    const crumb = screen.getByRole("navigation", { name: "Ruta" });
    expect(within(crumb).getByRole("link", { name: "Métricas" })).toHaveAttribute("href", `/empresa/metricas?${period}&recruiter_id=${jorgeId}`);
    expect(within(crumb).getByText("Entregas tarde")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText(/Definiciones v2/)).toHaveTextContent(/1 ago 2026 – 31 oct 2026/);
    const chips = screen.getByRole("list", { name: "Filtros activos" });
    expect(within(chips).getByText("Reclutador: Jorge Paredes")).toBeInTheDocument();
    expect(within(chips).getByText("Estado: Tarde")).toBeInTheDocument();
    expect(lastCall()).toEqual({ kind: "deliveries", query: { from: "2026-08-01", to: "2026-10-31", recruiter_id: jorgeId, result: "late" } });
  });

  it("returns «Volver» to the board it came from, not to one rebuilt from the figure's filters", async () => {
    const back = "/empresa/metricas?from=2026-08-01&to=2026-10-31";
    at(`kind=vacancies&from=2026-05-02&to=2026-07-31&recruiter_id=${jorgeId}&scope=assigned&back=${encodeURIComponent(back)}`);
    load.mockResolvedValue(ok({ kind: "vacancies", page: vacancyList({ total: 12, applied_filters: { scope: "assigned", recruiter: jorge } }) }));
    render(<MetricsDetailPage />);
    const crumb = await screen.findByRole("navigation", { name: "Ruta" });
    expect(within(crumb).getByRole("link", { name: "Métricas" })).toHaveAttribute("href", back);
    expect(lastCall()).toEqual({ kind: "vacancies", query: { from: "2026-05-02", to: "2026-07-31", recruiter_id: jorgeId, scope: "assigned" } });
    await userEvent.click(await screen.findByRole("button", { name: "Quitar filtro Reclutador: Jorge Paredes" }));
    expect(search()).toEqual({ kind: "vacancies", from: "2026-05-02", to: "2026-07-31", scope: "assigned", back });
    expect(within(crumb).getByRole("link", { name: "Métricas" })).toHaveAttribute("href", back);
  });

  it("stacks each record as a list row on a narrow screen, every cell named by its column (rule 14)", async () => {
    render(<MetricsDetailPage />);
    const table = await screen.findByRole("table");
    expect(table).toHaveClass("max-md:block");
    const [vacancy, ...cells] = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
    expect(vacancy).not.toHaveAttribute("data-label");
    expect(cells.map(cell => cell.getAttribute("data-label"))).toEqual(["Cliente o área", "Fecha meta", "Entregada", "Días de retraso", "Candidatos entregados"]);
  });

  it("paints the violet text (breadcrumb, record links, selected status) with the accent text token that keeps 4.5:1 in dark mode", async () => {
    render(<MetricsDetailPage />);
    const crumb = await screen.findByRole("navigation", { name: "Ruta" });
    expect(within(crumb).getByRole("link", { name: "Métricas" })).toHaveClass("text-primary-text");
    expect(await screen.findByRole("link", { name: "Coordinador de logística" })).toHaveClass("text-primary-text");
    const selected = within(screen.getByRole("group", { name: "Estado de la entrega" })).getByRole("button", { name: "Tarde 4" });
    expect(selected).toHaveClass("text-primary-text");
    for (const element of [within(crumb).getByRole("link", { name: "Métricas" }), selected]) expect(element).not.toHaveClass("text-primary");
  });

  it("removes a chip by rewriting the URL", async () => {
    render(<MetricsDetailPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Quitar filtro Reclutador: Jorge Paredes" }));
    expect(search()).toEqual({ kind: "deliveries", from: "2026-08-01", to: "2026-10-31", result: "late" });
    await waitFor(() => expect(lastCall().query).toEqual({ from: "2026-08-01", to: "2026-10-31", result: "late" }));
  });

  it("shows «Persona no disponible» and «Vacante no disponible» for ids the backend cannot name", async () => {
    at(`kind=deliveries&${period}&recruiter_id=${jorgeId}&vacancy_id=${draftId}`);
    load.mockResolvedValue(deliveries({ total: 0, items: [], applied_filters: { recruiter: { ...jorge, name: null, former_member: true }, vacancy: { draft_id: draftId, title: null } } }));
    render(<MetricsDetailPage />);
    const chips = await screen.findByRole("list", { name: "Filtros activos" });
    expect(await within(chips).findByText("Reclutador: Persona no disponible")).toBeInTheDocument();
    expect(within(chips).getByText("Vacante: Vacante no disponible")).toBeInTheDocument();
  });

  it("says how many of the figure's records the list holds, from the facets", async () => {
    render(<MetricsDetailPage />);
    expect(await screen.findByText((_, node) => node?.tagName === "P" && /^4 de 5 entregas de Jorge Paredes llegaron tarde en el periodo — 80\s?%\.$/.test(node.textContent ?? ""))).toBeInTheDocument();
  });

  it("names the figure in the summary instead of «registros»", async () => {
    at(`kind=vacancies&${period}&scope=assigned`);
    load.mockResolvedValue(ok({ kind: "vacancies", page: vacancyList({ total: 12, applied_filters: { scope: "assigned" } }) }));
    render(<MetricsDetailPage />);
    expect(await summaryText("12 vacantes asignadas en el periodo.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Vacantes asignadas" })).toBeInTheDocument();
  });

  it("states a conversion as «N de M vacantes cerradas … tuvo/tuvieron placement — X %», counting the closed vacancies without the credit filter", async () => {
    at(`kind=vacancies&${period}&scope=closed_assigned&recruiter_id=${jorgeId}&credited_to=${jorgeId}`);
    load.mockImplementation(async ({ query }) => ok({ kind: "vacancies", page: vacancyList({
      total: query.credited_to ? 1 : 4, applied_filters: { recruiter: jorge, ...(query.credited_to ? { credited_to: jorge } : {}), scope: "closed_assigned" },
    }) }));
    render(<MetricsDetailPage />);
    expect(await screen.findByText((_, node) => node?.tagName === "P" && /^1 de 4 vacantes cerradas de Jorge Paredes tuvo placement en el periodo — 25\s?%\.$/.test(node.textContent ?? ""))).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith({ kind: "vacancies", query: { from: "2026-08-01", to: "2026-10-31", recruiter_id: jorgeId, scope: "closed_assigned" } });
  });

  it("says «en el periodo anterior» for a figure opened from «vs periodo anterior» on the board", async () => {
    at(`kind=vacancies&from=2026-05-01&to=2026-07-31&scope=assigned&back=${encodeURIComponent(`/empresa/metricas?${period}`)}`);
    load.mockResolvedValue(ok({ kind: "vacancies", page: vacancyList({ total: 21, applied_filters: { scope: "assigned" } }) }));
    render(<MetricsDetailPage />);
    expect(await summaryText("21 vacantes asignadas en el periodo anterior.")).toBeInTheDocument();
  });

  it("names the month of a monthly figure opened from a recruiter page", async () => {
    const back = `/empresa/metricas/reclutadores/${jorgeId}?from=2026-08-20&to=2026-11-17`;
    at(`kind=vacancies&from=2026-09-01&to=2026-09-30&scope=assigned&recruiter_id=${jorgeId}&back=${encodeURIComponent(back)}`);
    load.mockResolvedValue(ok({ kind: "vacancies", page: vacancyList({ total: 6, applied_filters: { scope: "assigned", recruiter: jorge } }) }));
    render(<MetricsDetailPage />);
    expect(await screen.findByRole("heading", { level: 2, name: "Vacantes asignadas · Jorge Paredes · septiembre 2026" })).toBeInTheDocument();
    expect(await summaryText("6 vacantes asignadas a Jorge Paredes en septiembre 2026.")).toBeInTheDocument();
  });

  it("switches status from the facet counts and rewrites the URL filter", async () => {
    render(<MetricsDetailPage />);
    const group = await screen.findByRole("group", { name: "Estado de la entrega" });
    expect(within(group).getByRole("button", { name: "Tarde 4" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "Todas 5" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(within(group).getByRole("button", { name: "A tiempo 1" }));
    expect(search().result).toBe("on_time");
    await waitFor(() => expect(lastCall().query.result).toBe("on_time"));
    await userEvent.click(within(group).getByRole("button", { name: "Todas 5" }));
    expect(search()).not.toHaveProperty("result");
  });

  it("sorts on the server from the header buttons, with aria-sort on the sorted column", async () => {
    render(<MetricsDetailPage />);
    await screen.findByRole("table");
    expect(screen.getByRole("columnheader", { name: /Fecha meta/ })).toHaveAttribute("aria-sort", "descending");
    await userEvent.click(screen.getByRole("button", { name: /Días de retraso/ }));
    expect(search()).toMatchObject({ sort: "business_days_late", order: "desc" });
    await waitFor(() => expect(screen.getByRole("columnheader", { name: /Días de retraso/ })).toHaveAttribute("aria-sort", "descending"));
    expect(screen.getByRole("columnheader", { name: /Fecha meta/ })).not.toHaveAttribute("aria-sort");
    await userEvent.click(screen.getByRole("button", { name: /Días de retraso/ }));
    expect(search()).toMatchObject({ sort: "business_days_late", order: "asc" });
    await userEvent.click(screen.getByRole("button", { name: /Vacante/ }));
    expect(search()).toMatchObject({ sort: "title", order: "asc" });
    await waitFor(() => expect(lastCall().query).toMatchObject({ sort: "title", order: "asc" }));
  });

  it("pages on the server with the cursor kept out of the URL", async () => {
    load.mockResolvedValueOnce(deliveries({ next_cursor: "c2" }))
      .mockResolvedValueOnce(deliveries({ next_cursor: null, items: [deliveryListRow({ vacancy: { draft_id: "30000000-0000-4000-8000-000000000007", title: "Jefe de almacén" } }), deliveryListRow({ vacancy: { draft_id: "30000000-0000-4000-8000-000000000008", title: "Supervisor de planta" } })] }));
    render(<MetricsDetailPage />);
    expect(await screen.findByText("1–2 de 4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(await screen.findByText("3–4 de 4")).toBeInTheDocument();
    expect(lastCall().cursor).toBe("c2");
    expect(screen.getByRole("link", { name: "Jefe de almacén" })).toBeInTheDocument();
    expect(window.location.search).not.toContain("c2");
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Anterior" }));
    expect(await screen.findByText("1–2 de 4")).toBeInTheDocument();
    expect(lastCall().cursor).toBeUndefined();
  });

  it("shows a table-shaped skeleton while the first page loads", async () => {
    load.mockReturnValue(new Promise(() => {}));
    render(<MetricsDetailPage />);
    expect(await screen.findByRole("status", { name: "Cargando los registros" })).toBeInTheDocument();
  });

  it("offers «Ver todas» when a status filter leaves no records", async () => {
    at(`kind=deliveries&${period}&recruiter_id=${jorgeId}&result=overdue`);
    load.mockResolvedValue(deliveries({ total: 0, items: [], applied_filters: { recruiter: jorge, result: ["overdue"] } }));
    render(<MetricsDetailPage />);
    expect(await screen.findByRole("heading", { name: "Sin resultados" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ver todas" }));
    expect(search()).not.toHaveProperty("result");
  });

  it("shows a failure card with retry", async () => {
    load.mockResolvedValueOnce({ ok: false, reason: "server_error", reference: {} });
    render(<MetricsDetailPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("links an owner to the vacancy board", async () => {
    render(<MetricsDetailPage />);
    expect(await screen.findByRole("link", { name: "Coordinador de logística" })).toHaveAttribute("href", `/empresa/vacantes/${draftId}/pipeline`);
  });

  it("keeps a stakeholder inside metrics and never links a candidate", async () => {
    access.mockResolvedValue({ kind: "allowed", role: "stakeholder" });
    render(<MetricsDetailPage />);
    expect(await screen.findByRole("link", { name: "Coordinador de logística" })).toHaveAttribute("href", `/empresa/metricas/detalle?kind=deliveries&${period}&vacancy_id=${draftId}`);
    cleanup();
    at(`kind=placements&${period}&requester_kind=client&requester_id=${clientId}`);
    load.mockResolvedValue(ok({ kind: "placements", page: placementList() }));
    render(<MetricsDetailPage />);
    expect(await screen.findByRole("heading", { level: 2, name: "Placements · Grupo Bimbo" })).toBeInTheDocument();
    expect(screen.getByText("Brenda Sánchez Villegas").closest("a")).toBeNull();
  });

  it("exports with the same query and explains a too-large export", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ code: "metrics_export_too_large", message: "Son más de 50,000 filas: acota el periodo o los filtros" }, { status: 422 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<MetricsDetailPage />);
    // POST like the audit export: SameSite=Lax keeps the session cookie off any cross-site request.
    await userEvent.click(await screen.findByRole("button", { name: "Exportar CSV" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Son más de 50,000 filas: acota el periodo o los filtros");
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/company/metrics/deliveries/export?${period}&recruiter_id=${jorgeId}&result=late`);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", credentials: "same-origin" });
  });

  it("lists candidates in stage as plain text for every role, with the stage switch, «Solo detenidos» and «Foto de hoy»", async () => {
    at(`kind=candidates&${period}&stage_kind=screening&stalled=true`);
    load.mockResolvedValue(ok({ kind: "candidates", page: candidateList() }));
    render(<MetricsDetailPage />);
    expect(await screen.findByRole("heading", { level: 2, name: "Candidatos detenidos en Screening" })).toBeInTheDocument();
    expect(lastCall()).toEqual({ kind: "candidates", query: { from: "2026-08-01", to: "2026-10-31", stage_kind: "screening", stalled: "true" } });
    expect(screen.getByText(/Foto de hoy/)).toBeInTheDocument();
    expect(await summaryText("2 candidatos detenidos hoy.")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map(header => header.textContent)).toEqual(["Candidato", "Vacante", "Etapa", "Días hábiles en etapa", "Detenido", "Entró a la etapa"]);
    expect(screen.getByText("Lucía Herrera Gómez").closest("a")).toBeNull();
    expect(screen.getByText("Candidato sin nombre")).toBeInTheDocument();
    expect(screen.getByText("Filtro telefónico")).toBeInTheDocument();
    expect(screen.getByText("Columna retirada")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Analista de crédito Sr." })[0]).toHaveAttribute("href", `/empresa/vacantes/${draftId}/pipeline`);
    const stages = screen.getByRole("group", { name: "Etapa" });
    expect(within(stages).getByRole("button", { name: "Screening 2" })).toHaveAttribute("aria-pressed", "true");
    expect(within(stages).getByRole("button", { name: "Todas 12" })).toBeInTheDocument();
    const stalled = screen.getByRole("button", { name: "Solo detenidos 2" });
    expect(stalled).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(stalled);
    expect(search()).not.toHaveProperty("stalled");
    await userEvent.click(within(stages).getByRole("button", { name: "Nuevos 2" }));
    expect(search().stage_kind).toBe("new");
    const fetchMock = vi.fn().mockResolvedValue(new Response("x", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    await userEvent.click(screen.getByRole("button", { name: "Exportar CSV" }));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/company/metrics/candidates/export?from=2026-08-01&to=2026-10-31&stage_kind=new");
  });

  it("never links a candidate for a stakeholder either", async () => {
    access.mockResolvedValue({ kind: "allowed", role: "stakeholder" });
    at(`kind=candidates&${period}`);
    load.mockResolvedValue(ok({ kind: "candidates", page: candidateList({ applied_filters: {} }) }));
    render(<MetricsDetailPage />);
    expect((await screen.findByText("Lucía Herrera Gómez")).closest("a")).toBeNull();
  });

  it("lists applications per vacancy by channel and counts the applications, not the rows", async () => {
    at(`kind=applications&${period}&channel=portal,careers_site`);
    load.mockResolvedValue(ok({ kind: "applications", page: applicationList() }));
    render(<MetricsDetailPage />);
    expect(await screen.findByRole("heading", { level: 2, name: "Postulaciones" })).toBeInTheDocument();
    expect(await summaryText("154 postulaciones en el periodo.")).toBeInTheDocument();
    const headers = screen.getAllByRole("columnheader").map(header => header.textContent);
    // Only the chosen channels, so each row adds up to its total.
    expect(headers).toEqual(["Vacante", "Portal", "Sitio de carreras", "Total"]);
    expect(headers.length).toBeLessThanOrEqual(6);
    const row = screen.getAllByRole("row")[1];
    expect(within(row).getAllByRole("cell").map(cell => cell.textContent)).toEqual(["Analista de crédito Sr.", "100", "30", "130"]);
    expect(screen.getByText("Vacantes 1–2")).toBeInTheDocument();
    expect(screen.queryByText(/de 154/)).not.toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Canal" })).getByRole("button", { name: "Todos 515" })).toBeInTheDocument();
  });
});

describe("process filter and «Reemplazo» badge on the detail lists (S7)", () => {
  const replacementRow = (title: string) => deliveryListRow({ vacancy: { draft_id: "30000000-0000-4000-8000-0000000000bb", title, ...replacementKeys } });

  it("sends process_kind with the list query, shows its chip and removes only it", async () => {
    at(`kind=placements&${period}&process_kind=replacement&held=false`);
    load.mockResolvedValue(ok({ kind: "placements", page: placementList({ applied_filters: { process_kind: "replacement" } }) }));
    render(<MetricsDetailPage />);
    expect(await screen.findByRole("heading", { level: 2, name: "Placements que no se sostuvieron · Reemplazos" })).toBeInTheDocument();
    expect(lastCall()).toEqual({ kind: "placements", query: { from: "2026-08-01", to: "2026-10-31", process_kind: "replacement", held: "false" } });
    const chips = screen.getByRole("list", { name: "Filtros activos" });
    expect(within(chips).getByText("Proceso: Reemplazos")).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Ruta" })).getByRole("link", { name: "Métricas" })).toHaveAttribute("href", `/empresa/metricas?${period}&process_kind=replacement`);
    await userEvent.click(within(chips).getByRole("button", { name: "Quitar filtro Proceso: Reemplazos" }));
    expect(search()).toEqual({ kind: "placements", from: "2026-08-01", to: "2026-10-31", held: "false" });
    await waitFor(() => expect(lastCall().query).toEqual({ from: "2026-08-01", to: "2026-10-31", held: "false" }));
  });

  it("names «Originales» the same way", async () => {
    at(`kind=deliveries&${period}&process_kind=original`);
    render(<MetricsDetailPage />);
    expect(await screen.findByText("Proceso: Originales")).toBeInTheDocument();
  });

  it.each([
    ["deliveries", () => ok({ kind: "deliveries", page: deliveryList({ items: [replacementRow("Coordinador de logística"), deliveryListRow({ vacancy: { draft_id: "30000000-0000-4000-8000-000000000003", title: "Analista de nómina", kind: "original", root_draft_id: "30000000-0000-4000-8000-000000000003", sequence: null } })] }) })],
    ["placements", () => ok({ kind: "placements", page: placementList({ items: placementList().items.map(row => ({ ...row, vacancy: { ...row.vacancy, ...replacementKeys } })) }) })],
    ["reassignments", () => ok({ kind: "reassignments", page: reassignmentList({ items: reassignmentList().items.map(row => ({ ...row, vacancy: { ...row.vacancy, ...replacementKeys } })) }) })],
    ["candidates", () => ok({ kind: "candidates", page: candidateList({ items: candidateList().items.map(row => ({ ...row, vacancy: { ...row.vacancy, ...replacementKeys } })) }) })],
    ["applications", () => ok({ kind: "applications", page: applicationList({ items: applicationList().items.map(row => ({ ...row, vacancy: { ...row.vacancy, ...replacementKeys } })) }) })],
  ] as const)("marks a replacement's vacancy with the «Reemplazo» badge in the %s rows", async (kind, page) => {
    at(`kind=${kind}&${period}`);
    load.mockResolvedValue(page());
    render(<MetricsDetailPage />);
    const table = await screen.findByRole("table");
    expect(within(table).getAllByText("Reemplazo").length).toBeGreaterThan(0);
    // The vacancy link keeps its plain accessible name: the badge is beside it, not inside it.
    for (const row of within(table).getAllByRole("row").slice(1)) {
      const first = within(row).getAllByRole("cell")[kind === "placements" || kind === "candidates" ? 1 : 0];
      expect(within(first).getByRole("link").textContent).not.toContain("Reemplazo");
    }
  });

  it("badges only the replacement rows of a mixed list", async () => {
    at(`kind=deliveries&${period}`);
    load.mockResolvedValue(ok({ kind: "deliveries", page: deliveryList({ items: [replacementRow("Coordinador de logística"), deliveryListRow({ vacancy: { draft_id: "30000000-0000-4000-8000-000000000003", title: "Analista de nómina", kind: "original", root_draft_id: "30000000-0000-4000-8000-000000000003", sequence: null } })] }) }));
    render(<MetricsDetailPage />);
    await screen.findByRole("table");
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("Reemplazo")).toBeInTheDocument();
    expect(within(rows[1]).queryByText("Reemplazo")).not.toBeInTheDocument();
  });

  it("shows no badge with an old backend's rows (no kind keys)", async () => {
    render(<MetricsDetailPage />);
    await screen.findByRole("table");
    expect(screen.queryByText("Reemplazo")).not.toBeInTheDocument();
  });

  it("tells the vacancies list does not follow the process filter (roots only), and only then", async () => {
    at(`kind=vacancies&${period}&scope=assigned&process_kind=replacement`);
    load.mockResolvedValue(ok({ kind: "vacancies", page: vacancyList({ total: 12, applied_filters: { scope: "assigned" } }) }));
    render(<MetricsDetailPage />);
    expect(await screen.findByText("Esta lista no cambia con el filtro de proceso: cuenta cada vacante una sola vez.")).toBeInTheDocument();
    cleanup();
    at(`kind=vacancies&${period}&scope=assigned`);
    render(<MetricsDetailPage />);
    await screen.findByRole("table");
    expect(screen.queryByText(/filtro de proceso/)).not.toBeInTheDocument();
    cleanup();
    at(`kind=placements&${period}&process_kind=replacement`);
    load.mockResolvedValue(ok({ kind: "placements", page: placementList() }));
    render(<MetricsDetailPage />);
    await screen.findByRole("table");
    expect(screen.queryByText(/filtro de proceso/)).not.toBeInTheDocument();
  });

  it("shows the standard filter error when the API rejects process_kind (old backend)", async () => {
    at(`kind=deliveries&${period}&process_kind=replacement`);
    load.mockResolvedValue({ ok: false, reason: "invalid_filter", reference: { status: 422 }, fields: [{ field: "process_kind", code: "unknown" }] });
    render(<MetricsDetailPage />);
    expect(await screen.findByText("No pudimos aplicar los filtros")).toBeInTheDocument();
    expect(screen.getByText("Proceso: elige todos los procesos, solo originales o solo reemplazos.")).toBeInTheDocument();
  });
});
