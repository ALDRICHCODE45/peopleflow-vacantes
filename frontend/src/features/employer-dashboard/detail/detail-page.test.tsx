import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../actions", () => ({
  listDashboardCandidatesAction: vi.fn(), listDashboardDeliveriesAction: vi.fn(), listDashboardVacanciesAction: vi.fn(), listDashboardApplicationsAction: vi.fn(),
}));
import { listDashboardApplicationsAction, listDashboardCandidatesAction, listDashboardDeliveriesAction, listDashboardVacanciesAction } from "../actions";
import { DashboardDetailPage } from "./detail-page";
import { dashboardApplications, dashboardCandidates, dashboardDeliveries, dashboardVacancies, draftId } from "./test-fixtures";

const candidates = vi.mocked(listDashboardCandidatesAction);
const deliveries = vi.mocked(listDashboardDeliveriesAction);
const vacancies = vi.mocked(listDashboardVacanciesAction);
const applications = vi.mocked(listDashboardApplicationsAction);
const at = (search: string) => window.history.replaceState(null, "", `/empresa/dashboard/detalle?${search}`);
const search = () => Object.fromEntries(new URLSearchParams(window.location.search));
const summaryText = (text: string) => screen.findByText((_, node) => node?.tagName === "P" && node.textContent === text);

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-08T18:00:00Z"));
  deliveries.mockResolvedValue({ ok: true, data: { kind: "deliveries", page: dashboardDeliveries() } });
  candidates.mockResolvedValue({ ok: true, data: { kind: "candidates", page: dashboardCandidates() } });
  vacancies.mockResolvedValue({ ok: true, data: { kind: "vacancies", page: dashboardVacancies() } });
  applications.mockResolvedValue({ ok: true, data: { kind: "applications", page: dashboardApplications() } });
  at("kind=deliveries&window=90&state=overdue");
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("dashboard detail page (artboard 08 anatomy)", () => {
  it("names the figure, goes back to the dashboard with the same window and reads the list with that window", async () => {
    render(<DashboardDetailPage />);
    expect(await screen.findByRole("heading", { level: 2, name: "Entregas vencidas" })).toBeInTheDocument();
    const crumb = screen.getByRole("navigation", { name: "Ruta" });
    expect(within(crumb).getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/empresa/dashboard?window=90");
    expect(within(crumb).getByText("Entregas vencidas")).toHaveAttribute("aria-current", "page");
    expect(deliveries).toHaveBeenLastCalledWith({ window: 90, query: { state: "overdue" } });
    expect(screen.getByText(/Definiciones d2/)).toHaveTextContent(/Foto de hoy/);
    expect(await summaryText("2 entregas vencidas hoy.")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map(header => header.textContent)).toEqual(["Vacante", "Cliente o área", "Responsable", "Fecha meta", "Días de retraso", "Candidatos entregados"]);
    expect(screen.getByRole("columnheader", { name: /Fecha meta/ })).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByRole("link", { name: "Coordinador de logística" })).toHaveAttribute("href", `/empresa/vacantes/${draftId}/pipeline`);
  });

  it("switches the state from the facet and keeps the window in the URL", async () => {
    render(<DashboardDetailPage />);
    const group = await screen.findByRole("group", { name: "Estado de la entrega" });
    expect(within(group).getByRole("button", { name: "Vencidas 2" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(group).getByRole("button", { name: "Vencen esta semana 3" }));
    expect(search()).toEqual({ kind: "deliveries", window: "90", state: "due_this_week" });
    await waitFor(() => expect(deliveries).toHaveBeenLastCalledWith({ window: 90, query: { state: "due_this_week" } }));
    await userEvent.click(within(group).getByRole("button", { name: "Todas 5" }));
    expect(search()).toEqual({ kind: "deliveries", window: "90" });
  });

  it("lists candidates in process as plain text, with the vacancy chip, the stage switch and «Solo detenidos»", async () => {
    at(`kind=candidates&window=30&in_process=true&vacancy_id=${draftId}`);
    candidates.mockResolvedValue({ ok: true, data: { kind: "candidates", page: dashboardCandidates({ applied_filters: { in_process: true, vacancy: { draft_id: draftId, title: "Analista de crédito Sr." } } }) } });
    render(<DashboardDetailPage />);
    expect(await screen.findByRole("heading", { level: 2, name: "Candidatos en proceso · Analista de crédito Sr." })).toBeInTheDocument();
    expect(await summaryText("2 candidatos en proceso hoy.")).toBeInTheDocument();
    expect(screen.getByText("Lucía Herrera Gómez").closest("a")).toBeNull();
    const chips = screen.getByRole("list", { name: "Filtros activos" });
    expect(within(chips).getByText("Vacante: Analista de crédito Sr.")).toBeInTheDocument();
    await userEvent.click(within(chips).getByRole("button", { name: "Quitar filtro Vacante: Analista de crédito Sr." }));
    expect(search()).toEqual({ kind: "candidates", window: "30", in_process: "true" });
    await userEvent.click(within(screen.getByRole("group", { name: "Etapa" })).getByRole("button", { name: "Screening 2" }));
    expect(search().stage_kind).toBe("screening");
    await userEvent.click(screen.getByRole("button", { name: "Solo detenidos 2" }));
    expect(search().stalled).toBe("true");
  });

  it("lists vacancies with status, in process and open positions, sorted on the server", async () => {
    at("kind=vacancies&window=30&status=published&sort=positions_open");
    render(<DashboardDetailPage />);
    expect(await screen.findByRole("heading", { level: 2, name: "Posiciones por cubrir" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map(header => header.textContent)).toEqual(["Vacante", "Cliente o área", "Estado", "Publicada", "En proceso", "Posiciones por cubrir"]);
    expect(screen.getByRole("columnheader", { name: /Posiciones por cubrir/ })).toHaveAttribute("aria-sort", "descending");
    const row = screen.getAllByRole("row")[1];
    expect(within(row).getAllByRole("cell").map(cell => cell.textContent)).toEqual(["Analista de crédito Sr.", "Grupo Bimbo", "Publicada", "14 sep 2026", "14", "2 de 3"]);
    expect(screen.getByRole("link", { name: "Vacante sin título" })).toHaveAttribute("href", "/empresa/vacantes/30000000-0000-4000-8000-000000000002/pipeline");
    await userEvent.click(screen.getByRole("button", { name: /En proceso/ }));
    expect(search()).toMatchObject({ sort: "in_process", order: "desc" });
    const status = screen.getByRole("group", { name: "Estado de la vacante" });
    expect(within(status).getAllByRole("button").map(button => button.textContent)).toEqual(["Todas 7", "Publicadas 2"]);
  });

  it("lists applications per vacancy for a day of the window", async () => {
    at("kind=applications&window=7&from=2026-11-03&to=2026-11-03&channel=manual");
    render(<DashboardDetailPage />);
    expect(await screen.findByRole("heading", { level: 2, name: "Postulaciones de registro manual · 3 nov 2026" })).toBeInTheDocument();
    expect(applications).toHaveBeenLastCalledWith({ window: 7, query: { from: "2026-11-03", to: "2026-11-03", channel: "manual" } });
    expect(screen.getByText(/Últimos 7 días/)).toBeInTheDocument();
    expect(screen.getByText("Vacantes 1–2")).toBeInTheDocument();
  });

  it("pages with the cursor kept out of the URL", async () => {
    deliveries.mockResolvedValueOnce({ ok: true, data: { kind: "deliveries", page: dashboardDeliveries({ total: 4, next_cursor: "c2" }) } });
    render(<DashboardDetailPage />);
    expect(await screen.findByText("1–2 de 4")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    await waitFor(() => expect(deliveries).toHaveBeenLastCalledWith({ window: 90, query: { state: "overdue" }, cursor: "c2" }));
    expect(window.location.search).not.toContain("c2");
  });

  it("exports the same query and window through the dashboard export route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ code: "metrics_export_too_large", message: "Son más de 50,000 filas: acota los filtros" }, { status: 422 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<DashboardDetailPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Exportar CSV" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Son más de 50,000 filas: acota los filtros");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/company/dashboard/deliveries/export?window=90&state=overdue");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", credentials: "same-origin" });
  });

  it("explains a missing kind, a stakeholder's 403 and a failure with retry", async () => {
    at("window=30");
    render(<DashboardDetailPage />);
    expect(await screen.findByRole("heading", { name: "No encontramos esta lista" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver al dashboard" })).toHaveAttribute("href", "/empresa/dashboard");
    cleanup();
    at("kind=deliveries&window=30");
    deliveries.mockResolvedValue({ ok: false, reason: "forbidden", reference: { status: 403 } });
    render(<DashboardDetailPage />);
    expect(await screen.findByText("No tienes acceso al dashboard")).toBeInTheDocument();
    cleanup();
    deliveries.mockReset().mockResolvedValueOnce({ ok: false, reason: "server_error", reference: {} })
      .mockResolvedValue({ ok: true, data: { kind: "deliveries", page: dashboardDeliveries() } });
    render(<DashboardDetailPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });
});
