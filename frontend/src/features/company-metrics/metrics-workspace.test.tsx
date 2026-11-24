import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./actions", () => ({
  loadMetricsAccessAction: vi.fn(), loadSummaryAction: vi.fn(), loadClosuresAction: vi.fn(), loadComplianceAction: vi.fn(), loadDelaysAction: vi.fn(),
  loadPipelineAction: vi.fn(), loadRecruitersAction: vi.fn(), loadOriginAction: vi.fn(), listVacanciesAction: vi.fn(), listReassignmentsAction: vi.fn(), loadAuditedDetailAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
// Same boundary as audit-workspace.test: the real Base UI popover close path refocus-loops under jsdom.
vi.mock("@/components/ui/popover", async () => {
  const Context = React.createContext<{ open: boolean; setOpen: (next: boolean) => void }>({ open: false, setOpen: () => {} });
  return {
    Popover: ({ open, onOpenChange, children }: { open?: boolean; onOpenChange?: (next: boolean) => void; children?: React.ReactNode }) =>
      <Context.Provider value={{ open: Boolean(open), setOpen: next => onOpenChange?.(next) }}>{children}</Context.Provider>,
    PopoverTrigger: ({ render, children }: { render: React.ReactElement<{ onClick?: () => void; children?: React.ReactNode }>; children?: React.ReactNode }) => {
      const { open, setOpen } = React.useContext(Context);
      return React.cloneElement(render, { onClick: () => setOpen(!open), ...(children ? { children } : {}) });
    },
    PopoverContent: ({ children }: { children?: React.ReactNode }) => React.useContext(Context).open ? <div role="dialog">{children}</div> : null,
    PopoverTitle: ({ children }: { children?: React.ReactNode }) => <h4>{children}</h4>,
    PopoverDescription: ({ children }: { children?: React.ReactNode }) => <p>{children}</p>,
  };
});
// jsdom has no popup geometry: the select choices render inline, selection behavior stays real.
vi.mock("@/components/ui/select", async importOriginal => {
  const actual = await importOriginal<typeof import("@/components/ui/select")>();
  return { ...actual, SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});
import {
  listReassignmentsAction, listVacanciesAction, loadClosuresAction, loadComplianceAction, loadDelaysAction, loadMetricsAccessAction, loadOriginAction,
  loadPipelineAction, loadRecruitersAction, loadSummaryAction,
} from "./actions";
import { CompanyMetricsPage } from "./company-metrics-page";
import type { MetricsFailure } from "./model";
import { carlos, clientId, closures, compliance, delays, emptySummary, origin, pipeline, reassignmentPage, recruiterPage, replacementKeys, summaryV2, vacancyPage } from "./test-fixtures";

const access = vi.mocked(loadMetricsAccessAction);
const summary = vi.mocked(loadSummaryAction);
const sectionActions = [loadClosuresAction, loadComplianceAction, loadPipelineAction, loadDelaysAction, loadRecruitersAction, loadOriginAction].map(action => vi.mocked(action));
const failure = (reason: MetricsFailure["reason"], extra: Partial<MetricsFailure> = {}): MetricsFailure => ({ ok: false, reason, reference: {}, ...extra });
const at = (search = "") => window.history.replaceState(null, "", `/empresa/metricas${search}`);
const search = () => Object.fromEntries(new URLSearchParams(window.location.search));
const openFilters = async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: /^Filtros/ }));
const pick = async (user: ReturnType<typeof userEvent.setup>, label: string, option: string) => {
  const field = screen.getByRole("combobox", { name: label }).closest('[data-slot="field"]') as HTMLElement;
  await user.click(within(field).getByRole("option", { name: option }));
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-07T18:00:00Z"));
  at();
  access.mockResolvedValue({ kind: "allowed", role: "stakeholder" });
  summary.mockResolvedValue({ ok: true, data: summaryV2() });
  vi.mocked(loadClosuresAction).mockResolvedValue({ ok: true, data: closures() });
  vi.mocked(loadComplianceAction).mockResolvedValue({ ok: true, data: compliance() });
  vi.mocked(loadPipelineAction).mockResolvedValue({ ok: true, data: pipeline() });
  vi.mocked(loadDelaysAction).mockResolvedValue({ ok: true, data: delays() });
  vi.mocked(loadRecruitersAction).mockResolvedValue({ ok: true, data: recruiterPage().items });
  vi.mocked(loadOriginAction).mockResolvedValue({ ok: true, data: origin() });
  vi.mocked(listVacanciesAction).mockResolvedValue({ ok: true, data: vacancyPage() });
  vi.mocked(listReassignmentsAction).mockResolvedValue({ ok: true, data: reassignmentPage() });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("access", () => {
  it("gives a recruiter the restricted card and never reads a metric", async () => {
    access.mockResolvedValue({ kind: "restricted" });
    render(<CompanyMetricsPage />);
    expect(await screen.findByText("Métricas restringidas")).toBeInTheDocument();
    // «Mi historial de vacantes» is only named when the recruiter's navigation has it (prototype flag, off here).
    expect(screen.getByText("Solo el dueño y los stakeholders de la empresa pueden consultar las métricas.")).toBeInTheDocument();
    expect(screen.queryByText(/Mi historial de vacantes/)).not.toBeInTheDocument();
    // Centred in the page like the stakeholder's «Sección no disponible» card.
    expect(screen.getByText("Métricas restringidas").closest(".max-w-xl")?.parentElement).toHaveClass("flex-1", "items-center", "justify-center");
    expect(summary).not.toHaveBeenCalled();
    for (const action of sectionActions) expect(action).not.toHaveBeenCalled();
  });

  it("asks to retry when the role cannot be verified, and shows the board to an owner", async () => {
    access.mockResolvedValueOnce(failure("server_error")).mockResolvedValueOnce({ kind: "allowed", role: "owner" });
    render(<CompanyMetricsPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Métricas" })).toBeInTheDocument();
  });
});

describe("board (artboard 07)", () => {
  it("loads every section on its own with the URL filters, in the order of the artboard", async () => {
    render(<CompanyMetricsPage />);
    await waitFor(() => expect(summary).toHaveBeenCalledWith({}));
    for (const action of sectionActions) await waitFor(() => expect(action).toHaveBeenCalledWith({}));
    expect(screen.getAllByRole("region").slice(0, 7).map(region => within(region).getAllByRole("heading", { level: 2 })[0].textContent))
      .toEqual(["Resumen", "Cierres y entregas", "Cumplimiento de entregas", "Pipeline por etapa", "Retrasos y reasignaciones", "Desempeño por reclutador", "Origen de las postulaciones"]);
  });

  it("states freshness once in the header: as_of, the applied period and the definitions version", async () => {
    render(<CompanyMetricsPage />);
    expect(await screen.findByText(/^Actualizado 8 nov 2026, 01:40 p\.?\s?m\.? · 1 ago 2026 – 31 oct 2026 · Definiciones v2$/)).toBeInTheDocument();
  });

  it("explains a section only on demand, behind «Cómo se calcula»", async () => {
    const user = userEvent.setup();
    render(<CompanyMetricsPage />);
    await screen.findByText(/Actualizado/);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cómo se calcula: Resumen" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("separates a quiet period from a filter without results", async () => {
    summary.mockResolvedValue({ ok: true, data: emptySummary() });
    render(<CompanyMetricsPage />);
    expect(await screen.findByText("No hubo actividad en este periodo")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Resumen" })).not.toBeInTheDocument();
    cleanup();
    at(`?recruiter_id=${carlos().user_id}`);
    render(<CompanyMetricsPage />);
    expect(await screen.findByText("Sin resultados")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Limpiar filtros" }).at(-1)!);
    expect(search().recruiter_id).toBeUndefined();
  });

  it("keeps a failed section to itself and retries only that section", async () => {
    summary.mockResolvedValueOnce(failure("server_error")).mockResolvedValueOnce({ ok: true, data: summaryV2() });
    render(<CompanyMetricsPage />);
    const strip = await screen.findByRole("region", { name: "Resumen" });
    expect(await within(strip).findByRole("alert")).toHaveTextContent("No pudimos cargar resumen");
    expect(screen.getByRole("region", { name: "Cierres y entregas" })).toBeInTheDocument();
    await userEvent.click(within(strip).getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(within(strip).queryByRole("alert")).not.toBeInTheDocument());
    expect(summary).toHaveBeenCalledTimes(2);
  });

  it("names the rejected filters of a 422 and resets the view", async () => {
    summary.mockResolvedValueOnce(failure("invalid_filter", { fields: [{ field: "to", code: "range" }] }));
    at("?from=2026-08-01&to=2026-10-31");
    render(<CompanyMetricsPage />);
    expect(await screen.findByText("No pudimos aplicar los filtros")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Restablecer vista" }));
    expect(window.location.search).toBe("");
  });
});

describe("period and filters (rule 11)", () => {
  it("marks the 90-day default and switches the period from the header", async () => {
    const user = userEvent.setup();
    render(<CompanyMetricsPage />);
    expect(await screen.findByRole("button", { name: "90 días" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "30 días" }));
    expect(search()).toEqual({ from: "2026-10-09", to: "2026-11-07" });
    await waitFor(() => expect(summary).toHaveBeenLastCalledWith({ from: "2026-10-09", to: "2026-11-07" }));
    await user.click(screen.getByRole("button", { name: "12 meses" }));
    expect(search()).toEqual({ from: "2025-12-01", to: "2026-11-07" });
    expect(screen.getByRole("button", { name: "12 meses" })).toHaveAttribute("aria-pressed", "true");
  });

  it("wraps the period control onto a second line on a narrow screen, «Personalizado» whole (rule 14)", async () => {
    render(<CompanyMetricsPage />);
    const group = await screen.findByRole("group", { name: "Periodo" });
    expect(group).toHaveClass("flex-wrap");
    expect(group).not.toHaveClass("overflow-x-auto");
    expect(within(group).getByRole("button", { name: "Personalizado" })).toBeInTheDocument();
  });

  it("paints the selected period with the accent text token, which keeps 4.5:1 on the dark card", async () => {
    render(<CompanyMetricsPage />);
    const selected = await screen.findByRole("button", { name: "90 días" });
    expect(selected).toHaveClass("text-primary-text");
    expect(selected).not.toHaveClass("text-primary");
  });

  it("filters by recruiter from the «Filtros» popover and shows a removable chip", async () => {
    const user = userEvent.setup();
    render(<CompanyMetricsPage />);
    await screen.findByText(/Actualizado/);
    await openFilters(user);
    await pick(user, "Reclutador", "Carlos Mendoza Ruiz (Ex miembro)");
    expect(search().recruiter_id).toBe(carlos().user_id);
    await waitFor(() => expect(summary).toHaveBeenLastCalledWith({ recruiter_id: carlos().user_id }));
    const chips = screen.getByRole("list", { name: "Filtros activos" });
    expect(within(chips).getByText("Reclutador: Carlos Mendoza Ruiz (Ex miembro)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filtros · 1" })).toBeInTheDocument();
    await user.click(within(chips).getByRole("button", { name: "Quitar filtro Reclutador: Carlos Mendoza Ruiz (Ex miembro)" }));
    expect(search().recruiter_id).toBeUndefined();
    expect(screen.queryByRole("list", { name: "Filtros activos" })).not.toBeInTheDocument();
  });

  it("M5/M6: offers «Cliente sin especificar» from by_requester and sends it as requester_kind with requester_id=none", async () => {
    const user = userEvent.setup();
    render(<CompanyMetricsPage />);
    await screen.findByText(/Actualizado/);
    await openFilters(user);
    const field = screen.getByRole("combobox", { name: "Cliente o área" }).closest('[data-slot="field"]') as HTMLElement;
    expect(within(field).getAllByRole("option").map(option => option.textContent)).toEqual(
      ["Todos los clientes y áreas", "Todos los clientes", "Grupo Bimbo", "Cliente sin especificar", "Todas las áreas internas", "Sin solicitante"]);
    await pick(user, "Cliente o área", "Cliente sin especificar");
    expect(window.location.search).toBe("?requester_kind=client&requester_id=none");
    expect(screen.getByText("Cliente: Cliente sin especificar")).toBeInTheDocument();
    await pick(user, "Cliente o área", "Grupo Bimbo");
    await waitFor(() => expect(summary).toHaveBeenLastCalledWith({ requester_kind: "client", requester_id: clientId }));
    await user.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    expect(window.location.search).toBe("");
  });

  it("loads the recruiter names as soon as «Filtros» opens", async () => {
    const user = userEvent.setup();
    render(<CompanyMetricsPage />);
    await screen.findByText(/Actualizado/);
    await openFilters(user);
    await waitFor(() => expect(loadRecruitersAction).toHaveBeenCalled());
  });
});

describe("process filter «Originales / Reemplazos» (S7)", () => {
  const NOTE = "No cambia con el filtro de proceso";
  const allSections = () => [summary, ...sectionActions];

  it("offers Todos, Originales and Reemplazos in «Filtros», keeps the choice in the URL and sends it on every section", async () => {
    const user = userEvent.setup();
    render(<CompanyMetricsPage />);
    await screen.findByText(/Actualizado/);
    await openFilters(user);
    const field = screen.getByRole("combobox", { name: "Proceso" }).closest('[data-slot="field"]') as HTMLElement;
    expect(within(field).getAllByRole("option").map(option => option.textContent)).toEqual(["Todos los procesos", "Originales", "Reemplazos"]);
    await pick(user, "Proceso", "Reemplazos");
    expect(search()).toEqual({ process_kind: "replacement" });
    for (const action of allSections()) await waitFor(() => expect(action).toHaveBeenLastCalledWith({ process_kind: "replacement" }));
    await pick(user, "Proceso", "Originales");
    expect(search()).toEqual({ process_kind: "original" });
    await pick(user, "Proceso", "Todos los procesos");
    expect(search()).toEqual({});
    await waitFor(() => expect(summary).toHaveBeenLastCalledWith({}));
  });

  it("reads it from the URL, shows its chip and counts it in «Filtros», and the chip removes only it", async () => {
    const user = userEvent.setup();
    at(`?from=2026-08-01&to=2026-10-31&process_kind=replacement&recruiter_id=${carlos().user_id}`);
    render(<CompanyMetricsPage />);
    await waitFor(() => expect(summary).toHaveBeenCalledWith({ from: "2026-08-01", to: "2026-10-31", recruiter_id: carlos().user_id, process_kind: "replacement" }));
    const chips = await screen.findByRole("list", { name: "Filtros activos" });
    expect(within(chips).getByText("Proceso: Reemplazos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filtros · 2" })).toBeInTheDocument();
    await user.click(within(chips).getByRole("button", { name: "Quitar filtro Proceso: Reemplazos" }));
    expect(search()).toEqual({ from: "2026-08-01", to: "2026-10-31", recruiter_id: carlos().user_id });
  });

  it("«Limpiar filtros» drops it and keeps the period", async () => {
    at("?from=2026-08-01&to=2026-10-31&process_kind=original");
    render(<CompanyMetricsPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Limpiar filtros" }));
    expect(search()).toEqual({ from: "2026-08-01", to: "2026-10-31" });
  });

  it("ignores a hand-edited value instead of sending a guaranteed 422", async () => {
    at("?process_kind=everything");
    render(<CompanyMetricsPage />);
    await waitFor(() => expect(summary).toHaveBeenCalledWith({}));
    expect(screen.queryByRole("list", { name: "Filtros activos" })).not.toBeInTheDocument();
  });

  it("shows the standard filter error, at its own control, when the API rejects process_kind (old backend)", async () => {
    const user = userEvent.setup();
    summary.mockResolvedValueOnce(failure("invalid_filter", { fields: [{ field: "process_kind", code: "unknown" }] }));
    at("?process_kind=replacement");
    render(<CompanyMetricsPage />);
    expect(await screen.findByText("No pudimos aplicar los filtros")).toBeInTheDocument();
    expect(screen.getByText("Proceso: elige todos los procesos, solo originales o solo reemplazos.")).toBeInTheDocument();
    await openFilters(user);
    expect(screen.getByText("Elige todos los procesos, solo originales o solo reemplazos.", { selector: '[data-slot="field-error"]' })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restablecer vista" }));
    expect(window.location.search).toBe("");
  });

  it("explains, only while the filter is on, which figures do not follow it (vacancy level, per the contract table)", async () => {
    at("?process_kind=replacement");
    render(<CompanyMetricsPage />);
    await screen.findByText(/Actualizado/);
    const article = (name: string) => screen.getByRole("article", { name });
    await waitFor(() => expect(article("Cierres de vacantes")).toBeInTheDocument());
    for (const name of ["Vacantes asignadas", "Mediana para cerrar", "Cierres de vacantes"]) expect(within(article(name)).getByText(NOTE), name).toBeInTheDocument();
    // Process-level figures follow the filter, so they carry no caption.
    for (const name of ["Entregas a tiempo", "Placements", "Reasignaciones", "Estado de entregas"]) expect(within(article(name)).queryByText(NOTE), name).not.toBeInTheDocument();
    const target = (await screen.findByRole("heading", { name: "Meta de cierre" })).closest('[data-slot="card"]') as HTMLElement;
    expect(within(target).getByText(NOTE)).toBeInTheDocument();
    for (const name of ["Entregas vencidas", "Reasignaciones por motivo", "Candidatos por etapa", "Vacantes con más candidatos"]) {
      expect(within((await screen.findByRole("heading", { name })).closest('[data-slot="card"]') as HTMLElement).queryByText(NOTE), name).not.toBeInTheDocument();
    }
    const recruiters = await screen.findByRole("region", { name: "Desempeño por reclutador" });
    expect(within(recruiters).getByText("«Vacantes asignadas» y «Conversión» no cambian con el filtro de proceso.")).toBeInTheDocument();
  });

  it("shows no caption at all in the default «Todos» view", async () => {
    render(<CompanyMetricsPage />);
    await screen.findByText(/Actualizado/);
    await screen.findByRole("heading", { name: "Meta de cierre" });
    await screen.findByRole("region", { name: "Desempeño por reclutador" });
    expect(screen.queryByText(/filtro de proceso/)).not.toBeInTheDocument();
  });

  it("keeps the filter on the way to a recruiter's page, so their figures read the same view", async () => {
    at("?from=2026-08-01&to=2026-10-31&process_kind=replacement");
    render(<CompanyMetricsPage />);
    const recruiters = await screen.findByRole("region", { name: "Desempeño por reclutador" });
    const links = await within(recruiters).findAllByRole("link", { name: /^Ver detalle de / });
    expect(links.length).toBeGreaterThan(0);
    for (const item of links) expect(item.getAttribute("href")).toMatch(/\/reclutadores\/[^?]+\?from=2026-08-01&to=2026-10-31&process_kind=replacement$/);
  });

  it("opens a figure's detail list with the filter in the URL", async () => {
    at("?from=2026-08-01&to=2026-10-31&process_kind=replacement");
    render(<CompanyMetricsPage />);
    const assigned = await screen.findByRole("article", { name: "Placements" });
    const href = within(assigned).getAllByRole("link")[0].getAttribute("href")!;
    const url = new URL(href, "https://app.test");
    expect(url.searchParams.get("process_kind")).toBe("replacement");
    expect(url.searchParams.get("back")).toBe("/empresa/metricas?from=2026-08-01&to=2026-10-31&process_kind=replacement");
  });

  describe("«Reemplazo» badge", () => {
    const rowOf = (title: string) => screen.getByText(title).closest("li") as HTMLElement;
    it("marks a replacement in «Vacantes con más candidatos» and «Entregas vencidas», and only that one", async () => {
      vi.mocked(loadPipelineAction).mockResolvedValue({ ok: true, data: pipeline({ top_vacancies: pipeline().top_vacancies.map((row, index) => index === 0 ? { ...row, vacancy: { ...row.vacancy, ...replacementKeys } } : { ...row, vacancy: { ...row.vacancy, kind: "original" as const, root_draft_id: row.vacancy.draft_id, sequence: null } }) }) });
      vi.mocked(loadDelaysAction).mockResolvedValue({ ok: true, data: delays({ overdue: { total: 3, top: delays().overdue.top.map((row, index) => index === 0 ? { ...row, vacancy: { ...row.vacancy, ...replacementKeys } } : row) } }) });
      render(<CompanyMetricsPage />);
      await screen.findByText("Analista de crédito Sr.");
      expect(within(rowOf("Analista de crédito Sr.")).getByText("Reemplazo")).toBeInTheDocument();
      expect(within(rowOf("Ejecutivo de cuenta")).getByText("Reemplazo")).toBeInTheDocument();
      expect(screen.getAllByText("Reemplazo")).toHaveLength(2);
    });

    it("shows no badge with an old backend's payload (no kind keys)", async () => {
      render(<CompanyMetricsPage />);
      await screen.findByText("Analista de crédito Sr.");
      await screen.findByText("Ejecutivo de cuenta");
      expect(screen.queryByText("Reemplazo")).not.toBeInTheDocument();
    });
  });
});
