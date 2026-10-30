import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { ApplicationsWorkspace } from "./applications-workspace";
import { loadApplicationsAction } from "@/features/candidate-applications/actions";
import { loadWorkspaceAssessmentsAction } from "@/features/psychometrics/workspace/load";
import { page } from "@/features/candidate-applications/test-fixtures";
import type { AccountAssessment } from "@/features/psychometrics/model";
vi.mock("@/features/candidate-applications/actions", () => ({ loadApplicationsAction: vi.fn() }));
vi.mock("@/features/psychometrics/workspace/load", () => ({ loadWorkspaceAssessmentsAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
const applications = [
  page.items[0],
  { ...page.items[0], id: "second", status: "in_process" as const, vacancy: { ...page.items[0].vacancy, title: "Diseñadora UX" } },
  { ...page.items[0], id: "closed", status: "closed" as const, message: "Gracias por participar", vacancy: { ...page.items[0].vacancy, title: "Analista" } },
  { ...page.items[0], id: "expired", vacancy: { ...page.items[0].vacancy, title: "Soporte" } },
];
const assessment: AccountAssessment = { id: "invitation", application_id: page.items[0].id, vacancy: page.items[0].vacancy, company: page.items[0].company, status: "in_progress", created_at: "2026-10-17T12:00:00Z", expires_at: "2099-11-05T18:00:00Z", finished_at: null, answered_count: 10, total_count: 63, estimated_minutes: 10 };
beforeEach(() => {
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { items: applications, next_cursor: null } });
  vi.mocked(loadWorkspaceAssessmentsAction).mockResolvedValue({ ok: true, data: { items: [assessment, { ...assessment, id: "pending", application_id: "second", status: "created", answered_count: 0 }, { ...assessment, id: "old", application_id: "expired", status: "created", expires_at: "2000-01-01T00:00:00Z" }] } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const rows = () => screen.getByRole("list", { name: "Mis postulaciones" });
it("counts and filters real statuses and only unexpired created/in-progress assessments", async () => {
  render(<ApplicationsWorkspace />);
  const user = userEvent.setup();
  expect(await screen.findByRole("button", { name: "Todas 4" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Por atender 2" })).toBeVisible();
  expect(screen.getByRole("button", { name: "En proceso 1" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Cerradas 1" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Por atender 2" }));
  expect(within(rows()).getAllByRole("listitem")).toHaveLength(2);
  expect(within(rows()).queryByText("Soporte")).toBeNull();
  await user.click(screen.getByRole("button", { name: "En proceso 1" }));
  expect(within(rows()).getAllByRole("listitem")).toHaveLength(1);
  expect(within(rows()).getByText("Diseñadora UX")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Cerradas 1" }));
  expect(within(rows()).getAllByRole("listitem")).toHaveLength(1);
  expect(screen.getByText("Gracias por participar")).toBeVisible();
});
it("selects rows and next-step chips without starting an evaluation, with real dated activity", async () => {
  const { container } = render(<ApplicationsWorkspace />);
  const chip = await screen.findByRole("button", { name: "Evaluación · 10 de 63" });
  expect(within(rows()).getAllByRole("button", { name: /Evaluación/ })).toHaveLength(2);
  expect(screen.getByRole("link", { name: /Continuar evaluación/ })).toHaveAttribute("href", "/candidato/evaluaciones/invitation");
  expect(screen.getByRole("heading", { name: "Actividad del proceso" })).toBeVisible();
  expect(screen.getByText("Postulaste").parentElement?.querySelector("time")).toHaveAttribute("datetime", applications[0].applied_at);
  expect(screen.getByText("Recibiste una evaluación").parentElement?.querySelector("time")).toHaveAttribute("datetime", assessment.created_at);
  expect(container).not.toHaveTextContent(/Avanzaste de etapa|Comenzaste la evaluación|Actualizada hace|puntaje|percentil|resultados/i);
  await userEvent.setup().click(within(rows()).getByText("Diseñadora UX"));
  expect(screen.getByRole("link", { name: /Responder evaluación/ })).toHaveAttribute("href", "/candidato/evaluaciones/pending");
  expect(within(rows()).getByText("Diseñadora UX").closest("[data-pf-application-row]")).toHaveAttribute("data-selected", "true");
  await userEvent.setup().click(chip);
  expect(screen.getByRole("link", { name: /Continuar evaluación/ })).toBeVisible();
});
it("combines accent-insensitive search with filters without changing loaded counts", async () => {
  render(<ApplicationsWorkspace />);
  const search = await screen.findByRole("searchbox", { name: "Buscar por puesto o empresa" });
  fireEvent.change(search, { target: { value: "DISENADORA" } });
  expect(within(rows()).getAllByRole("listitem")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Todas 4" })).toBeVisible();
  fireEvent.change(search, { target: { value: "acme" } });
  expect(within(rows()).getAllByRole("listitem")).toHaveLength(4);
});
it("opens mobile detail, closes with back and restores row focus", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  render(<ApplicationsWorkspace />);
  const row = await screen.findByRole("link", { name: "Backend Go" });
  await userEvent.setup().click(row);
  const detail = await screen.findByRole("dialog");
  expect(within(detail).getByRole("link", { name: /Continuar evaluación/ })).toHaveAttribute("href", "/candidato/evaluaciones/invitation");
  await userEvent.setup().click(within(detail).getByRole("button", { name: "Volver a mis postulaciones" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(row).toHaveFocus();
});
it("keeps standalone manual-intake assessments visible, outside application counts", async () => {
  vi.mocked(loadWorkspaceAssessmentsAction).mockResolvedValue({ ok: true, data: { items: [{ ...assessment, application_id: null, vacancy: { ...assessment.vacancy, title: "Ingreso manual" } }] } });
  render(<ApplicationsWorkspace />);
  expect(await screen.findByRole("heading", { name: "Ingreso manual" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Todas 4" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Por atender 0" })).toBeVisible();
  expect(screen.getByRole("link", { name: /Continuar evaluación/ })).toHaveAttribute("href", "/candidato/evaluaciones/invitation");
});
it("keeps finished assessments read-only with their actual completion date and no next-step chip", async () => {
  vi.mocked(loadWorkspaceAssessmentsAction).mockResolvedValue({ ok: true, data: { items: [{ ...assessment, status: "finished", finished_at: "2026-10-18T12:00:00Z" }] } });
  render(<ApplicationsWorkspace />);
  expect(await screen.findByText(/Terminaste el/)).toBeVisible();
  expect(within(rows()).queryByRole("button", { name: /Evaluación/ })).toBeNull();
  expect(screen.queryByRole("link", { name: /Continuar evaluación/ })).toBeNull();
  expect(screen.getByText("Terminaste la evaluación").parentElement?.querySelector("time")).toHaveAttribute("datetime", "2026-10-18T12:00:00Z");
});
