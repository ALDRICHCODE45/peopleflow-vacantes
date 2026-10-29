import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AssessmentBlock, PendingAssessments } from "./assessments";
import type { AccountAssessment } from "../model";
export const assessment: AccountAssessment = { id: "10000000-0000-4000-8000-000000000001", application_id: null, vacancy: { id: "10000000-0000-4000-8000-000000000002", title: "Operaciones" }, company: { id: "10000000-0000-4000-8000-000000000003", name: "Empresa real" }, status: "created", created_at: "2026-10-29T12:00:00Z", expires_at: "2099-11-05T18:00:00Z", finished_at: null, answered_count: 0, total_count: 63, estimated_minutes: 10 };
afterEach(cleanup);
it.each(["created", "in_progress"] as const)("renders %s with saved progress, expiry and the account flow link", status => {
  render(<AssessmentBlock item={{ ...assessment, status, answered_count: status === "created" ? 0 : 16 }} />);
  expect(screen.getByText(status === "created" ? "Pendiente" : "En curso")).toHaveAttribute("data-variant", "accent");
  expect(screen.getByText("~10 min · 63 preguntas · Tu avance se guarda")).toBeVisible();
  expect(screen.getByText(/Disponible hasta/)).toBeVisible();
  expect(screen.getByRole("link", { name: status === "created" ? /Responder evaluación/ : /Continuar evaluación/ })).toHaveAttribute("href", `/candidato/evaluaciones/${assessment.id}`);
  expect(screen.queryByText(/score|puntaje|percentil|band.high/i)).toBeNull();
});
it.each(["finished", "expired", "revoked"] as const)("keeps %s read-only without scores or history", status => {
  const { container } = render(<AssessmentBlock item={{ ...assessment, status, finished_at: status === "finished" ? "2026-10-30T12:00:00Z" : null }} />);
  expect(screen.getByText(status === "finished" ? /Terminaste el/ : "Ya no está disponible")).toBeVisible();
  expect(screen.getByText(/Solo lectura/)).toBeVisible();
  expect(screen.queryByRole("link")).toBeNull(); expect(screen.queryByRole("button")).toBeNull();
  expect(container).not.toHaveTextContent(/Evaluaciones anteriores|puntaje|score|percentil/i);
});
it("shows only answerable pending invitations and official card/item slots", () => {
  const { container } = render(<PendingAssessments items={[assessment, { ...assessment, id: assessment.vacancy.id, status: "finished" }]} />);
  expect(screen.getByRole("heading", { name: "Pendientes" })).toBeVisible();
  expect(screen.getByText("1 por responder")).toBeVisible();
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(screen.getByRole("link")).toHaveAttribute("href", `/candidato/evaluaciones/${assessment.id}`);
  expect(container.querySelector('[data-slot="card-header"] > [data-slot="card-action"]')).toHaveTextContent("1 por responder");
  expect(container.querySelector('[data-slot="item"] > [data-slot="item-content"] > [data-slot="item-title"]')).toHaveTextContent("Operaciones");
});
it("omits Pendientes when every invitation is closed or the list is empty", () => {
  const { container, rerender } = render(<PendingAssessments items={[]} />); expect(container).toBeEmptyDOMElement();
  rerender(<PendingAssessments items={[{ ...assessment, status: "expired" }, { ...assessment, status: "revoked" }]} />); expect(container).toBeEmptyDOMElement();
});
vi.mock("@/features/candidate-applications/actions", () => ({ loadApplicationsAction: vi.fn() }));
import { loadApplicationsAction } from "@/features/candidate-applications/actions";
import { ApplicationsWorkspace } from "@/features/candidate/applications-workspace";
import { page } from "@/features/candidate-applications/test-fixtures";
it("joins only the matching real application and keeps manual invitations on their own", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: page });
  render(<ApplicationsWorkspace assessments={{ ok: true, data: { items: [{ ...assessment, application_id: page.items[0].id, vacancy: { ...assessment.vacancy, id: page.items[0].vacancy.id } }, { ...assessment, id: assessment.vacancy.id, vacancy: { ...assessment.vacancy, title: "Ingreso manual" } }] } }} />);
  const card = (await screen.findByRole("link", { name: "Backend Go" })).closest('[data-slot="card"]') as HTMLElement;
  expect(within(card).getByRole("link", { name: /Responder evaluación/ })).toHaveAttribute("href", `/candidato/evaluaciones/${assessment.id}`);
  expect(screen.getByRole("heading", { name: "Ingreso manual" })).toBeVisible();
  expect(screen.getAllByRole("link", { name: /Responder evaluación/ })).toHaveLength(2);
});
