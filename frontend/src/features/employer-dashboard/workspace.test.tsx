import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DashboardSkeleton, DashboardWorkspace } from "./workspace";
import type { Dashboard } from "./model";
import { dashboard as data, publishedVacancy, vacancyId } from "./test-fixtures";

const mocks = vi.hoisted(() => ({ load: vi.fn(), drafts: vi.fn(), retry: vi.fn() }));
vi.mock("./actions", () => ({ getDashboardAction: mocks.load }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/features/employer-vacancies/use-portfolio-drafts", () => ({ usePortfolioDrafts: mocks.drafts }));
vi.mock("@/components/company-dashboard/chart-area-interactive", () => ({
  ChartAreaInteractive: ({ data }: { data: Dashboard["origin_by_day"] }) => <div>Orgánicas {data.at(-1)?.organic} Manuales {data.at(-1)?.manual}</div>,
}));
const drafts = { pending: false, items: [publishedVacancy], failure: null, capped: false, retry: mocks.retry };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("innerWidth", 1280);
  mocks.load.mockResolvedValue({ ok: true, data });
  mocks.drafts.mockReturnValue(drafts);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("keeps the restored KPI header/action/footer anatomy while loading", () => {
  render(<DashboardSkeleton />);
  const cards = [...document.querySelectorAll('[data-pf-kpi-cards] [data-slot="card"]')];
  expect(cards).toHaveLength(4);
  for (const card of cards) for (const slot of ["card-description", "card-title", "card-action", "card-footer"]) expect(card.querySelector(`[data-slot='${slot}']`)).not.toBeNull();
});
it("shows loading placeholders before the action resolves", () => {
  mocks.load.mockReturnValue(new Promise(() => {}));
  render(<DashboardWorkspace />);
  expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Cargando dashboard");
  expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(8);
});
it("keeps the complete layout loading until draft-list data is available", async () => {
  mocks.drafts.mockReturnValue({ ...drafts, pending: true });
  render(<DashboardWorkspace />);
  expect(await screen.findByRole("status")).toHaveAttribute("aria-label", "Cargando dashboard");
  expect(screen.queryByText("3/5")).toBeNull();
});
it("renders endpoint values, sources, recent links, absolute Mexico dates and active rows", async () => {
  render(<DashboardWorkspace />);
  expect(await screen.findByText("3/5")).toBeInTheDocument();
  expect(screen.getByText("Orgánicas 4 Manuales 2")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Ana Real" })).toHaveAttribute("href", `/empresa/vacantes/${vacancyId}/pipeline`);
  expect(screen.getAllByText(/23 oct 2026/)).toHaveLength(2);
  expect(screen.getByRole("link", { name: "Ver pipeline de Plataforma real" })).toHaveAttribute("href", `/empresa/vacantes/${vacancyId}/pipeline`);
  expect(screen.getByText("5 candidatos en proceso")).toBeInTheDocument();
  expect(screen.queryByText("Directas")).toBeNull();
});
it("shows honest empty states", async () => {
  mocks.load.mockResolvedValue({ ok: true, data: { ...data, recent: [] } });
  mocks.drafts.mockReturnValue({ ...drafts, items: [] });
  render(<DashboardWorkspace />);
  expect(await screen.findByText("Sin candidatos")).toBeInTheDocument();
  expect(screen.getByText("Todavía no hay vacantes activas")).toBeInTheDocument();
});
it("retries both reads only after an explicit request", async () => {
  mocks.load.mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} });
  render(<DashboardWorkspace />);
  fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
  expect(await screen.findByText("3/5")).toBeInTheDocument();
  expect(mocks.load).toHaveBeenCalledTimes(2);
  expect(mocks.retry).toHaveBeenCalledTimes(1);
});
it.each(["unauthenticated", "forbidden", "not_found"])("renders the %s gate without data", async reason => {
  mocks.load.mockResolvedValue({ ok: false, reason, reference: {} });
  render(<DashboardWorkspace />);
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.queryByText("3/5")).toBeNull();
  if (reason === "unauthenticated") expect(screen.getByRole("link", { name: "Iniciar sesión" })).toHaveAttribute("href", "/empresa/login");
});
it("does not imply a failed vacancy read is an empty company", async () => {
  mocks.drafts.mockReturnValue({ ...drafts, failure: { ok: false, reason: "no_response", reference: {} } });
  render(<DashboardWorkspace />);
  expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo cargar el dashboard");
  expect(screen.queryByText("Todavía no hay vacantes activas")).toBeNull();
});
it("reports the existing list cap rather than implying a complete active panel", async () => {
  mocks.drafts.mockReturnValue({ ...drafts, capped: true });
  render(<DashboardWorkspace />);
  expect(await screen.findByText(/Se muestran las primeras 500 vacantes/)).toHaveAttribute("role", "status");
});
