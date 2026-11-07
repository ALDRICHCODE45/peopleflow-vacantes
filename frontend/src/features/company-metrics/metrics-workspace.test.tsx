import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./actions", () => ({ loadMetricsAccessAction: vi.fn(), loadOverviewAction: vi.fn(), listVacanciesAction: vi.fn(), listReassignmentsAction: vi.fn(), loadAuditedDetailAction: vi.fn() }));
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
import { listReassignmentsAction, listVacanciesAction, loadMetricsAccessAction, loadOverviewAction } from "./actions";
import { CompanyMetricsPage } from "./company-metrics-page";
import type { MetricsFailure } from "./model";
import { carlos, clientId, emptySummary, marianaId, reassignmentPage, recruiterPage, summary, vacancyPage } from "./test-fixtures";

const overview = vi.mocked(loadOverviewAction);
const access = vi.mocked(loadMetricsAccessAction);
const ok = (data = { summary: summary(), recruiters: recruiterPage().items }) => ({ ok: true as const, data });
const failure = (reason: MetricsFailure["reason"], extra: Partial<MetricsFailure> = {}): MetricsFailure => ({ ok: false, reason, reference: {}, ...extra });
const at = (search = "") => window.history.replaceState(null, "", `/empresa/metricas${search}`);
const card$ = (title: string) => screen.getByRole("region", { name: title });
const namesInTable = () => screen.getAllByRole("row").slice(1).map(row => within(row).queryByRole("link", { name: /^(?!Ver ficha)/ })?.textContent).filter(Boolean);
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
  overview.mockResolvedValue(ok());
  vi.mocked(listVacanciesAction).mockResolvedValue({ ok: true, data: vacancyPage() });
  vi.mocked(listReassignmentsAction).mockResolvedValue({ ok: true, data: reassignmentPage() });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("access", () => {
  it("gives a recruiter the restricted card and never reads a metric", async () => {
    access.mockResolvedValue({ kind: "restricted" });
    render(<CompanyMetricsPage />);
    expect(await screen.findByText("Métricas restringidas")).toBeInTheDocument();
    expect(screen.getByText(/Solo el owner y los stakeholders de la empresa pueden consultar las métricas/)).toBeInTheDocument();
    expect(overview).not.toHaveBeenCalled();
  });

  it("asks to retry when the role cannot be verified, and shows the metrics to an owner", async () => {
    access.mockResolvedValueOnce(failure("server_error")).mockResolvedValueOnce({ kind: "allowed", role: "owner" });
    render(<CompanyMetricsPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("heading", { name: "Métricas de la empresa" })).toBeInTheDocument();
  });
});

describe("summary", () => {
  it("shows each rate with its «N de M», counts as counts and missing medians as «Sin datos suficientes»", async () => {
    overview.mockResolvedValue(ok({ summary: summary({ vacancies: { ...summary().vacancies, median_business_days_to_close: null } }), recruiters: recruiterPage().items }));
    render(<CompanyMetricsPage />);
    const delivery = await screen.findByRole("region", { name: "Entregas de candidatos" });
    expect(within(delivery).getByText("67%")).toBeInTheDocument();
    expect(within(delivery).getByText("20 de 30 juzgadas")).toBeInTheDocument();
    expect(within(delivery).getByText("93%")).toBeInTheDocument();
    expect(within(delivery).getByText("39 de 42 vacantes")).toBeInTheDocument();
    expect(within(delivery).getByText("11 días hábiles")).toBeInTheDocument();
    expect(within(delivery).getByText("Además, 3 vacantes sin entrega configurada. Las pendientes aún no se juzgan.")).toBeInTheDocument();
    expect(within(card$("Vacantes")).getByText("Sin datos suficientes")).toBeInTheDocument();
    expect(within(card$("Vacantes")).getByText("23")).toBeInTheDocument();
    expect(within(card$("Placements")).getByText("De ellas, 2 no se sostuvieron")).toBeInTheDocument();
    expect(within(card$("Placements")).getByText("23 de 31 posiciones")).toBeInTheDocument();
    expect(within(card$("Por cliente o área")).getByText("Cliente sin especificar")).toBeInTheDocument();
    expect(within(card$("Por cliente o área")).getByText("Sin solicitante")).toBeInTheDocument();
  });

  it("explains every number in a definition popover", async () => {
    render(<CompanyMetricsPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Ayuda: Entregas a tiempo" }));
    expect(await screen.findByText(/Las pendientes todavía no se juzgan y no cuentan/)).toBeInTheDocument();
  });

  it("separates a quiet period from a filter without results", async () => {
    overview.mockResolvedValue(ok({ summary: emptySummary(), recruiters: [] }));
    const view = render(<CompanyMetricsPage />);
    expect(await screen.findByText("No hubo actividad en este periodo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver últimos 90 días" })).toBeInTheDocument();
    view.unmount();
    at(`?recruiter_id=${marianaId}`);
    render(<CompanyMetricsPage />);
    expect(await screen.findByText("Sin resultados")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    expect(window.location.search).toBe("?from=2026-08-10&to=2026-11-07");
  });
});

describe("recruiter table", () => {
  it("starts alphabetical and sorts by a header, keeping rows without a sample last", async () => {
    render(<CompanyMetricsPage />);
    await screen.findByText("Fichas por reclutador");
    expect(namesInTable()).toEqual(["Andrea Villalobos", "Carlos Mendoza Ruiz", "Fernanda Ortiz", "Mariana Torres"]);
    expect(screen.getByRole("columnheader", { name: "Reclutador" })).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByTestId("sort-label")).toHaveTextContent("Orden: nombre (A–Z)");
    await userEvent.click(screen.getByRole("button", { name: "Conversión" }));
    expect(screen.getByRole("columnheader", { name: "Conversión" })).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByRole("columnheader", { name: "Reclutador" })).not.toHaveAttribute("aria-sort");
    expect(namesInTable()).toEqual(["Carlos Mendoza Ruiz", "Mariana Torres", "Andrea Villalobos", "Fernanda Ortiz"]);
    await userEvent.click(screen.getByRole("button", { name: "Conversión" }));
    expect(screen.getByRole("columnheader", { name: "Conversión" })).toHaveAttribute("aria-sort", "descending");
    expect(namesInTable()).toEqual(["Andrea Villalobos", "Mariana Torres", "Carlos Mendoza Ruiz", "Fernanda Ortiz"]);
  });

  it("shows rates with «N de M», former members, and did_not_hold inside the placement total", async () => {
    render(<CompanyMetricsPage />);
    await screen.findByText("Fichas por reclutador");
    const row = (name: string) => screen.getAllByRole("row").find(item => within(item).queryByText(name))!;
    expect(within(row("Mariana Torres")).getByText("75%")).toBeInTheDocument();
    expect(within(row("Mariana Torres")).getByText("6 de 8")).toBeInTheDocument();
    expect(within(row("Fernanda Ortiz")).getAllByText("Sin datos suficientes")).toHaveLength(2);
    expect(within(row("Fernanda Ortiz")).getByText("0 de 0")).toBeInTheDocument();
    expect(within(row("Carlos Mendoza Ruiz")).getByText("Ex miembro")).toBeInTheDocument();
    expect(within(row("Carlos Mendoza Ruiz")).getByText("3")).toBeInTheDocument();
    expect(within(row("Carlos Mendoza Ruiz")).getByText("2 dir. · 1 part. · de ellos 1 no se sostuvo")).toBeInTheDocument();
    expect(within(row("Mariana Torres")).getByRole("link", { name: "Ver ficha de Mariana Torres" })).toHaveAttribute("href", `/empresa/metricas/reclutadores/${marianaId}?from=2026-08-10&to=2026-11-07`);
    expect(screen.queryByText(/puntaje:|#1/)).not.toBeInTheDocument();
  });

  it("explains every column in «Qué mide cada columna»", async () => {
    render(<CompanyMetricsPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Qué mide cada columna" }));
    const sheet = await screen.findByRole("dialog", { name: "Qué mide cada columna" });
    expect(within(sheet).getByText("Conversión · Conversión a placement")).toBeInTheDocument();
    expect(within(sheet).getAllByRole("term")).toHaveLength(8);
  });
});

describe("filters", () => {
  it("writes each filter to the URL and reads the metrics with it", async () => {
    const user = userEvent.setup();
    render(<CompanyMetricsPage />);
    await screen.findByText("Fichas por reclutador");
    expect(overview).toHaveBeenLastCalledWith({});
    await pick(user, "Reclutador", "Carlos Mendoza Ruiz (Ex miembro)");
    expect(new URLSearchParams(window.location.search).get("recruiter_id")).toBe(carlos().user_id);
    await waitFor(() => expect(overview).toHaveBeenLastCalledWith({ recruiter_id: carlos().user_id }));
    await pick(user, "Cliente o área", "Sin solicitante");
    await waitFor(() => expect(overview).toHaveBeenLastCalledWith({ recruiter_id: carlos().user_id, requester_id: "none" }));
    await pick(user, "Atajo", "Últimos 30 días");
    await waitFor(() => expect(overview).toHaveBeenLastCalledWith({ from: "2026-10-09", to: "2026-11-07", recruiter_id: carlos().user_id, requester_id: "none" }));
    expect(screen.getByText(/^30 días, ambos incluidos/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restablecer" }));
    expect(window.location.search).toBe("");
  });

  it("M5/M6: offers «Cliente sin especificar» from by_requester and sends it as requester_kind with requester_id=none", async () => {
    const user = userEvent.setup();
    render(<CompanyMetricsPage />);
    await screen.findByText("Fichas por reclutador");
    const field = screen.getByRole("combobox", { name: "Cliente o área" }).closest('[data-slot="field"]') as HTMLElement;
    expect(within(field).getAllByRole("option").map(option => option.textContent)).toEqual(
      ["Todos los clientes y áreas", "Todos los clientes", "Grupo Bimbo", "Cliente sin especificar", "Todas las áreas internas", "Sin solicitante"]);
    await pick(user, "Cliente o área", "Cliente sin especificar");
    expect(window.location.search).toBe("?requester_kind=client&requester_id=none");
    await waitFor(() => expect(overview).toHaveBeenLastCalledWith({ requester_kind: "client", requester_id: "none" }));
    await pick(user, "Cliente o área", "Grupo Bimbo");
    await waitFor(() => expect(overview).toHaveBeenLastCalledWith({ requester_kind: "client", requester_id: clientId }));
    await pick(user, "Cliente o área", "Sin solicitante");
    await waitFor(() => expect(overview).toHaveBeenLastCalledWith({ requester_id: "none" }));
  });

  it("keeps an invalid period as a field error while the metrics show the last valid period", async () => {
    at("?from=2025-09-01&to=2026-10-31");
    render(<CompanyMetricsPage />);
    expect(await screen.findByText("El periodo puede abarcar hasta 366 días. Elegiste 426.")).toBeInTheDocument();
    expect(screen.getByText("Las métricas siguen mostrando el último periodo válido hasta que lo corrijas.")).toBeInTheDocument();
    expect(screen.getByLabelText("Hasta")).toHaveAttribute("aria-invalid", "true");
  });

  it("names the rejected filters of a 422 and resets the view", async () => {
    overview.mockResolvedValueOnce(failure("invalid_filter", { fields: [{ field: "to", code: "range" }] }));
    at("?from=2026-08-01&to=2026-10-31");
    render(<CompanyMetricsPage />);
    expect(await screen.findByText("No pudimos aplicar los filtros")).toBeInTheDocument();
    expect(screen.getByText("El periodo puede abarcar hasta 366 días.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Restablecer vista" }));
    expect(window.location.search).toBe("");
  });

  it("offers retry on a server failure without showing stale numbers", async () => {
    overview.mockResolvedValueOnce(failure("server_error"));
    render(<CompanyMetricsPage />);
    expect(await screen.findByText("No pudimos calcular las métricas")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Vacantes" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("region", { name: "Vacantes" })).toBeInTheDocument();
  });
});

