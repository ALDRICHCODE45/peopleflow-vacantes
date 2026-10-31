import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
vi.mock("@/features/candidate-applications/actions", () => ({ loadApplicationsAction: vi.fn(), markMessageReadAction: vi.fn() }));
vi.mock("@/features/identity/identity-session", () => ({ useIdentity: () => ({ result: { ok: true, data: { user: { full_name: "Flores Vazquez Bryan Aldrich" } } } }) }));
vi.mock("recharts", async importOriginal => {
  const actual = await importOriginal<typeof import("recharts")>();
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactElement }) => <div>{React.cloneElement(children, { width: 320, height: 240 } as object)}</div> };
});
vi.mock("@/features/candidate-cvs/actions", () => ({ loadCvsAction: vi.fn() }));
vi.mock("@/features/candidate/profile-actions", () => ({ loadProfileAction: vi.fn() }));
vi.mock("@/features/psychometrics/workspace/load", () => ({ loadWorkspaceAssessmentsAction: vi.fn() }));
import * as React from "react";
import { readFileSync } from "node:fs";
import { loadApplicationsAction, markMessageReadAction } from "@/features/candidate-applications/actions";
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
  vi.mocked(markMessageReadAction).mockResolvedValue({ ok: true, data: null });
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: apps });
  vi.mocked(loadCvsAction).mockResolvedValue({ ok: true, data: { items: [{ id: "cv", name: "Mi CV", in_use: true, size: 10, content_type: "application/pdf", uploaded_at: "2026-01-01T00:00:00Z" }], limits: { max_cvs: 7, max_bytes: 100, content_types: ["application/pdf"] } } });
  vi.mocked(loadProfileAction).mockResolvedValue({ ok: true, data: { profile: { user_id: "u", professional_title: "Ingeniería", profile_summary: "Mi experiencia", phone: null, location: null, education: [{ level: "bachelor", status: "completed", institution: null, field: null, start_year: null, end_year: null }], seniority: "junior", years_of_experience: "0", skills: ["Go"], linkedin_url: "https://example.com", portfolio_url: "https://example.com", expected_salary: 0, salary_currency: "MXN", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }, languages: { languages: [{ code: "es", level: "native" }] } } });
  vi.mocked(loadWorkspaceAssessmentsAction).mockResolvedValue({ ok: true, data: { items: [assessment, { ...assessment, id: "expired", expires_at: "2000-01-01T00:00:00Z" }, { ...assessment, id: "done", status: "finished" }] } });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); });
it("shows real counts, profile missing fields, and excludes unknown message read state", async () => {
  render(<CandidateDashboardWorkspace />);
  expect(await screen.findByText("de 7")).toBeVisible();
  expect(metric("Postulaciones activas").getByText("2")).toBeVisible();
  expect(metric("Postulaciones activas").getByText("1 enviada · 1 en proceso")).toBeVisible();
  expect(metric("CVs").getByText("1 enviado en postulaciones")).toBeVisible();
  expect(metric("Perfil").getByText("83%")).toBeVisible();
  expect(metric("Perfil").getByText("Te falta: teléfono y ubicación")).toBeVisible();
  expect(metric("Por atender").getByText("1")).toBeVisible();
  expect(screen.queryByText("Nuevo mensaje")).toBeNull();
  expect(screen.getByRole("heading", { name: "Hola, Flores Vazquez Bryan Aldrich" })).toBeVisible();
  expect(markMessageReadAction).not.toHaveBeenCalled();
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
  expect(await screen.findByText("Prepara tu perfil y tu primer CV para empezar tu búsqueda.")).toBeVisible();
  for (const title of ["Aquí empieza tu ritmo", "Cada avance cuenta", "Las respuestas toman tiempo", "Tu primera postulación va aquí", "Aquí aparecerán tus pendientes"]) expect(screen.getByRole("heading", { name: title })).toBeVisible();
  expect(screen.getByRole("link", { name: "Subir CV" })).toHaveAttribute("href", "/candidato/cvs");
  expect(metric("Perfil").getByText(/Te falta: título profesional, resumen profesional, teléfono, ubicación/)).toBeVisible();
});
it("shows Al día with applications and company messages but no pending evaluations", async () => {
  vi.mocked(loadWorkspaceAssessmentsAction).mockResolvedValue({ ok: true, data: { items: [] } });
  render(<CandidateDashboardWorkspace />);
  expect(await screen.findByRole("heading", { name: "Todo al día" })).toBeVisible();
  expect(metric("Por atender").getByText("0")).toBeVisible();
  expect(screen.getByText("No tienes evaluaciones ni mensajes por responder. Tu búsqueda sigue avanzando.")).toBeVisible();
  expect(await screen.findByRole("button", { name: "Leer mensaje" })).toBeVisible();
});
it.each(["applications", "cvs", "profile", "assessments"])("isolates %s failure and retries only that source", async source => {
  const actions = { applications: loadApplicationsAction, cvs: loadCvsAction, profile: loadProfileAction, assessments: loadWorkspaceAssessmentsAction };
  vi.mocked(actions[source as keyof typeof actions]).mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} });
  render(<CandidateDashboardWorkspace />);
  const retry = (await screen.findAllByRole("button", { name: "Reintentar" }))[0];
  if (source !== "cvs") expect(await screen.findByText("de 7")).toBeVisible();
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
it("shows the three real insight headlines, switches periods, and preserves the partial notice", async () => {
  const now = new Date();
  const applied = new Date(now.getFullYear(), now.getMonth(), Math.max(1, now.getDate() - 2), 0).toISOString();
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { items: apps.items.map((item, index) => ({ ...item, applied_at: applied, first_response_at: index === 0 ? applied : null })), next_cursor: "another-page" } });
  render(<CandidateDashboardWorkspace />);
  const rhythm = await screen.findByRole("region", { name: "¿Estoy siendo constante?" });
  await waitFor(() => expect(rhythm).toHaveTextContent("3 postulaciones este mes"));
  expect(within(rhythm).getByText("3 más que el mes anterior")).toBeVisible();
  const results = screen.getByRole("region", { name: "¿Está funcionando?" });
  expect(results).toHaveTextContent("33% avanzó a proceso");
  expect(results).toHaveTextContent("1 de tus 3 postulaciones");
  // Shared status order with counts, never Recharts' alphabetical legend order.
  expect(within(within(results).getByRole("list", { name: "Leyenda de estados" })).getAllByRole("listitem").map(item => item.textContent)).toEqual(["En proceso1", "Enviada1", "Cerrada1"]);
  const response = screen.getByRole("region", { name: "¿Cuánto tardan en responder?" });
  expect(response).toHaveTextContent("0 días en promedio");
  expect(response).toHaveTextContent("1 primera respuesta · 2 aún esperan");
  expect(screen.getByRole("note")).toHaveTextContent("Resumen de las últimas 3 postulaciones");
  const initialWeeks = within(screen.getByRole("table", { name: "Postulaciones por semana" })).getAllByRole("row").length;
  await userEvent.setup().click(within(rhythm).getByRole("button", { name: "Últimos 30 días" }));
  expect(within(screen.getByRole("table", { name: "Postulaciones por semana" })).getAllByRole("row").length).toBeLessThan(initialWeeks);
  expect(within(rhythm).getByRole("button", { name: "Últimos 30 días" })).toHaveAttribute("aria-pressed", "true");
  expect(within(rhythm).getByText("Últimos 30 días · estado actual")).toBeVisible();
  expect(loadApplicationsAction).toHaveBeenCalledTimes(1);
  expect(document.querySelectorAll('[data-slot="chart"]')).toHaveLength(3);
});
it("does not invent response times for an older server", async () => {
  render(<CandidateDashboardWorkspace />);
  expect(await screen.findByRole("heading", { name: "Todavía no hay datos de respuesta" })).toBeVisible();
  expect(screen.queryByText("0 días en promedio")).toBeNull();
});
it.each([null, "2026-01-04T01:00:00Z", undefined])("marks only explicitly unread messages on open (%s)", async message_read_at => {
  const closed = { ...apps.items[2], message_read_at };
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { ...apps, items: [closed] } });
  render(<CandidateDashboardWorkspace />);
  const button = await screen.findByRole("button", { name: "Leer mensaje" });
  await waitFor(() => expect(metric("Por atender").getByText(message_read_at === null ? "2" : "1")).toBeVisible());
  expect(markMessageReadAction).not.toHaveBeenCalled();
  await userEvent.setup().click(button);
  const dialog = await screen.findByRole("dialog");
  if (message_read_at === null) {
    await waitFor(() => expect(markMessageReadAction).toHaveBeenCalledExactlyOnceWith(closed.id, { updated_at: closed.updated_at }));
  } else expect(markMessageReadAction).not.toHaveBeenCalled();
  await userEvent.setup().click(within(dialog).getByRole("button", { name: "Cerrar" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(metric("Por atender").getByText("1")).toBeVisible();
  await userEvent.setup().click(screen.getByRole("button", { name: "Leer mensaje" }));
  expect(markMessageReadAction).toHaveBeenCalledTimes(message_read_at === null ? 1 : 0);
});
it.each(["message_changed", "no_response", "missing_revision"])("handles read acknowledgment %s without retries or false dismissal", async reason => {
  const closed = { ...apps.items[2], message_read_at: null, updated_at: reason === "missing_revision" ? undefined : apps.items[2].updated_at };
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { ...apps, items: [closed] } });
  vi.mocked(markMessageReadAction).mockResolvedValue({ ok: false, reason: reason === "message_changed" ? "message_changed" : "no_response", reference: reason === "message_changed" ? { status: 409, code: "message_changed" } : {} });
  render(<CandidateDashboardWorkspace />);
  await userEvent.setup().click(await screen.findByRole("button", { name: "Leer mensaje" }));
  if (reason !== "message_changed") {
    const dialog = await screen.findByRole("dialog");
    await userEvent.setup().click(within(dialog).getByRole("button", { name: "Cerrar" }));
  }
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(loadApplicationsAction).toHaveBeenCalledTimes(reason === "message_changed" ? 2 : 1));
  expect(markMessageReadAction).toHaveBeenCalledTimes(reason === "missing_revision" ? 0 : 1);
  expect(document.querySelector('[data-pf-application-message]')).toHaveTextContent("Nuevo mensaje");
  expect(metric("Por atender").getByText("2")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();
});
it("keeps a message unread until the server confirms and chooses the soonest pending assessment", async () => {
  let confirm!: (value: { ok: true; data: null }) => void;
  vi.mocked(markMessageReadAction).mockReturnValue(new Promise(resolve => { confirm = resolve; }));
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { ...apps, items: [{ ...apps.items[2], message_read_at: null }] } });
  vi.mocked(loadWorkspaceAssessmentsAction).mockResolvedValue({ ok: true, data: { items: [{ ...assessment, id: "later", expires_at: "2099-02-01T00:00:00Z" }, assessment] } });
  render(<CandidateDashboardWorkspace />);
  expect(await screen.findByRole("link", { name: "Revisar pendiente" })).toHaveAttribute("href", "/candidato/evaluaciones/evaluation");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Leer mensaje" }));
  const dialog = await screen.findByRole("dialog");
  expect(document.querySelector('[data-pf-application-message]')).toHaveTextContent("Nuevo mensaje");
  expect(markMessageReadAction).toHaveBeenCalledTimes(1);
  confirm({ ok: true, data: null });
  await waitFor(() => expect(document.querySelector('[data-pf-application-message]')).not.toHaveTextContent("Nuevo mensaje"));
  await user.click(within(dialog).getByRole("button", { name: "Cerrar" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(metric("Por atender").getByText("2")).toBeVisible();
});
it("contains no prototype imports in the real route islands", () => {
  for (const path of ["components/candidate-dashboard/candidate-dashboard-overview.tsx", "features/candidate/dashboard/workspace.tsx", "features/candidate/dashboard/charts.tsx", "features/candidate/dashboard/insights.ts", "features/candidate/dashboard/assessments.tsx", "features/candidate/application-message.tsx"]) expect(readFileSync(`src/${path}`, "utf8")).not.toMatch(/from ["'][^"']*prototype-/);
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
