import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
vi.mock("@/features/candidate-applications/actions", () => ({ loadApplicationsAction: vi.fn() }));
vi.mock("@/features/candidate-cvs/actions", () => ({ loadCvsAction: vi.fn() }));
vi.mock("@/features/candidate/profile-actions", () => ({ loadProfileAction: vi.fn() }));
vi.mock("@/features/psychometrics/workspace/load", () => ({ loadWorkspaceAssessmentsAction: vi.fn() }));
import { loadApplicationsAction } from "@/features/candidate-applications/actions";
import { loadCvsAction } from "@/features/candidate-cvs/actions";
import { loadProfileAction } from "@/features/candidate/profile-actions";
import { loadWorkspaceAssessmentsAction } from "@/features/psychometrics/workspace/load";
import type { ApplicationsPage } from "@/features/candidate-applications/model";
import type { AccountAssessment } from "@/features/psychometrics/model";
import { CandidateDashboardWorkspace } from "@/features/candidate/dashboard/workspace";
const apps: ApplicationsPage = { items: [
  { id: "sent", vacancy: { id: "v1", title: "Puesto enviado", state: "closed" }, company: { id: "c", name: "Empresa real" }, applied_at: "2026-01-03T00:00:00Z", status: "submitted", message: null },
  { id: "process", vacancy: { id: "v2", title: "Puesto en proceso", state: "open" }, company: { id: "c", name: "Empresa real" }, applied_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-05T00:00:00Z", status: "in_process", message: null },
  { id: "closed", vacancy: { id: "v3", title: "Puesto cerrado", state: "closed" }, company: { id: "c", name: "Empresa real" }, applied_at: "2026-01-02T00:00:00Z", updated_at: "2026-01-04T00:00:00Z", status: "closed", message: "Gracias por participar.\nSeguimos en contacto." },
], next_cursor: null };
const assessment: AccountAssessment = { id: "evaluation", application_id: "process", vacancy: apps.items[1].vacancy, company: apps.items[1].company, status: "created", created_at: "2026-01-01T00:00:00Z", expires_at: "2099-01-01T00:00:00Z", finished_at: null, answered_count: 0, total_count: 63, estimated_minutes: 10 };
const metric = (name: string) => within(within(screen.getByRole("region", { name: "Resumen de tu búsqueda" })).getByRole("region", { name }));
beforeEach(() => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: apps });
  vi.mocked(loadCvsAction).mockResolvedValue({ ok: true, data: { items: [{ id: "cv", name: "Mi CV", in_use: true, size: 10, content_type: "application/pdf", uploaded_at: "2026-01-01T00:00:00Z" }], limits: { max_cvs: 7, max_bytes: 100, content_types: ["application/pdf"] } } });
  vi.mocked(loadProfileAction).mockResolvedValue({ ok: true, data: { profile: { user_id: "u", professional_title: "Ingeniería", profile_summary: "Mi experiencia", phone: null, location: null, education: [{ level: "bachelor", status: "completed", institution: null, field: null, start_year: null, end_year: null }], seniority: "junior", years_of_experience: "0", skills: ["Go"], linkedin_url: "https://example.com", portfolio_url: "https://example.com", expected_salary: 0, salary_currency: "MXN", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }, languages: { languages: [{ code: "es", level: "native" }] } } });
  vi.mocked(loadWorkspaceAssessmentsAction).mockResolvedValue({ ok: true, data: { items: [assessment, { ...assessment, id: "expired", expires_at: "2000-01-01T00:00:00Z" }, { ...assessment, id: "done", status: "finished" }] } });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); });
it("shows real counts, profile missing fields, and assessments ONLY as Por atender", async () => {
  render(<CandidateDashboardWorkspace />);
  expect(await screen.findByText("1 de 7")).toBeVisible();
  expect(metric("Postulaciones activas").getByText("2")).toBeVisible();
  expect(metric("Postulaciones activas").getByText("1 enviada · 1 en proceso")).toBeVisible();
  expect(metric("CVs").getByText("1 enviado en postulaciones")).toBeVisible();
  expect(metric("Perfil").getByText("83%")).toBeVisible();
  expect(metric("Perfil").getByText("Te falta: teléfono y ubicación")).toBeVisible();
  expect(metric("Por atender").getByText("1")).toBeVisible();
  expect(screen.queryByText("Nuevo mensaje")).toBeNull();
  expect(screen.getByRole("link", { name: "Completar perfil" })).toHaveAttribute("href", "/candidato/perfil");
  expect(loadApplicationsAction).toHaveBeenCalledWith({ limit: 50 });
});
it("orders by visible update with applied fallback, shows only three statuses, and opens the real closing message", async () => {
  render(<CandidateDashboardWorkspace />);
  const log = await screen.findByRole("list", { name: "Bitácora de postulaciones" });
  const rows = within(log).getAllByRole("listitem");
  expect(rows.map(row => within(row).getByRole("heading").textContent)).toEqual(["Puesto en proceso", "Puesto cerrado", "Puesto enviado"]);
  expect(rows[0]).toHaveTextContent("Actualizada el 5 de enero de 2026");
  expect(rows[2]).toHaveTextContent("Postulaste el 3 de enero de 2026");
  expect(Array.from(log.querySelectorAll('[data-slot="badge"]')).map(el => el.textContent)).toEqual(["En proceso", "Cerrada", "Enviada"]);
  expect(screen.queryByText(/Contratada|Rechazada|Vacante cerrada/)).toBeNull();
  await userEvent.setup().click(within(rows[1]).getByRole("button", { name: "Leer mensaje" }));
  const dialog = await screen.findByRole("dialog");
  for (const line of apps.items[2].message!.split("\n")) expect(within(dialog).getByText(line)).toBeVisible();
  expect(dialog.querySelector("time")).toBeNull();
});
it("renders the first-visit anatomy without pretending a source is already loaded", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { items: [], next_cursor: null } });
  vi.mocked(loadCvsAction).mockResolvedValue({ ok: true, data: { items: [], limits: { max_cvs: 7, max_bytes: 100, content_types: ["application/pdf"] } } });
  vi.mocked(loadProfileAction).mockResolvedValue({ ok: true, data: { profile: null, languages: { languages: [] } } });
  vi.mocked(loadWorkspaceAssessmentsAction).mockResolvedValue({ ok: true, data: { items: [] } });
  render(<CandidateDashboardWorkspace />);
  expect(await screen.findByText("Empieza tu búsqueda: completa tu perfil, sube tu CV y explora vacantes.")).toBeVisible();
  for (const title of ["Todavía no tienes CVs", "Prepara tu perfil", "Aún no tienes postulaciones", "Aquí aparecerán tus pendientes"]) expect(screen.getByRole("heading", { name: title })).toBeVisible();
  expect(screen.getByRole("link", { name: "Subir CV" })).toHaveAttribute("href", "/candidato/cvs");
  expect(metric("Perfil").getByText(/Te falta: título profesional, resumen profesional, teléfono, ubicación/)).toBeVisible();
});
it("shows Al día with applications and company messages but no pending evaluations", async () => {
  vi.mocked(loadWorkspaceAssessmentsAction).mockResolvedValue({ ok: true, data: { items: [] } });
  render(<CandidateDashboardWorkspace />);
  expect(await screen.findByRole("heading", { name: "Todo al día" })).toBeVisible();
  expect(metric("Por atender").getByText("0")).toBeVisible();
  expect(screen.getByText("No tienes evaluaciones pendientes. Puedes seguir buscando a tu ritmo.")).toBeVisible();
  expect(await screen.findByRole("button", { name: "Leer mensaje" })).toBeVisible();
});
it.each(["applications", "cvs", "profile", "assessments"])("isolates %s failure and retries only that source", async source => {
  const actions = { applications: loadApplicationsAction, cvs: loadCvsAction, profile: loadProfileAction, assessments: loadWorkspaceAssessmentsAction };
  vi.mocked(actions[source as keyof typeof actions]).mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} });
  render(<CandidateDashboardWorkspace />);
  const retry = (await screen.findAllByRole("button", { name: "Reintentar" }))[0];
  if (source !== "cvs") expect(await screen.findByText("1 de 7")).toBeVisible();
  if (source !== "profile") expect(await screen.findByText("83%")).toBeVisible();
  if (source !== "applications") expect(await screen.findByRole("heading", { name: "Puesto enviado" })).toBeVisible();
  const before = Object.fromEntries(Object.entries(actions).map(([key, action]) => [key, vi.mocked(action).mock.calls.length]));
  await userEvent.setup().click(retry);
  await waitFor(() => expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull());
  for (const [key, action] of Object.entries(actions)) expect(action).toHaveBeenCalledTimes(before[key] + (key === source ? 1 : 0));
});
it("offers login for expired session and existing RoleBlocked for wrong role", async () => {
  vi.mocked(loadCvsAction).mockResolvedValueOnce({ ok: false, reason: "unauthenticated", reference: {} });
  vi.mocked(loadProfileAction).mockResolvedValueOnce({ ok: false, reason: "forbidden", reference: { code: "wrong_role" } });
  render(<CandidateDashboardWorkspace />);
  expect(await screen.findByRole("link", { name: "Iniciar sesión" })).toHaveAttribute("href", "/candidato/login?next=%2Fcandidato%2Fdashboard");
  expect(await screen.findByText("Esta cuenta es de empresa")).toBeVisible();
  expect(await screen.findByRole("heading", { name: "Puesto enviado" })).toBeVisible();
});
it("loads each section with a skeleton, never zeros or empty states before resolution", () => {
  const never = new Promise<never>(() => {});
  vi.mocked(loadApplicationsAction).mockReturnValue(never); vi.mocked(loadCvsAction).mockReturnValue(never);
  vi.mocked(loadProfileAction).mockReturnValue(never); vi.mocked(loadWorkspaceAssessmentsAction).mockReturnValue(never);
  render(<CandidateDashboardWorkspace />);
  for (const label of ["Cargando postulaciones", "Cargando CVs", "Cargando perfil", "Cargando evaluaciones"]) expect(screen.getAllByLabelText(label).length).toBeGreaterThan(0);
  expect(document.querySelector('[data-slot="skeleton"]')).toBeInTheDocument();
  expect(screen.queryByText("Todo al día")).toBeNull();
  expect(screen.queryByText("0")).toBeNull();
});
