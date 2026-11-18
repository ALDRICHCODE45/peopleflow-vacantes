import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
vi.mock("@/features/candidate-applications/actions", () => ({ loadApplicationsAction: vi.fn(), markMessageReadAction: vi.fn() }));
vi.mock("@/features/identity/identity-session", () => ({ useIdentity: () => ({ result: { ok: true, data: { user: { full_name: "Valeria Mendoza" } } } }) }));
vi.mock("@/features/candidate-cvs/actions", () => ({ loadCvsAction: vi.fn() }));
vi.mock("@/features/candidate/profile-actions", () => ({ loadProfileAction: vi.fn() }));
vi.mock("@/features/psychometrics/workspace/load", () => ({ loadWorkspaceAssessmentsAction: vi.fn() }));
vi.mock("@/features/saved-vacancies/actions", () => ({ loadSavedJobsAction: vi.fn() }));
// The anchored Base UI positioner loops in jsdom (same note as psychometrics/profile/help.test.tsx), so only the
// popup shell of «+N más» is replaced; the real Root, Trigger, Title and open state stay.
vi.mock("@/components/ui/popover", async importOriginal => ({
  ...await importOriginal<typeof import("@/components/ui/popover")>(),
  PopoverContent: ({ children }: { children?: ReactNode }) => <div role="dialog" aria-label="También por hacer">{children}</div>,
}));
import { Profiler, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import { loadApplicationsAction, markMessageReadAction } from "@/features/candidate-applications/actions";
import { loadCvsAction } from "@/features/candidate-cvs/actions";
import { loadProfileAction } from "@/features/candidate/profile-actions";
import { loadWorkspaceAssessmentsAction } from "@/features/psychometrics/workspace/load";
import { loadSavedJobsAction } from "@/features/saved-vacancies/actions";
import type { ApplicationsPage } from "@/features/candidate-applications/model";
import type { AccountAssessment } from "@/features/psychometrics/model";
import type { SavedJobs } from "@/features/saved-vacancies/model";
import { CandidateDashboardWorkspace } from "@/features/candidate/dashboard/workspace";
import motion from "@/features/candidate/dashboard/dashboard.module.css";

type Item = ApplicationsPage["items"][number];
// «Hoy» is Wednesday 18 Nov 2026, local time, like Valeria's demo account (L2).
const NOW = new Date(2026, 10, 18, 13, 0);
const at = (month: number, day: number, hour = 10, minute = 0) => new Date(2026, month - 1, day, hour, minute).toISOString();
const company = { id: "c", name: "Grupo Altavista" };
const application = (id: string, title: string, extra: Partial<Item>): Item => ({ id, vacancy: { id: `v-${id}`, title, state: "open" }, company, applied_at: at(11, 18, 9), status: "submitted", message: null, ...extra });
const MESSAGE = "Hola, Valeria. Gracias por tu interés.\nMucho éxito en tu búsqueda.";
const apps: Item[] = [
  application("a1", "Residente de Obra Civil", { applied_at: at(11, 18, 9, 5), first_response_at: null }),
  application("a2", "Químico(a) Farmacéutico(a) Responsable Sanitario", { applied_at: at(11, 18, 9, 20), updated_at: at(11, 18, 11, 2), first_response_at: at(11, 18, 11, 2), status: "in_process" }),
  application("a3", "Ejecutivo(a) de Ventas Institucionales", { applied_at: at(11, 18, 9, 31), updated_at: at(11, 18, 10, 15), first_response_at: at(11, 18, 10, 15), status: "in_process" }),
  application("a4", "Desarrollador(a) Backend Go", { applied_at: at(11, 18, 9, 48), updated_at: at(11, 18, 12, 30), first_response_at: at(11, 18, 12, 30), status: "closed", message: MESSAGE, message_read_at: null }),
];
const assessment: AccountAssessment = { id: "evaluation", application_id: "a2", vacancy: { id: "v-a2", title: apps[1].vacancy.title }, company, status: "in_progress", created_at: at(11, 18, 11), expires_at: at(11, 20, 23, 59), finished_at: null, answered_count: 23, total_count: 63, estimated_minutes: 10 };
const later: AccountAssessment = { ...assessment, id: "later", status: "created", answered_count: 0, expires_at: at(11, 28) };
const profile = (phone: string | null) => ({ ok: true as const, data: { profile: { user_id: "u", professional_title: "Ingeniería", profile_summary: "Mi experiencia", phone, location: phone ? { country: "MX", state: "Jalisco", city: "Guadalajara" } : null, education: [{ level: "bachelor", status: "completed", institution: null, field: null, start_year: null, end_year: null }], seniority: "junior", years_of_experience: "0", skills: ["Go"], linkedin_url: "https://example.com", portfolio_url: "https://example.com", expected_salary: 0, salary_currency: "MXN", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }, languages: { languages: [{ code: "es", level: "native" }] } } }) as never;
const savedRow = (id: string, applied: boolean, availability: "open" | "closed" = "open") => ({ job_id: id, saved_at: at(11, 10), availability, closed_at: null, application: applied ? { id, applied_at: at(11, 12) } : null, job: {} });
const saved = (rows: ReturnType<typeof savedRow>[]) => ({ ok: true as const, data: { items: rows, total: rows.length, limit: 200 } as unknown as SavedJobs });
const cvs = (count: number) => ({ ok: true as const, data: { items: Array.from({ length: count }, (_, index) => ({ id: `cv${index}`, name: "Mi CV", in_use: true, size: 10, content_type: "application/pdf" as const, uploaded_at: "2026-01-01T00:00:00Z" })), limits: { max_cvs: 7, max_bytes: 100, content_types: ["application/pdf" as const] } } });
const region = (name: string) => screen.getByRole("region", { name });
const tile = (name: string) => screen.getByRole("article", { name });
// Exact text of one element whose copy spans inline children (<em>, <small>), never one of its ancestors.
const exact = (text: string) => (_: string, element: Element | null) => element?.textContent === text && Array.from(element.children).every(child => child.textContent !== text);

beforeEach(() => {
  // Only the calendar is pinned; it keeps ticking so overlay timing that reads Date never stalls.
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, media: "", addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.mocked(markMessageReadAction).mockResolvedValue({ ok: true, data: null });
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { items: apps, next_cursor: null } });
  vi.mocked(loadCvsAction).mockResolvedValue(cvs(1));
  vi.mocked(loadProfileAction).mockResolvedValue(profile(null));
  vi.mocked(loadSavedJobsAction).mockResolvedValue(saved([savedRow("s1", false), savedRow("s2", false), savedRow("s3", true)]));
  vi.mocked(loadWorkspaceAssessmentsAction).mockResolvedValue({ ok: true, data: { items: [assessment, { ...assessment, id: "expired", expires_at: at(11, 1) }, { ...assessment, id: "done", status: "finished" }] } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

it("greets the candidate by the first given name with today's date", async () => {
  render(<CandidateDashboardWorkspace />);
  expect(screen.getByRole("heading", { level: 2, name: "Hola, Valeria" })).toBeVisible();
  expect(screen.getByText("Miércoles 18 de noviembre")).toBeVisible();
  await screen.findByRole("region", { name: "Este mes" });
});

it("shows one next step, the assessment that expires first, and the rest in «+N más»", async () => {
  render(<CandidateDashboardWorkspace />);
  const card = await screen.findByRole("region", { name: "Siguiente paso" });
  expect(within(card).getByRole("heading", { name: "Termina tu evaluación de Grupo Altavista" })).toBeVisible();
  expect(within(card).getByText("Químico(a) Farmacéutico(a) Responsable Sanitario · 23 de 63 · vence el vie 20 nov")).toBeVisible();
  expect(within(card).getByRole("img", { name: "Evaluación: 23 de 63 preguntas respondidas" })).toBeVisible();
  expect(within(card).getByRole("link", { name: "Continuar evaluación" })).toHaveAttribute("href", "/candidato/evaluaciones/evaluation");
  expect(within(card).getByRole("link", { name: "Ver postulación" })).toHaveAttribute("href", "/candidato/postulaciones");
  const trigger = within(card).getByRole("button", { name: "2 pendientes más" });
  expect(trigger).toHaveTextContent("+2 más");
  await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  const more = screen.getByRole("dialog", { name: "También por hacer" });
  expect(within(more).getByText("También por hacer")).toBeVisible();
  expect(within(more).getAllByRole("listitem").map(item => item.textContent)).toEqual(["Leer el mensaje de Grupo Altavista", "Completar tu perfil · falta teléfono y ubicación"]);
  expect(within(more).getByRole("link", { name: "Completar tu perfil · falta teléfono y ubicación" })).toHaveAttribute("href", "/candidato/perfil");
});

it("orders a second assessment after the soonest one and starts an untouched one", async () => {
  vi.mocked(loadWorkspaceAssessmentsAction).mockResolvedValue({ ok: true, data: { items: [later] } });
  render(<CandidateDashboardWorkspace />);
  const card = await screen.findByRole("region", { name: "Siguiente paso" });
  expect(within(card).getByRole("heading", { name: "Responde tu evaluación de Grupo Altavista" })).toBeVisible();
  expect(within(card).getByRole("link", { name: "Empezar evaluación" })).toHaveAttribute("href", "/candidato/evaluaciones/later");
  expect(within(card).getByText("+2 más")).toBeVisible();
});

it("falls back to the unread message, opens it, and moves on to the profile once the server confirms the read", async () => {
  vi.mocked(loadWorkspaceAssessmentsAction).mockResolvedValue({ ok: true, data: { items: [] } });
  let confirm!: (value: { ok: true; data: null }) => void;
  vi.mocked(markMessageReadAction).mockReturnValue(new Promise(resolve => { confirm = resolve; }));
  render(<CandidateDashboardWorkspace />);
  const card = await screen.findByRole("region", { name: "Siguiente paso" });
  expect(within(card).getByRole("heading", { name: "Grupo Altavista te escribió" })).toBeVisible();
  expect(within(card).getByText("Sobre Desarrollador(a) Backend Go · hoy, 12:30 · postulación cerrada")).toBeVisible();
  expect(within(card).getByRole("link", { name: "Explorar vacantes" })).toHaveAttribute("href", "/vacantes");
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  await user.click(within(card).getByRole("button", { name: "Leer mensaje" }));
  const dialog = await screen.findByRole("dialog", { name: "Mensaje de la empresa" });
  for (const line of MESSAGE.split("\n")) expect(within(dialog).getByText(line)).toBeVisible();
  expect(markMessageReadAction).toHaveBeenCalledExactlyOnceWith("a4", { updated_at: apps[3].updated_at });
  // Still pending until the server confirms (the modal hides the card from the accessibility tree meanwhile).
  expect(within(card).getByRole("heading", { name: "Grupo Altavista te escribió", hidden: true })).toBeInTheDocument();
  await act(async () => { confirm({ ok: true, data: null }); });
  await user.click(within(dialog).getByRole("button", { name: "Cerrar" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Mensaje de la empresa" })).toBeNull());
  expect(within(region("Siguiente paso")).getByRole("heading", { name: "Completa tu perfil: te faltan 2 datos" })).toBeVisible();
  expect(within(region("Siguiente paso")).getByText("Falta teléfono y ubicación · 10 de 12 datos completos")).toBeVisible();
  expect(within(region("Siguiente paso")).getByRole("link", { name: "Completar perfil" })).toHaveAttribute("href", "/candidato/perfil");
  expect(within(region("Siguiente paso")).queryByRole("button", { name: /pendientes? más/ })).toBeNull();
});

it.each(["message_changed", "no_response"])("keeps the message pending when the read acknowledgment fails with %s", async reason => {
  vi.mocked(loadWorkspaceAssessmentsAction).mockResolvedValue({ ok: true, data: { items: [] } });
  vi.mocked(markMessageReadAction).mockResolvedValue({ ok: false, reason: reason as "no_response", reference: reason === "message_changed" ? { status: 409, code: "message_changed" } : {} });
  render(<CandidateDashboardWorkspace />);
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  await user.click(await within(await screen.findByRole("region", { name: "Siguiente paso" })).findByRole("button", { name: "Leer mensaje" }));
  // message_changed re-reads the applications, which replaces the stale message instead of keeping it open.
  if (reason !== "message_changed") await user.click(within(await screen.findByRole("dialog", { name: "Mensaje de la empresa" })).getByRole("button", { name: "Cerrar" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Mensaje de la empresa" })).toBeNull());
  await waitFor(() => expect(loadApplicationsAction).toHaveBeenCalledTimes(reason === "message_changed" ? 2 : 1));
  expect(await screen.findByRole("heading", { name: "Grupo Altavista te escribió" })).toBeVisible();
  expect(markMessageReadAction).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("hides «Siguiente paso» when nothing is pending, even with saved vacancies not applied to", async () => {
  vi.mocked(loadWorkspaceAssessmentsAction).mockResolvedValue({ ok: true, data: { items: [] } });
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { items: apps.map(item => item.message ? { ...item, message_read_at: at(11, 18, 12, 40) } : item), next_cursor: null } });
  vi.mocked(loadProfileAction).mockResolvedValue(profile("+52 33 1234 5678"));
  render(<CandidateDashboardWorkspace />);
  expect(await within(await screen.findByRole("article", { name: "Guardadas" })).findByText("2")).toBeVisible();
  await waitFor(() => expect(within(tile("Perfil")).getByText("Perfil completo")).toBeVisible());
  expect(screen.queryByRole("region", { name: "Siguiente paso" })).toBeNull();
  expect(screen.queryByLabelText(/Cargando/)).toBeNull();
});

it("leads with the dark «Este mes» hero: count, first month, the advance sentence and the status counts", async () => {
  render(<CandidateDashboardWorkspace />);
  const hero = await screen.findByRole("region", { name: "Este mes" });
  expect(hero).toHaveClass("pf-kpi-hero");
  expect(within(hero).getByText("Noviembre")).toBeVisible();
  expect(within(hero).getByText("4")).toBeVisible();
  expect(within(hero).getByText("postulaciones")).toBeVisible();
  expect(within(hero).getByText("Primer mes de actividad")).toBeVisible();
  expect(within(hero).getByText(exact("2 de 4 ya avanzaron a proceso, el mismo día que postulaste."))).toBeVisible();
  expect(within(within(hero).getByRole("list", { name: "Postulaciones por estado" })).getAllByRole("listitem").map(item => item.textContent)).toEqual(["Enviada 1", "En proceso 2", "Cerrada 1"]);
  // Fewer than 4 active weeks and 5 applications: words and counts only (research §5).
  expect(within(hero).queryByRole("img")).toBeNull();
});

it("shows the delta against last month, the sparkline from 4 active weeks and the status bar from 5 applications", async () => {
  const history = [at(10, 21), at(10, 28), at(11, 4), at(11, 11), at(11, 12)].map((applied_at, index) => application(`h${index}`, `Vacante ${index}`, { applied_at, first_response_at: null }));
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { items: [...apps, ...history], next_cursor: null } });
  render(<CandidateDashboardWorkspace />);
  const hero = await screen.findByRole("region", { name: "Este mes" });
  await waitFor(() => expect(within(hero).getByText("7")).toBeVisible());
  expect(within(hero).getByText("5 más que en octubre")).toBeVisible();
  expect(within(hero).getByText(exact("2 de 9 ya avanzaron a proceso, el mismo día que postulaste."))).toBeVisible();
  expect(within(hero).getByRole("img", { name: "Postulaciones por semana, últimas 12 semanas: 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 2, 4" })).toBeVisible();
  expect(within(hero).getByRole("img", { name: "Postulaciones por estado: 6 enviadas, 2 en proceso, 1 cerrada" })).toBeVisible();
});

it("fills the bento tiles from real data", async () => {
  render(<CandidateDashboardWorkspace />);
  await screen.findByRole("region", { name: "Este mes" });
  const streak = tile("Racha");
  expect(streak).toHaveTextContent("1 semana");
  expect(within(streak).getByText("Tu primera semana activa")).toBeVisible();
  expect(within(streak).getByRole("img", { name: "Constancia de las últimas 12 semanas: 1 con postulaciones, racha de 1 semana" })).toBeVisible();
  expect(streak.querySelectorAll("[data-week]")).toHaveLength(12);
  expect(streak.querySelector('[data-week][data-current="true"]')).toHaveAttribute("data-week", "2026-11-16");
  const advanced = tile("Avanzaron");
  expect(advanced).toHaveTextContent("2 de 4");
  expect(within(advanced).getByText("pasaron a proceso")).toBeVisible();
  expect(within(advanced).getByRole("link", { name: "Ver en proceso" })).toHaveAttribute("href", "/candidato/postulaciones");
  const response = tile("Primera respuesta");
  expect(within(response).getByText("El mismo día")).toBeVisible();
  // Same figure as the other tiles (artboard: 32/600 at desktop), not the 20 px text value.
  expect(within(response).getByText("El mismo día")).toHaveClass("text-[28px]", "sm:text-[32px]", "font-semibold", "tracking-tight");
  expect(within(response).getByText("3 respuestas de 4")).toBeVisible();
  expect(within(response).queryByRole("img")).toBeNull();
  const savedTile = await within(screen.getByRole("article", { name: "Guardadas" })).findByText("2");
  expect(savedTile).toBeVisible();
  expect(within(tile("Guardadas")).getByText("sin postular · todas abiertas")).toBeVisible();
  expect(within(tile("Guardadas")).getByRole("link", { name: "Ver guardadas" })).toHaveAttribute("href", "/candidato/guardadas");
});

it("averages response days and draws the histogram only from 5 responses", async () => {
  const answered = [0, 1, 2, 3, 9].map((days, index) => application(`r${index}`, `Vacante ${index}`, { applied_at: at(11, 2), first_response_at: at(11, 2 + days), status: "in_process" }));
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { items: answered, next_cursor: null } });
  render(<CandidateDashboardWorkspace />);
  await screen.findByRole("region", { name: "Este mes" });
  const response = tile("Primera respuesta");
  expect(response).toHaveTextContent("3 días");
  expect(within(response).getByText("en promedio · 5 respuestas")).toBeVisible();
  expect(within(response).getByRole("img", { name: "Días hasta la primera respuesta: el mismo día 1, 1 día 1, 2 días 1, 3 días 1, 4 días 0, 5 días 0, 6 o más días 1" })).toBeVisible();
});

it("says «Sin respuestas aún» while every company is still deciding, and counts saved vacancies honestly", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { items: [apps[0]], next_cursor: null } });
  vi.mocked(loadSavedJobsAction).mockResolvedValue(saved([savedRow("s1", false), savedRow("s2", false, "closed")]));
  render(<CandidateDashboardWorkspace />);
  await screen.findByRole("region", { name: "Este mes" });
  expect(within(tile("Primera respuesta")).getByText("Sin respuestas aún")).toBeVisible();
  expect(within(tile("Primera respuesta")).getByText("1 postulación espera su primer cambio")).toBeVisible();
  expect(await within(tile("Guardadas")).findByText("sin postular · 1 de 2 abiertas")).toBeVisible();
});

it("lists recent applications by last change with their badge, pending marks and relative time", async () => {
  render(<CandidateDashboardWorkspace />);
  const list = await screen.findByRole("list", { name: "Ordenadas por su último cambio" });
  const recent = region("Postulaciones recientes");
  const rows = within(list).getAllByRole("listitem");
  expect(rows.map(row => within(row).getByRole("link").textContent)).toEqual(["Desarrollador(a) Backend Go", "Químico(a) Farmacéutico(a) Responsable Sanitario", "Ejecutivo(a) de Ventas Institucionales", "Residente de Obra Civil"]);
  expect(within(rows[0]).getByText("Grupo Altavista · 1 mensaje nuevo")).toBeVisible();
  expect(within(rows[0]).getByLabelText("Mensaje sin leer")).toBeInTheDocument();
  expect(within(rows[1]).getByText("Grupo Altavista · Evaluación 23/63")).toBeVisible();
  expect(rows.map(row => row.querySelector('[data-slot="badge"]')?.textContent)).toEqual(["Cerrada", "En proceso", "En proceso", "Enviada"]);
  expect(rows.map(row => row.querySelector("time")?.textContent)).toEqual(["Hoy, 12:30", "Hoy, 11:02", "Hoy, 10:15", "Hoy, 9:05"]);
  expect(within(recent).getByRole("link", { name: "Ver todas" })).toHaveAttribute("href", "/candidato/postulaciones");
});

const items = (list: HTMLElement) => within(list).getAllByRole("listitem").map(item => item.textContent);

it("shows an incomplete profile as its percentage, the missing items as chips and «Completar perfil»", async () => {
  render(<CandidateDashboardWorkspace />);
  const card = await screen.findByRole("article", { name: "Perfil" });
  const ring = await within(card).findByRole("img", { name: "Perfil completo al 83 %" });
  expect(ring).toHaveTextContent("83%");
  expect(within(card).getByText("Te falta poco")).toBeVisible();
  expect(within(card).getByText("10 de 12 datos completos")).toBeVisible();
  expect(items(within(card).getByRole("list", { name: "Datos que faltan" }))).toEqual(["Teléfono", "Ubicación"]);
  expect(within(card).getByRole("link", { name: "Completar perfil" })).toHaveAttribute("href", "/candidato/perfil");
  expect(within(card).queryByRole("link", { name: "Ver perfil" })).toBeNull();
  expect(within(card).queryByRole("list", { name: "Lo que ven las empresas" })).toBeNull();
});

it("shows a complete profile with a check, what companies see from the real data and «Ver perfil»", async () => {
  vi.mocked(loadProfileAction).mockResolvedValue(profile("+52 33 1234 5678"));
  render(<CandidateDashboardWorkspace />);
  const card = await screen.findByRole("article", { name: "Perfil" });
  const ring = await within(card).findByRole("img", { name: "Perfil completo al 100 %" });
  expect(ring).not.toHaveTextContent("100");
  expect(ring.querySelector("[data-profile-check]")).toBeInTheDocument();
  expect(within(card).getByText("Perfil completo")).toBeVisible();
  expect(within(card).getByText("Las empresas ven todo tu perfil")).toBeVisible();
  await waitFor(() => expect(items(within(card).getByRole("list", { name: "Lo que ven las empresas" }))).toEqual(["Experiencia", "Educación", "Idiomas", "CV"]));
  expect(within(card).getByRole("link", { name: "Ver perfil" })).toHaveAttribute("href", "/candidato/perfil");
  expect(within(card).queryByRole("list", { name: "Datos que faltan" })).toBeNull();
});

it("lists only the sections that exist: no CV chip without a CV", async () => {
  vi.mocked(loadProfileAction).mockResolvedValue(profile("+52 33 1234 5678"));
  vi.mocked(loadCvsAction).mockResolvedValue(cvs(0));
  render(<CandidateDashboardWorkspace />);
  const card = await screen.findByRole("article", { name: "Perfil" });
  await within(tile("CVs")).findByRole("link", { name: "Subir CV" });
  expect(items(await within(card).findByRole("list", { name: "Lo que ven las empresas" }))).toEqual(["Experiencia", "Educación", "Idiomas"]);
});

it("shows the CV library", async () => {
  render(<CandidateDashboardWorkspace />);
  const library = tile("CVs");
  expect(await within(library).findByText(exact("1 de 7"))).toBeVisible();
  expect(within(library).getByText(/1 en uso/)).toBeVisible();
  expect(within(library).getByRole("link", { name: "Subir otro" })).toHaveAttribute("href", "/candidato/cvs");
});

it("drops the old banner, donut, status card and question charts", async () => {
  render(<CandidateDashboardWorkspace />);
  await screen.findByRole("region", { name: "Este mes" });
  for (const gone of ["Pendientes", "Estado de tus postulaciones", "¿Estoy siendo constante?", "¿Está funcionando?", "¿Cuánto tardan en responder?", "Por atender"]) expect(screen.queryByText(gone)).toBeNull();
  expect(document.querySelector('[data-slot="chart"]')).toBeNull();
  expect(document.querySelector(".recharts-wrapper")).toBeNull();
});

it("teaches the first visit instead of showing zeros", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { items: [], next_cursor: null } });
  vi.mocked(loadCvsAction).mockResolvedValue(cvs(0));
  vi.mocked(loadSavedJobsAction).mockResolvedValue(saved([]));
  vi.mocked(loadProfileAction).mockResolvedValue({ ok: true, data: { profile: null, languages: { languages: [] } } });
  vi.mocked(loadWorkspaceAssessmentsAction).mockResolvedValue({ ok: true, data: { items: [] } });
  render(<CandidateDashboardWorkspace />);
  expect(await screen.findByRole("heading", { name: "Aquí empieza tu búsqueda" })).toBeVisible();
  expect(screen.queryByRole("region", { name: "Este mes" })).toBeNull();
  expect(screen.getByRole("heading", { name: "Tu primera postulación va aquí" })).toBeVisible();
  expect(await within(tile("Guardadas")).findByText("Aún no guardas vacantes")).toBeVisible();
  expect(within(tile("CVs")).getByRole("link", { name: "Subir CV" })).toHaveAttribute("href", "/candidato/cvs");
  expect(within(region("Siguiente paso")).getByRole("heading", { name: "Completa tu perfil: te faltan 12 datos" })).toBeVisible();
  // An empty profile keeps the chips to the first three missing items and a count of the rest.
  const card = tile("Perfil");
  expect(within(card).getByText("Completa tu perfil")).toBeVisible();
  expect(items(within(card).getByRole("list", { name: "Datos que faltan" }))).toEqual(["Título profesional", "Resumen profesional", "Teléfono", "+9 más"]);
});

it("notes when only the latest page of applications is summarised", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { items: apps, next_cursor: "another-page" } });
  render(<CandidateDashboardWorkspace />);
  expect(await screen.findByRole("note")).toHaveTextContent("Resumen de las últimas 4 postulaciones. Consulta todas en Postulaciones.");
  expect(loadApplicationsAction).toHaveBeenCalledWith({ limit: 50 });
});

it.each(["applications", "cvs", "profile", "saved", "assessments"])("isolates a %s failure and retries only that source", async source => {
  const actions = { applications: loadApplicationsAction, cvs: loadCvsAction, profile: loadProfileAction, saved: loadSavedJobsAction, assessments: loadWorkspaceAssessmentsAction };
  vi.mocked(actions[source as keyof typeof actions]).mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} });
  render(<CandidateDashboardWorkspace />);
  const retry = await screen.findByRole("button", { name: "Reintentar" });
  if (source !== "cvs") expect(await within(tile("CVs")).findByText(exact("1 de 7"))).toBeVisible();
  if (source !== "applications") expect(await screen.findByRole("link", { name: "Residente de Obra Civil" })).toBeVisible();
  const before = Object.fromEntries(Object.entries(actions).map(([key, action]) => [key, vi.mocked(action).mock.calls.length]));
  await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(retry);
  await waitFor(() => expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull());
  for (const [key, action] of Object.entries(actions)) expect(action).toHaveBeenCalledTimes(before[key] + (key === source ? 1 : 0));
});

it("offers login for an expired session and RoleBlocked for the wrong role", async () => {
  vi.mocked(loadCvsAction).mockResolvedValueOnce({ ok: false, reason: "unauthenticated", reference: {} });
  vi.mocked(loadProfileAction).mockResolvedValueOnce({ ok: false, reason: "forbidden", reference: { code: "wrong_role" } });
  render(<CandidateDashboardWorkspace />);
  expect(await screen.findByRole("link", { name: "Iniciar sesión" })).toHaveAttribute("href", "/candidato/login?next=%2Fcandidato%2Fdashboard");
  expect(await screen.findByText("Esta cuenta es de empresa")).toBeVisible();
  expect(await screen.findByRole("link", { name: "Residente de Obra Civil" })).toBeVisible();
});

it("loads every section with a skeleton, never zeros or empty states before resolution", () => {
  const never = new Promise<never>(() => {});
  for (const action of [loadApplicationsAction, loadCvsAction, loadProfileAction, loadSavedJobsAction, loadWorkspaceAssessmentsAction]) vi.mocked(action).mockReturnValue(never);
  render(<CandidateDashboardWorkspace />);
  for (const label of ["Cargando evaluaciones", "Cargando este mes", "Cargando postulaciones", "Cargando CVs", "Cargando perfil", "Cargando guardadas"]) expect(screen.getAllByLabelText(label).length).toBeGreaterThan(0);
  expect(document.querySelector('[data-slot="skeleton"]')).toBeInTheDocument();
  expect(screen.queryByText("0")).toBeNull();
  expect(screen.queryByRole("region", { name: "Siguiente paso" })).toBeNull();
});

// Title of every element that ever carried a class, one entry per element (a remount counts twice).
function recordClass(name: string) {
  const seen = new Map<Element, string>();
  const note = (element: Element) => { if (element.classList.contains(name) && !seen.has(element)) seen.set(element, element.querySelector("h3, [id]")?.textContent ?? ""); };
  const scan = (node: Node) => { if (node instanceof Element) { note(node); node.querySelectorAll(`.${CSS.escape(name)}`).forEach(note); } };
  scan(document.body);
  const observer = new MutationObserver(records => records.forEach(record => { if (record.type === "attributes") scan(record.target); record.addedNodes.forEach(scan); }));
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  return { titles: () => { scan(document.body); observer.disconnect(); return [...seen.values()].sort(); } };
}

it("enters each part once, on its loaded content, never on its skeleton", async () => {
  expect(motion.rise).toBeTruthy();
  let resolve!: (value: Awaited<ReturnType<typeof loadApplicationsAction>>) => void;
  vi.mocked(loadApplicationsAction).mockReturnValue(new Promise(done => { resolve = done; }));
  const rise = recordClass(motion.rise);
  render(<CandidateDashboardWorkspace />);
  await within(tile("CVs")).findByText(exact("1 de 7"));
  // The bento skeleton is still on screen and carries no entrance.
  expect(screen.getByLabelText("Cargando este mes")).toBeInTheDocument();
  for (const name of ["Racha", "Avanzaron", "Primera respuesta"]) expect(tile(name)).not.toHaveClass(motion.rise);
  await act(async () => resolve({ ok: true, data: { items: apps, next_cursor: null } }));
  await screen.findByRole("region", { name: "Este mes" });
  await screen.findByRole("region", { name: "Siguiente paso" });
  expect(rise.titles()).toEqual(["Avanzaron", "CVs", "Este mes", "Guardadas", "Perfil", "Primera respuesta", "Racha", "Siguiente paso"]);
});

it("lets content that arrives after 600 ms appear with a short fade instead of the entrance", async () => {
  expect(motion.quiet).toBeTruthy();
  let resolve!: (value: Awaited<ReturnType<typeof loadSavedJobsAction>>) => void;
  vi.mocked(loadSavedJobsAction).mockReturnValue(new Promise(done => { resolve = done; }));
  const now = vi.spyOn(performance, "now").mockReturnValue(1000);
  render(<CandidateDashboardWorkspace />);
  await screen.findByRole("region", { name: "Este mes" });
  expect(tile("Racha")).toHaveClass(motion.rise);
  expect(tile("Guardadas")).not.toHaveClass(motion.rise);
  now.mockReturnValue(1601);
  await act(async () => resolve(saved([savedRow("s1", false)])));
  await within(tile("Guardadas")).findByText("1");
  expect(tile("Guardadas")).toHaveClass(motion.quiet);
  expect(tile("Guardadas")).not.toHaveClass(motion.rise);
});

it("does not re-render the dashboard or its charts while the clock runs (S2)", async () => {
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(NOW);
  const commits = vi.fn();
  render(<Profiler id="dashboard" onRender={commits}><CandidateDashboardWorkspace /></Profiler>);
  // Let the reads resolve, then let the one-off timers they schedule (overlay mount transitions) run out.
  await act(() => vi.advanceTimersByTimeAsync(0));
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(screen.getByRole("region", { name: "Siguiente paso" })).toBeVisible();
  expect(screen.getByRole("article", { name: "Racha" })).toBeVisible();
  // Only the assessment expiry timeout stays scheduled (20 nov), never a per-second ticker.
  expect(vi.getTimerCount()).toBe(1);
  const settled = commits.mock.calls.length;
  for (let second = 0; second < 5; second++) await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(commits).toHaveBeenCalledTimes(settled);
});

it("contains no prototype imports in the real route islands", () => {
  for (const path of ["components/candidate-dashboard/candidate-dashboard-overview.tsx", "features/candidate/dashboard/workspace.tsx", "features/candidate/dashboard/charts.tsx", "features/candidate/dashboard/insights.ts", "features/candidate/dashboard/assessments.tsx", "features/candidate/dashboard/next-step.tsx"]) expect(readFileSync(`src/${path}`, "utf8")).not.toMatch(/from ["'][^"']*prototype-/);
});
