import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../actions", () => ({ loadMetricsAccessAction: vi.fn(), loadDetailAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { loadDetailAction, loadMetricsAccessAction } from "../actions";
import type { DetailPage, MetricsResult } from "../model";
import { applicationList, candidateList, clientId, deliveryList, deliveryListRow, draftId, jorge, jorgeId, placementList, vacancyList } from "../test-fixtures";
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

  it("says «N registros» without a status filter", async () => {
    at(`kind=vacancies&${period}&scope=assigned`);
    load.mockResolvedValue(ok({ kind: "vacancies", page: vacancyList({ total: 12, applied_filters: { scope: "assigned" } }) }));
    render(<MetricsDetailPage />);
    expect(await screen.findByText("12 registros")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Vacantes asignadas" })).toBeInTheDocument();
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
    expect(headers).toEqual(["Vacante", "Portal", "Sitio de carreras", "Manual", "Sin distinguir", "Total"]);
    expect(headers.length).toBeLessThanOrEqual(6);
    const row = screen.getAllByRole("row")[1];
    expect(within(row).getAllByRole("cell").map(cell => cell.textContent)).toEqual(["Analista de crédito Sr.", "100", "30", "5", "0", "130"]);
    expect(screen.getByText("Vacantes 1–2")).toBeInTheDocument();
    expect(screen.queryByText(/de 154/)).not.toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Canal" })).getByRole("button", { name: "Todos 515" })).toBeInTheDocument();
  });
});
