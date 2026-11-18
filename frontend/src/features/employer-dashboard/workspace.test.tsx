import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/components/ui/popover", async () => (await import("./test-utils")).popoverMock());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const actions = vi.hoisted(() => ({
  loadSummaryAction: vi.fn(), loadAttentionAction: vi.fn(), loadPipelineAction: vi.fn(),
  loadVacanciesAction: vi.fn(), loadRecentAction: vi.fn(), loadOriginAction: vi.fn(),
}));
vi.mock("./actions", () => actions);
import { IdentityContext } from "@/features/identity/identity-session";
import { attention, emptyAttention, emptySummary, origin, pipeline, recent, summary, vacancies } from "./test-fixtures";
import { DashboardWorkspace } from "./workspace";

const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });
const identity = { status: "ready" as const, email: "m@x.mx", retry() {}, update() {}, result: { ok: true, data: { role: "recruiter", user: { id: "u", email: "m@x.mx", full_name: "Mariana Torres" } } } } as never;
const show = () => render(<IdentityContext.Provider value={identity}><DashboardWorkspace /></IdentityContext.Provider>);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-08T16:50:00Z"));
  window.history.replaceState(null, "", "/empresa/dashboard");
  actions.loadSummaryAction.mockImplementation((window = 30) => ok(summary(window)));
  actions.loadAttentionAction.mockImplementation(() => ok(attention()));
  actions.loadPipelineAction.mockImplementation(() => ok(pipeline()));
  actions.loadVacanciesAction.mockImplementation(() => ok(vacancies()));
  actions.loadRecentAction.mockImplementation(() => ok(recent()));
  actions.loadOriginAction.mockImplementation((window = 30) => ok(origin(window)));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("greets by Mexico City time with the session's first name, then shows scope, freshness and the sections in artboard order", async () => {
  show();
  expect(screen.getByRole("heading", { level: 2, name: "Buenos días, Mariana" })).toBeInTheDocument();
  expect(await screen.findByText("Toda la empresa")).toBeInTheDocument();
  expect(screen.getByText("Actualizado hoy 10:42 · 10 oct 2026 – 8 nov 2026")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Crear vacante" })).toHaveAttribute("href", "/empresa/vacantes/borradores/nuevo");
  const sections = screen.getAllByRole("region").map(region => region.getAttribute("aria-labelledby") && within(region).getAllByRole("heading", { level: 2 })[0].textContent);
  expect(sections).toEqual(["Resumen", "Seguimiento", "Vacantes y candidatos", "Postulaciones"]);
  await screen.findAllByText("143");
});

it("never calls the old aggregate dashboard: one action per section, the period only on window-bound sections", async () => {
  show();
  await screen.findAllByText("143");
  expect(actions.loadSummaryAction).toHaveBeenCalledWith(30);
  expect(actions.loadAttentionAction).toHaveBeenCalledWith();
  expect(actions.loadPipelineAction).toHaveBeenCalledWith();
});

it("keeps the period in the URL and reloads only window-bound sections", async () => {
  show();
  await screen.findAllByText("143");
  await userEvent.click(screen.getByRole("button", { name: "90 días" }));
  expect(window.location.search).toBe("?window=90");
  expect(screen.getByRole("button", { name: "90 días" })).toHaveAttribute("aria-pressed", "true");
  await waitFor(() => expect(actions.loadSummaryAction).toHaveBeenLastCalledWith(90));
  expect(actions.loadAttentionAction).toHaveBeenCalledTimes(1);
});

it("reads the scope of a recruiter", async () => {
  actions.loadSummaryAction.mockImplementation(() => ok({ ...summary(), scope: "own_vacancies" }));
  show();
  expect(await screen.findByText("Tus vacantes asignadas")).toBeInTheDocument();
});

it.each([
  ["unauthenticated", "Tu sesión expiró", "Iniciar sesión"],
  ["forbidden", "No tienes acceso al dashboard", null],
] as const)("replaces the board with the %s card", async (reason, title, link) => {
  actions.loadAttentionAction.mockImplementation(() => Promise.resolve({ ok: false, reason, reference: {} }));
  show();
  expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Resumen" })).toBeNull();
  if (link) expect(screen.getByRole("link", { name: link })).toHaveAttribute("href", "/empresa/login");
});

it("retries only the failed section", async () => {
  actions.loadPipelineAction.mockImplementationOnce(() => Promise.resolve({ ok: false, reason: "server_error", reference: {} }));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
  await waitFor(() => expect(actions.loadPipelineAction).toHaveBeenCalledTimes(2));
  expect(actions.loadSummaryAction).toHaveBeenCalledTimes(1);
});

it("shows the first-visit empty state for a company without vacancies", async () => {
  actions.loadSummaryAction.mockImplementation(() => ok(emptySummary()));
  actions.loadAttentionAction.mockImplementation(() => ok(emptyAttention()));
  actions.loadPipelineAction.mockImplementation(() => ok(pipeline({ stages: pipeline().stages.map(stage => ({ ...stage, candidates: 0, stalled: 0 })) })));
  show();
  expect(await screen.findByRole("heading", { name: "Todavía no hay vacantes activas" })).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Resumen" })).toBeNull();
  expect(screen.getAllByRole("link", { name: "Crear vacante" }).length).toBeGreaterThan(0);
});
