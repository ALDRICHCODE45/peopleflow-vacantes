import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./actions", () => ({
  loadMetricsAccessAction: vi.fn(), loadRecruiterAction: vi.fn(), listVacanciesAction: vi.fn(), listReassignmentsAction: vi.fn(), loadAuditedDetailAction: vi.fn(),
}));
vi.mock("@/components/ui/select", async importOriginal => {
  const actual = await importOriginal<typeof import("@/components/ui/select")>();
  return { ...actual, SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});
import { listVacanciesAction, loadMetricsAccessAction, loadRecruiterAction } from "./actions";
import type { MetricsFailure } from "./model";
import { RecruiterDetailPage } from "./recruiter-detail";
import { carlos, marianaId, recruiterDetail, vacancyPage } from "./test-fixtures";

const recruiter = vi.mocked(loadRecruiterAction);
const at = (search = "") => window.history.replaceState(null, "", `/empresa/metricas/reclutadores/${marianaId}${search}`);
const region = (name: string) => screen.getByRole("region", { name });
const pick = async (user: ReturnType<typeof userEvent.setup>, label: string, option: string) => {
  const field = screen.getByRole("combobox", { name: label }).closest('[data-slot="field"]') as HTMLElement;
  await user.click(within(field).getByRole("option", { name: option }));
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-07T18:00:00Z"));
  at("?from=2026-08-01&to=2026-10-31");
  vi.mocked(loadMetricsAccessAction).mockResolvedValue({ kind: "allowed", role: "owner" });
  recruiter.mockResolvedValue({ ok: true, data: recruiterDetail() });
  vi.mocked(listVacanciesAction).mockResolvedValue({ ok: true, data: vacancyPage() });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("shows the recruiter card in the artboard's order, with the period of the link", async () => {
  render(<RecruiterDetailPage userId={marianaId} />);
  expect(await screen.findByRole("heading", { name: "Mariana Torres" })).toBeInTheDocument();
  expect(recruiter).toHaveBeenCalledWith({ userId: marianaId, filters: { from: "2026-08-01", to: "2026-10-31" } });
  expect(screen.getByText("201 días hábiles en tramos · 11 vacantes · 1 ago 2026 – 31 oct 2026")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Volver a Métricas" })).toHaveAttribute("href", "/empresa/metricas?from=2026-08-01&to=2026-10-31");
  expect(within(region("Volumen")).getByText("Responsable en 8 · colabora en 2 · miembro en 3 · 5 nuevas")).toBeInTheDocument();
  expect(within(region("Volumen")).getByText("61 entregados en su tramo")).toBeInTheDocument();
  expect(within(region("Puntualidad")).getByText("1 tarde · 1 vencida")).toBeInTheDocument();
  expect(within(region("Puntualidad")).getByText("10 días hábiles")).toBeInTheDocument();
  expect(within(region("Conversión a placement")).getByText("75%")).toBeInTheDocument();
  expect(within(region("Conversión a placement")).getByText("6 de 8 cerradas")).toBeInTheDocument();
  expect(within(region("Conversión a placement")).getByText("9 placements: 6 directos, 1 por participación, 2 compartidos · de ellos, 0 no se sostuvieron")).toBeInTheDocument();
  expect(within(region("Reasignaciones")).getByText("1 perdida")).toBeInTheDocument();
});

it("labels a former member and keeps did_not_hold inside the placement total", async () => {
  recruiter.mockResolvedValue({ ok: true, data: recruiterDetail({ ...carlos() }) });
  render(<RecruiterDetailPage userId={marianaId} />);
  await screen.findByRole("heading", { name: "Carlos Mendoza Ruiz" });
  expect(screen.getByText("Ex miembro")).toBeInTheDocument();
  expect(within(region("Conversión a placement")).getByText("3 placements: 2 directos, 1 por participación, 0 compartidos · de ellos, 1 no se sostuvo")).toBeInTheDocument();
});

it("shows a missing median and conversion as «Sin datos suficientes»", async () => {
  const card = recruiterDetail();
  recruiter.mockResolvedValue({ ok: true, data: recruiterDetail({ delivery: { ...card.delivery, median_business_days_to_target: null }, placements: { ...card.placements, conversion: { value: null, numerator: 0, denominator: 0 } } }) });
  render(<RecruiterDetailPage userId={marianaId} />);
  await screen.findByRole("heading", { name: "Mariana Torres" });
  expect(within(region("Puntualidad")).getByText("Sin datos suficientes")).toBeInTheDocument();
  expect(within(region("Conversión a placement")).getByText("Sin datos suficientes")).toBeInTheDocument();
  expect(within(region("Conversión a placement")).getByText("0 de 0 cerradas")).toBeInTheDocument();
});

it("switches the dense monthly series to a table with exact values", async () => {
  render(<RecruiterDetailPage userId={marianaId} />);
  const toggle = await screen.findByRole("button", { name: "Ver como tabla" });
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(toggle);
  expect(screen.getByRole("button", { name: "Ver como gráfica" })).toHaveAttribute("aria-pressed", "true");
  const table = screen.getByRole("table", { name: "Serie mensual de Mariana Torres" });
  const rows = within(table).getAllByRole("row").slice(1).map(row => within(row).getAllByRole("cell").map(cell => cell.textContent));
  expect(rows).toEqual([["Agosto de 2026", "6", "1", "1", "0", "2"], ["Septiembre de 2026", "7", "3", "0", "0", "3"], ["Octubre de 2026", "8", "2", "0", "1", "0"]]);
});

it("lists the recruiter's vacancies for the same period", async () => {
  render(<RecruiterDetailPage userId={marianaId} />);
  expect(await screen.findByText("Supervisor de Producción")).toBeInTheDocument();
  expect(listVacanciesAction).toHaveBeenCalledWith({ filters: { from: "2026-08-01", to: "2026-10-31", recruiter_id: marianaId } });
});

it("changes the period through the URL", async () => {
  const user = userEvent.setup();
  render(<RecruiterDetailPage userId={marianaId} />);
  await screen.findByRole("heading", { name: "Mariana Torres" });
  await pick(user, "Atajo", "Últimos 30 días");
  expect(window.location.search).toBe("?from=2026-10-09&to=2026-11-07");
  await waitFor(() => expect(recruiter).toHaveBeenLastCalledWith({ userId: marianaId, filters: { from: "2026-10-09", to: "2026-11-07" } }));
  expect(screen.queryByRole("combobox", { name: "Reclutador" })).not.toBeInTheDocument();
});

it("explains a person without history and sends a recruiter to the restricted card", async () => {
  recruiter.mockResolvedValue({ ok: false, reason: "not_found", reference: { status: 404 } } satisfies MetricsFailure);
  const view = render(<RecruiterDetailPage userId={marianaId} />);
  expect(await screen.findByText("Esta persona no tiene historial en la empresa")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Volver a Métricas" })).toBeInTheDocument();
  view.unmount();
  vi.mocked(loadMetricsAccessAction).mockResolvedValue({ kind: "restricted" });
  render(<RecruiterDetailPage userId={marianaId} />);
  expect(await screen.findByText("Métricas restringidas")).toBeInTheDocument();
});
