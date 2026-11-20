import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// next/link's `replace` leaves no trace in the DOM; the stand-in shows it so «Métricas» (Back) can be checked.
vi.mock("next/link", async () => {
  const { forwardRef, createElement } = await import("react");
  return { default: forwardRef<HTMLAnchorElement, { href: string; replace?: boolean }>(({ href, replace, ...props }, ref) =>
    createElement("a", { ...props, ref, href, "data-replace": replace ? "true" : undefined })) };
});
vi.mock("./actions", () => ({
  loadMetricsAccessAction: vi.fn(), loadRecruiterAction: vi.fn(), listVacanciesAction: vi.fn(), listReassignmentsAction: vi.fn(), loadAuditedDetailAction: vi.fn(),
}));
// Same boundary as metrics-workspace.test: the real Base UI popover close path refocus-loops under jsdom.
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
    PopoverDescription: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  };
});
vi.mock("./audited-detail-sheet", async importOriginal => {
  const actual = await importOriginal<typeof import("./audited-detail-sheet")>();
  return { ...actual, AuditedDetailSheet: vi.fn(actual.AuditedDetailSheet) };
});
import { listVacanciesAction, loadMetricsAccessAction, loadRecruiterAction } from "./actions";
import { AuditedDetailSheet } from "./audited-detail-sheet";
import type { MetricsFailure, MetricsResult, RecruiterDetail } from "./model";
import { RecruiterDetailPage } from "./recruiter-detail";
import { carlos, draftId, marianaId, recruiterDetail, vacancyPage } from "./test-fixtures";

const recruiter = vi.mocked(loadRecruiterAction);
const U = marianaId;
const WINDOW = { from: "2026-08-01", to: "2026-10-31" };
const BACK = `/empresa/metricas/reclutadores/${U}?from=2026-08-01&to=2026-10-31`;
/** The drill-down URL the page must build: kind, the window, the figure's own query, then `back` to this page. */
const dd = (kind: string, params: Record<string, string>, window: { from: string; to: string } = WINDOW) =>
  `/empresa/metricas/detalle?${new URLSearchParams({ kind, ...window, ...params, back: BACK })}`;
const at = (search = "") => window.history.replaceState(null, "", `/empresa/metricas/reclutadores/${U}${search}`);
const card = (name: string) => screen.getByRole("article", { name });
const section = (name: string) => screen.getByRole("region", { name });
const link = (scope: HTMLElement, name: string) => within(scope).getByRole("link", { name });
/** An element whose whole text is exactly `text` (a figure line, with or without links inside). */
const line = (scope: HTMLElement, tag: string, text: string) =>
  within(scope).getByText((_, element) => element?.tagName === tag.toUpperCase() && element.textContent === text);
const detail = (overrides: Partial<RecruiterDetail> = {}) => recruiterDetail({ definitions_version: "v2", as_of: "2026-11-07T16:42:00Z", ...overrides });
const show = async (data: RecruiterDetail = detail()) => {
  recruiter.mockResolvedValue({ ok: true, data });
  render(<RecruiterDetailPage userId={U} />);
  await screen.findByRole("heading", { name: data.name ?? "Persona sin nombre" });
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-07T18:00:00Z"));
  at("?from=2026-08-01&to=2026-10-31");
  vi.mocked(loadMetricsAccessAction).mockResolvedValue({ kind: "allowed", role: "owner" });
  vi.mocked(listVacanciesAction).mockResolvedValue({ ok: true, data: vacancyPage() });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("recruiter detail (artboard 10)", () => {
  it("reads the period of the link and shows the sections in the artboard's order, with noun titles", async () => {
    await show();
    expect(recruiter).toHaveBeenCalledWith({ userId: U, filters: WINDOW });
    expect(screen.getAllByRole("heading", { level: 2 }).map(heading => heading.textContent))
      .toEqual(["Mariana Torres", "Resumen", "Entregas y placements", "Carga de trabajo", "Evolución mensual", "Vacantes con su participación"]);
    expect(within(section("Resumen")).getAllByRole("heading", { level: 3 }).map(heading => heading.textContent))
      .toEqual(["Vacantes asignadas", "Entregas a tiempo", "Conversión a placement", "Placements"]);
    expect(within(section("Entregas y placements")).getAllByRole("heading", { level: 3 }).map(heading => heading.textContent))
      .toEqual(["Entregas con fecha cumplida", "Placements por crédito"]);
    expect(within(section("Carga de trabajo")).getAllByRole("heading", { level: 3 }).map(heading => heading.textContent))
      .toEqual(["Vacantes por función", "Reasignaciones", "Tiempo en tramos"]);
    expect(within(section("Evolución mensual")).getAllByRole("heading", { level: 3 }).map(heading => heading.textContent)).toEqual(["Actividad por mes"]);
    expect(screen.getByText(/^Actualizado 7 nov 2026, 10:42 a\.?\s?m\.? · 1 ago 2026 – 31 oct 2026 · Definiciones v2$/)).toBeInTheDocument();
  });

  it("keeps Back to Métricas with the window only (replace) and names the person in the breadcrumb", async () => {
    at(`?from=2026-08-01&to=2026-10-31&recruiter_id=${U}`);
    await show();
    const crumb = screen.getByRole("navigation", { name: "Ruta" });
    expect(link(crumb, "Métricas")).toHaveAttribute("href", "/empresa/metricas?from=2026-08-01&to=2026-10-31");
    expect(link(crumb, "Métricas")).toHaveAttribute("data-replace", "true");
    expect(within(crumb).getByText("Mariana Torres")).toHaveAttribute("aria-current", "page");
  });

  it("links every KPI above 0 to its records with the window and «back» to this page", async () => {
    await show();
    const assigned = card("Vacantes asignadas");
    expect(link(assigned, "Ver las 11 vacantes asignadas a Mariana Torres")).toHaveTextContent(/^11$/);
    expect(link(assigned, "Ver las 11 vacantes asignadas a Mariana Torres")).toHaveAttribute("href", dd("vacancies", { scope: "assigned", recruiter_id: U }));
    expect(line(assigned, "p", "5 nuevas en el periodo")).toBeInTheDocument();
    expect(within(assigned).getAllByRole("link")).toHaveLength(1);

    const onTime = card("Entregas a tiempo");
    expect(link(onTime, "75% a tiempo: ver las 6 entregas a tiempo de Mariana Torres")).toHaveTextContent(/^75%$/);
    expect(link(onTime, "75% a tiempo: ver las 6 entregas a tiempo de Mariana Torres")).toHaveAttribute("href", dd("deliveries", { attributed_to: U, result: "on_time" }));
    expect(line(onTime, "p", "6 de 8 entregas con fecha")).toBeInTheDocument();
    expect(link(onTime, "6 de 8: ver las 8 entregas con fecha de Mariana Torres")).toHaveAttribute("href", dd("deliveries", { attributed_to: U, result: "on_time,late,overdue" }));

    const conversion = card("Conversión a placement");
    expect(link(conversion, "75% de conversión: ver las 6 vacantes cerradas con placement de Mariana Torres"))
      .toHaveAttribute("href", dd("vacancies", { scope: "closed_assigned", recruiter_id: U, credited_to: U }));
    expect(line(conversion, "p", "6 de 8 vacantes cerradas")).toBeInTheDocument();
    expect(link(conversion, "6 de 8: ver las 8 vacantes cerradas de Mariana Torres")).toHaveAttribute("href", dd("vacancies", { scope: "closed_assigned", recruiter_id: U }));

    const placements = card("Placements");
    expect(link(placements, "Ver los 9 placements de Mariana Torres")).toHaveTextContent(/^9$/);
    expect(link(placements, "Ver los 9 placements de Mariana Torres")).toHaveAttribute("href", dd("placements", { recipient: U }));
    expect(line(placements, "p", "9 se sostienen · 0 no se sostuvieron")).toBeInTheDocument();
    // On a narrow KPI card the line breaks between its two parts only, never inside «no se sostuvieron».
    expect(line(placements, "span", "9 se sostienen ·")).toHaveClass("whitespace-nowrap");
    expect(line(placements, "span", "0 no se sostuvieron")).toHaveClass("whitespace-nowrap");
    expect(link(placements, "Ver los 9 placements de Mariana Torres que se sostienen")).toHaveAttribute("href", dd("placements", { recipient: U, held: "true" }));
    expect(within(placements).getAllByRole("link")).toHaveLength(2);
  });

  it("opens the delivery split, the credit total and the workload counts, and keeps the figures with no list as plain text", async () => {
    await show();
    const deliveries = card("Entregas con fecha cumplida");
    expect(line(deliveries, "p", "8 entregas en el periodo")).toBeInTheDocument();
    expect(link(deliveries, "Ver la 1 entrega tarde de Mariana Torres")).toHaveAttribute("href", dd("deliveries", { attributed_to: U, result: "late" }));
    expect(link(deliveries, "Ver la 1 entrega vencida de Mariana Torres")).toHaveAttribute("href", dd("deliveries", { attributed_to: U, result: "overdue" }));
    expect(link(deliveries, "Ver las 6 entregas a tiempo de Mariana Torres")).toHaveAttribute("href", dd("deliveries", { attributed_to: U, result: "on_time" }));
    expect(line(deliveries, "li", "Mediana a la meta10 días hábiles")).toBeInTheDocument();
    expect(line(deliveries, "li", "Candidatos entregados en su tramo61")).toBeInTheDocument();
    expect(within(deliveries).queryByRole("link", { name: /mediana|tramo/i })).not.toBeInTheDocument();

    const credit = card("Placements por crédito");
    expect(link(credit, "Ver los 9 placements de Mariana Torres")).toHaveAttribute("href", dd("placements", { recipient: U }));
    expect(["Crédito directo6", "Por participación1", "Compartido2", "No se sostuvieron0"].map(text => line(credit, "li", text).textContent))
      .toEqual(["Crédito directo6", "Por participación1", "Compartido2", "No se sostuvieron0"]);
    expect(within(credit).getAllByRole("link")).toHaveLength(1);

    const roles = card("Vacantes por función");
    expect(line(roles, "p", "De 11 vacantes asignadas")).toBeInTheDocument();
    expect(link(roles, "Ver las 11 vacantes asignadas a Mariana Torres")).toHaveAttribute("href", dd("vacancies", { scope: "assigned", recruiter_id: U }));
    expect(["Responsable8", "Colaborador2", "Miembro3"].map(text => line(roles, "li", text).textContent)).toEqual(["Responsable8", "Colaborador2", "Miembro3"]);
    expect(within(roles).getAllByRole("link")).toHaveLength(1);

    const reassignments = card("Reasignaciones");
    expect(line(reassignments, "p", "2recibidas")).toBeInTheDocument();
    expect(link(reassignments, "Ver las 2 reasignaciones recibidas por Mariana Torres")).toHaveAttribute("href", dd("reassignments", { recruiter_id: U, direction: "received" }));
    expect(link(reassignments, "Ver la 1 reasignación perdida por Mariana Torres")).toHaveAttribute("href", dd("reassignments", { recruiter_id: U, direction: "lost" }));

    const tramos = card("Tiempo en tramos");
    expect(line(tramos, "p", "201días hábiles")).toBeInTheDocument();
    expect(within(tramos).getAllByRole("link")).toHaveLength(1);
  });

  it("keeps every 0 as plain text, never a link", async () => {
    const base = detail();
    await show(detail({
      delivery: { ...base.delivery, late: 0, overdue: 0 },
      placements: { ...base.placements, did_not_hold: 2 },
      reassignments: { received: 0, lost: 0 },
    }));
    const deliveries = card("Entregas con fecha cumplida");
    expect(line(deliveries, "span", "Tarde 0")).toBeInTheDocument();
    expect(line(deliveries, "span", "Vencidas 0")).toBeInTheDocument();
    expect(within(deliveries).queryByRole("link", { name: /tarde|vencida/ })).not.toBeInTheDocument();
    const reassignments = card("Reasignaciones");
    expect(within(reassignments).queryAllByRole("link")).toHaveLength(0);
    expect(line(reassignments, "li", "Perdidas0")).toBeInTheDocument();
    // A did_not_hold above 0 opens its placements; the held count stays a link too.
    const placements = card("Placements");
    expect(line(placements, "p", "7 se sostienen · 2 no se sostuvieron")).toBeInTheDocument();
    expect(link(placements, "Ver los 2 placements de Mariana Torres que no se sostuvieron")).toHaveAttribute("href", dd("placements", { recipient: U, held: "false" }));
  });

  it("shows a missing rate as «Sin datos suficientes» with no link", async () => {
    const base = detail();
    await show(detail({
      delivery: { ...base.delivery, on_time: 0, late: 0, overdue: 0, median_business_days_to_target: null },
      placements: { ...base.placements, conversion: { value: null, numerator: 0, denominator: 0 } },
    }));
    expect(within(card("Entregas a tiempo")).getByText("Sin datos suficientes")).toBeInTheDocument();
    expect(within(card("Entregas a tiempo")).queryAllByRole("link")).toHaveLength(0);
    expect(within(card("Conversión a placement")).getByText("Sin datos suficientes")).toBeInTheDocument();
    expect(line(card("Conversión a placement"), "p", "0 de 0 vacantes cerradas")).toBeInTheDocument();
    expect(line(card("Entregas con fecha cumplida"), "li", "Mediana a la metaSin datos suficientes")).toBeInTheDocument();
  });

  it("labels a former member with the «Ex miembro» badge", async () => {
    await show(detail({ ...carlos() }));
    const badge = screen.getByText("Ex miembro");
    expect(badge).toHaveAttribute("title", "Ya no pertenece a la empresa; su historial se conserva");
    expect(badge.parentElement).toContainElement(screen.getByRole("heading", { level: 2, name: "Carlos Mendoza Ruiz" }));
  });

  it("has no ⓘ and keeps one «Cómo se calcula» per section, with the definitions only in its popover", async () => {
    await show();
    expect(screen.queryAllByRole("button", { name: /^Ayuda|¿Qué es/ })).toHaveLength(0);
    expect(screen.queryByText("ⓘ")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Cómo se calcula/ }).map(button => button.getAttribute("aria-label"))).toEqual([
      "Cómo se calcula: Resumen", "Cómo se calcula: Entregas y placements", "Cómo se calcula: Carga de trabajo", "Cómo se calcula: Evolución mensual", "Cómo se calcula: Vacantes con su participación",
    ]);
    expect(screen.queryByText(/Entregas a tiempo entre las ya juzgadas/)).not.toBeInTheDocument();
    // Artboard 10 order in the vacancies heading: «Cómo se calcula» first, then «Ver en detalle».
    const heading = within(section("Vacantes con su participación")).getByRole("heading", { level: 2 }).parentElement!;
    expect([...heading.querySelectorAll("button, a")].map(item => item.getAttribute("aria-label")))
      .toEqual(["Cómo se calcula: Vacantes con su participación", "Ver las 11 vacantes asignadas a Mariana Torres en el detalle"]);
    await userEvent.click(screen.getByRole("button", { name: "Cómo se calcula: Resumen" }));
    const help = screen.getByRole("dialog");
    expect(within(help).getByText("Cómo se calcula el resumen")).toBeInTheDocument();
    expect(within(help).getByText("Entregas a tiempo entre las ya juzgadas: a tiempo, tarde y vencidas. Las pendientes todavía no cuentan.")).toBeInTheDocument();
    expect(within(help).getByText("Vacantes con al menos un placement acreditado a Mariana entre las que tuvo asignadas y cerraron en el periodo. Si ninguna cerró, no hay porcentaje.")).toBeInTheDocument();
  });

  it("draws the monthly small charts with links per month, and «Ver como tabla» shows the same figures", async () => {
    await show();
    const monthly = card("Actividad por mes");
    expect(line(monthly, "p", "Agosto a octubre de 2026")).toBeInTheDocument();
    expect(link(monthly, "Ver las 6 vacantes asignadas a Mariana Torres en agosto de 2026"))
      .toHaveAttribute("href", dd("vacancies", { scope: "assigned", recruiter_id: U }, { from: "2026-08-01", to: "2026-08-31" }));
    expect(link(monthly, "Ver la 1 entrega vencida de Mariana Torres con compromiso en octubre de 2026"))
      .toHaveAttribute("href", dd("deliveries", { attributed_to: U, result: "overdue", commitment_month: "2026-10" }));
    expect(link(monthly, "Ver los 3 placements de Mariana Torres en septiembre de 2026"))
      .toHaveAttribute("href", dd("placements", { recipient: U }, { from: "2026-09-01", to: "2026-09-30" }));
    expect(within(monthly).queryByRole("link", { name: /placements? de Mariana Torres en octubre/ })).not.toBeInTheDocument();

    await userEvent.click(within(monthly).getByRole("button", { name: "Ver como tabla" }));
    expect(within(monthly).getByRole("button", { name: "Ver como gráfica" })).toHaveAttribute("aria-pressed", "true");
    const table = within(monthly).getByRole("table", { name: "Serie mensual de Mariana Torres" });
    expect(within(table).getAllByRole("columnheader").map(cell => cell.textContent)).toEqual(["Mes", "Vacantes asignadas", "A tiempo", "Tarde", "Vencidas", "Placements"]);
    const rows = within(table).getAllByRole("row").slice(1).map(row => [within(row).getByRole("rowheader").textContent, ...within(row).getAllByRole("cell").map(cell => cell.textContent)]);
    expect(rows).toEqual([["Agosto de 2026", "6", "1", "1", "0", "2"], ["Septiembre de 2026", "7", "3", "0", "0", "3"], ["Octubre de 2026", "8", "2", "0", "1", "0"]]);
    expect(link(table, "Ver las 3 entregas a tiempo de Mariana Torres con compromiso en septiembre de 2026"))
      .toHaveAttribute("href", dd("deliveries", { attributed_to: U, result: "on_time", commitment_month: "2026-09" }));
    const october = within(table).getAllByRole("row")[3];
    expect(within(october).getAllByRole("cell")[4]).toHaveTextContent(/^0$/);
    expect(within(within(october).getAllByRole("cell")[4]).queryByRole("link")).not.toBeInTheDocument();
  });

  it("lists the vacancies in six columns with no «Columnas» or ⋯ menu, and each figure opens its records", async () => {
    await show();
    const vacancies = section("Vacantes con su participación");
    const table = await within(vacancies).findByRole("table", { name: "Vacantes asignadas a Mariana Torres en el periodo" });
    expect(listVacanciesAction).toHaveBeenCalledWith({ filters: { ...WINDOW, recruiter_id: U } });
    expect(within(table).getAllByRole("columnheader").map(cell => cell.textContent)).toEqual(["Vacante", "Responsable actual", "Entrega", "Cierre", "Posiciones", "Reasignaciones"]);
    expect(screen.queryByRole("button", { name: /Columnas/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Acciones de/ })).not.toBeInTheDocument();
    expect(link(vacancies, "Ver las 11 vacantes asignadas a Mariana Torres en el detalle")).toHaveAttribute("href", dd("vacancies", { scope: "assigned", recruiter_id: U }));
    expect(link(table, "Abrir vacante Supervisor de Producción")).toHaveAttribute("href", `/empresa/vacantes/${draftId}/pipeline`);
    // L54: «Posiciones» is the vacancy's current coverage (plain text); the period's placements open from the KPI.
    expect(within(table).queryByRole("link", { name: /posiciones/ })).not.toBeInTheDocument();
    expect(within(within(table).getAllByRole("row")[1]).getAllByRole("cell")[4]).toHaveTextContent(/^2 de 2$/);
    expect(link(table, "Ver la 1 reasignación de Supervisor de Producción")).toHaveAttribute("href", dd("reassignments", { vacancy_id: draftId }));
    expect(within(table).getByText("Tarde · 2 días hábiles")).toBeInTheDocument();
    expect(line(table, "span", "7 de 6 entregados · compromiso 26 ago 2026")).toBeInTheDocument();

    await userEvent.click(within(table).getByRole("button", { name: "Ver los 7 candidatos entregados de Supervisor de Producción" }));
    await waitFor(() => expect(vi.mocked(AuditedDetailSheet).mock.lastCall?.[0].target).toMatchObject({ report: "deliveries", vacancy: { draft_id: draftId } }));
    expect(vi.mocked(AuditedDetailSheet).mock.lastCall?.[0].period).toMatchObject(WINDOW);
  });

  it("changes the period through the board's shortcuts in the URL", async () => {
    const user = userEvent.setup();
    await show();
    const period = screen.getByRole("group", { name: "Periodo" });
    expect(within(period).getAllByRole("button").map(button => button.textContent)).toEqual(["30 días", "90 días", "12 meses", "Personalizado"]);
    expect(within(period).getByRole("button", { name: "Personalizado" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(period).getByRole("button", { name: "30 días" }));
    expect(window.location.search).toBe("?from=2026-10-09&to=2026-11-07");
    await waitFor(() => expect(recruiter).toHaveBeenLastCalledWith({ userId: U, filters: { from: "2026-10-09", to: "2026-11-07" } }));
    expect(within(period).getByRole("button", { name: "30 días" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: /^Filtros/ })).not.toBeInTheDocument();
  });

  it("shows each section's own skeleton while the numbers load", async () => {
    let resolve!: (value: MetricsResult<RecruiterDetail>) => void;
    recruiter.mockReturnValue(new Promise(next => { resolve = next; }));
    render(<RecruiterDetailPage userId={U} />);
    for (const name of ["Cargando resumen", "Cargando entregas y placements", "Cargando carga de trabajo", "Cargando evolución mensual"]) {
      expect(await screen.findByRole("status", { name })).toBeInTheDocument();
    }
    resolve({ ok: true, data: detail() });
    expect(await screen.findByRole("heading", { name: "Mariana Torres" })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Cargando resumen" })).not.toBeInTheDocument();
  });

  it("explains a person without history and sends a recruiter to the restricted card", async () => {
    recruiter.mockResolvedValue({ ok: false, reason: "not_found", reference: { status: 404 } } satisfies MetricsFailure);
    const view = render(<RecruiterDetailPage userId={U} />);
    expect(await screen.findByText("Esta persona no tiene historial en la empresa")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver a Métricas" })).toHaveAttribute("href", "/empresa/metricas?from=2026-08-01&to=2026-10-31");
    view.unmount();
    vi.mocked(loadMetricsAccessAction).mockResolvedValue({ kind: "restricted" });
    render(<RecruiterDetailPage userId={U} />);
    expect(await screen.findByText("Métricas restringidas")).toBeInTheDocument();
  });
});

describe("recruiter detail for a stakeholder", () => {
  it("opens a vacancy inside Métricas instead of its board", async () => {
    vi.mocked(loadMetricsAccessAction).mockResolvedValue({ kind: "allowed", role: "stakeholder" });
    await show();
    const table = await screen.findByRole("table", { name: "Vacantes asignadas a Mariana Torres en el periodo" });
    expect(link(table, "Abrir vacante Supervisor de Producción")).toHaveAttribute("href", dd("deliveries", { vacancy_id: draftId }));
  });
});

describe("recruiter detail with the process filter (S7)", () => {
  const NOTE = "No cambia con el filtro de proceso";
  const KEPT = { ...WINDOW, process_kind: "replacement" };
  const BACK_KEPT = `${BACK}&process_kind=replacement`;
  beforeEach(() => at("?from=2026-08-01&to=2026-10-31&process_kind=replacement"));

  it("reads it from the URL, sends it with the person's request and with their vacancy list, and says so in the header", async () => {
    await show();
    expect(recruiter).toHaveBeenCalledWith({ userId: U, filters: KEPT });
    await waitFor(() => expect(listVacanciesAction).toHaveBeenCalledWith({ filters: { ...KEPT, recruiter_id: U } }));
    expect(screen.getByText(/^Actualizado .* · 1 ago 2026 – 31 oct 2026 · Definiciones v2 · Solo reemplazos$/)).toBeInTheDocument();
  });

  it("keeps it on Back to Métricas, on the period shortcuts and on every figure's «back»", async () => {
    const user = userEvent.setup();
    await show();
    expect(link(screen.getByRole("navigation", { name: "Ruta" }), "Métricas")).toHaveAttribute("href", "/empresa/metricas?from=2026-08-01&to=2026-10-31&process_kind=replacement");
    const href = link(card("Placements"), "Ver los 9 placements de Mariana Torres").getAttribute("href")!;
    const url = new URL(href, "https://app.test");
    expect(url.searchParams.get("process_kind")).toBe("replacement");
    expect(url.searchParams.get("back")).toBe(BACK_KEPT);
    await user.click(within(screen.getByRole("group", { name: "Periodo" })).getByRole("button", { name: "30 días" }));
    expect(window.location.search).toBe("?from=2026-10-09&to=2026-11-07&process_kind=replacement");
    await waitFor(() => expect(recruiter).toHaveBeenLastCalledWith({ userId: U, filters: { from: "2026-10-09", to: "2026-11-07", process_kind: "replacement" } }));
  });

  it("captions only the figures the contract table says ignore the filter (assigned and conversion), while it is on", async () => {
    await show();
    for (const name of ["Vacantes asignadas", "Conversión a placement", "Vacantes por función"]) expect(within(card(name)).getByText(NOTE), name).toBeInTheDocument();
    for (const name of ["Entregas a tiempo", "Placements", "Entregas con fecha cumplida", "Placements por crédito", "Reasignaciones", "Tiempo en tramos"]) {
      expect(within(card(name)).queryByText(NOTE), name).not.toBeInTheDocument();
    }
    expect(within(card("Actividad por mes")).getByText("«Vacantes asignadas» no cambia con el filtro de proceso.")).toBeInTheDocument();
    expect(within(section("Vacantes con su participación")).getByText("Esta lista no cambia con el filtro de proceso: cuenta cada vacante una sola vez.")).toBeInTheDocument();
  });

  it("shows no caption and no filter text in the default view", async () => {
    at("?from=2026-08-01&to=2026-10-31");
    await show();
    expect(screen.queryByText(/filtro de proceso/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Solo reemplazos|Solo originales/)).not.toBeInTheDocument();
    expect(recruiter).toHaveBeenCalledWith({ userId: U, filters: WINDOW });
  });

  it("shows the standard filter error when the API rejects process_kind (old backend)", async () => {
    recruiter.mockResolvedValue({ ok: false, reason: "invalid_filter", reference: { status: 422 }, fields: [{ field: "process_kind", code: "unknown" }] });
    render(<RecruiterDetailPage userId={U} />);
    expect(await screen.findByText("No pudimos aplicar los filtros")).toBeInTheDocument();
    expect(screen.getByText("Proceso: elige todos los procesos, solo originales o solo reemplazos.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Restablecer vista" }));
    expect(window.location.search).toBe("");
  });
});
