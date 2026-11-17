import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../actions", () => ({
  listDashboardCandidatesAction: vi.fn(), listDashboardDeliveriesAction: vi.fn(), listDashboardVacanciesAction: vi.fn(), listDashboardApplicationsAction: vi.fn(),
}));
// next/link's `replace` leaves no trace in the DOM; the stand-in shows it so «Volver» can be checked.
vi.mock("next/link", async () => {
  const { forwardRef, createElement } = await import("react");
  return { default: forwardRef<HTMLAnchorElement, { href: string; replace?: boolean }>(({ href, replace, ...props }, ref) =>
    createElement("a", { ...props, ref, href, "data-replace": replace ? "true" : undefined })) };
});
vi.mock("@/features/audit-log/download", () => ({ saveBlob: vi.fn() }));
import { saveBlob } from "@/features/audit-log/download";
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
    // Back replaces the detail entry, so the browser's Back does not reopen the list.
    expect(within(crumb).getByRole("link", { name: "Dashboard" })).toHaveAttribute("data-replace", "true");
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
    expect(await screen.findByRole("heading", { level: 2, name: "Posiciones de las vacantes publicadas" })).toBeInTheDocument();
    expect(await summaryText("3 de 5 posiciones cubiertas en 2 vacantes publicadas; 2 por cubrir.")).toBeInTheDocument();
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

  it("states the positions the board's «Posiciones» figures count: covered, required and open, over every filtered row", async () => {
    at("kind=vacancies&window=30&status=published&sort=positions_open");
    vacancies.mockResolvedValue({ ok: true, data: { kind: "vacancies", page: dashboardVacancies({ total: 8, positions: { covered: 2, required: 14 } }) } });
    render(<DashboardDetailPage />);
    expect(await summaryText("2 de 14 posiciones cubiertas en 8 vacantes publicadas; 12 por cubrir.")).toBeInTheDocument();
    cleanup();
    vacancies.mockResolvedValue({ ok: true, data: { kind: "vacancies", page: dashboardVacancies({ total: 1, positions: { covered: 1, required: 1 } }) } });
    render(<DashboardDetailPage />);
    expect(await summaryText("1 de 1 posición cubierta en 1 vacante publicada; 0 por cubrir.")).toBeInTheDocument();
    cleanup();
    vacancies.mockResolvedValue({ ok: true, data: { kind: "vacancies", page: dashboardVacancies({ total: 3, positions: { covered: 0, required: 0 } }) } });
    render(<DashboardDetailPage />);
    expect(await summaryText("3 vacantes publicadas sin posiciones definidas.")).toBeInTheDocument();
  });

  it("lists applications per vacancy for a day of the window", async () => {
    at("kind=applications&window=7&from=2026-11-03&to=2026-11-03&channel=manual");
    render(<DashboardDetailPage />);
    expect(await screen.findByRole("heading", { level: 2, name: "Postulaciones de registro manual · 3 nov 2026" })).toBeInTheDocument();
    expect(applications).toHaveBeenLastCalledWith({ window: 7, query: { from: "2026-11-03", to: "2026-11-03", channel: "manual" } });
    expect(screen.getByText(/Últimos 7 días/)).toBeInTheDocument();
    expect(screen.getByText("Vacantes 1–2")).toBeInTheDocument();
  });

  it("shows only the channels the filter chose, so each row adds up to its total, and selects «Orgánicas» in the channel switch", async () => {
    at("kind=applications&window=30&channel=portal,careers_site,unknown");
    const page = dashboardApplications();
    applications.mockResolvedValue({ ok: true, data: { kind: "applications", page: { ...page, items: page.items.map(row => ({ ...row, total: row.portal + row.careers_site + row.unknown })) } } });
    render(<DashboardDetailPage />);
    expect(await screen.findByRole("heading", { level: 2, name: "Postulaciones orgánicas" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map(header => header.textContent)).toEqual(["Vacante", "Portal", "Sitio de carreras", "Sin distinguir", "Total"]);
    expect(within(screen.getAllByRole("row")[2]).getAllByRole("cell").map(cell => cell.textContent)).toEqual(["Supervisor de turno", "20", "4", "9", "33"]);
    const channel = screen.getByRole("group", { name: "Canal" });
    expect(within(channel).getByRole("button", { name: "Orgánicas 454" })).toHaveAttribute("aria-pressed", "true");
    expect(within(channel).getByRole("button", { name: "Todos 515" })).toHaveAttribute("aria-pressed", "false");
    cleanup();
    at("kind=applications&window=30&channel=manual");
    render(<DashboardDetailPage />);
    expect(await screen.findByRole("heading", { level: 2, name: "Postulaciones de registro manual" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map(header => header.textContent)).toEqual(["Vacante", "Manual", "Total"]);
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

  it("names a chart point's CSV after the point's own dates, not the window", async () => {
    const csv = (name: string) => vi.fn().mockImplementation(async () => new Response("a,b\n", { status: 200, headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"` } }));
    at("kind=applications&window=30&from=2026-11-01&to=2026-11-07");
    vi.stubGlobal("fetch", csv("dashboard-applications-2026-10-10-2026-11-08.csv"));
    render(<DashboardDetailPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Exportar CSV" }));
    await waitFor(() => expect(saveBlob).toHaveBeenLastCalledWith(expect.anything(), "dashboard-applications-2026-11-01-2026-11-07.csv"));
    cleanup();
    at("kind=candidates&window=7&in_process=true&on=2026-11-03");
    render(<DashboardDetailPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Exportar CSV" }));
    await waitFor(() => expect(saveBlob).toHaveBeenLastCalledWith(expect.anything(), "dashboard-candidates-2026-11-03.csv"));
    cleanup();
    // A list of the whole window keeps the backend's name.
    at("kind=deliveries&window=30&state=overdue");
    render(<DashboardDetailPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Exportar CSV" }));
    await waitFor(() => expect(saveBlob).toHaveBeenLastCalledWith(expect.anything(), "dashboard-applications-2026-10-10-2026-11-08.csv"));
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
