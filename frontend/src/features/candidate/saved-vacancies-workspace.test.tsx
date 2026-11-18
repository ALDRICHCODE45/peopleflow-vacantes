import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { legacyDetail, vacancyDetail } from "@/features/jobs/api/public-fixtures";
import type { SavedJobItem, SavedJobs } from "@/features/saved-vacancies/model";
import { loadSavedJobsAction, removeSavedJobAction, removeClosedSavedJobsAction, saveJobAction } from "@/features/saved-vacancies/actions";
import { loadApplicationsAction } from "@/features/candidate-applications/actions";
import type { ApplicationsPage } from "@/features/candidate-applications/model";
import { notifyActionResult } from "@/components/feedback/notify";
import { savedJobIdsKey, savedJobsQueryClient } from "@/features/saved-vacancies/queries";
import type { Identity } from "@/features/identity/model";
import { SavedVacanciesWorkspace } from "./saved-vacancies-workspace";
vi.mock("@/features/saved-vacancies/actions", () => ({ loadSavedJobsAction: vi.fn(), removeSavedJobAction: vi.fn(), removeClosedSavedJobsAction: vi.fn(), saveJobAction: vi.fn() }));
vi.mock("@/features/candidate-applications/actions", () => ({ loadApplicationsAction: vi.fn() }));
// Keep the real popover controls; only replace the jsdom-looping anchored shell (as cv-workspace.test.tsx does).
vi.mock("@/components/ui/popover", async importOriginal => ({
  ...await importOriginal<typeof import("@/components/ui/popover")>(),
  PopoverContent: ({ children }: { children?: ReactNode }) => children ? <div role="dialog" aria-label="Ayuda">{children}</div> : null,
}));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn(), dismissActionResult: vi.fn() }));
let identity: Identity;
vi.mock("@/features/identity/identity-session", () => ({ useIdentity: () => ({ status: "ready", result: { ok: true, data: identity } }) }));

/* «Hoy» is Wednesday 18 Nov 2026, 19:00 UTC. */
const NOW = "2026-11-18T19:00:00Z";
type Vacancy = Extract<SavedJobItem["job"], { source: "vacancy" }>;
const money = (min: string, max: string, basis: "gross" | "net") => ({ mode: "range" as const, amount: null, min, max, currency: "MXN" as const, pay_period: "monthly" as const, basis });
const vacancy = (overrides: Partial<Vacancy>): Vacancy => ({ ...vacancyDetail, ...overrides });
function row(id: string, job: SavedJobItem["job"], overrides: Partial<SavedJobItem> = {}): SavedJobItem {
  return { job_id: id, saved_at: "2026-11-18T16:00:00Z", availability: "open", closed_at: null, application: null, job, ...overrides };
}
const A = row("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", vacancy({ title: "Supervisor de Almacén", work_mode: "onsite", location_label: "Apodaca, Nuevo León", compensation: money("22000.00", "26000.00", "gross"), published_at: "2026-11-12T15:00:00Z" }), { saved_at: "2026-11-18T16:12:00Z" });
const B = row("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", vacancy({ title: "Analista de Nómina", work_mode: "hybrid", location_label: "Cuauhtémoc, Ciudad de México", compensation: money("17000.00", "20000.00", "net"), published_at: "2026-11-16T15:00:00Z" }), { saved_at: "2026-11-18T16:20:00Z" });
const C = row(legacyDetail.id, { ...legacyDetail, published_at: "2026-11-12T09:00:00Z" }, { saved_at: "2026-11-17T12:00:00Z" });
const applicationId = "22222222-2222-4222-8222-222222222222";
const D = row("dddddddd-dddd-4ddd-8ddd-dddddddddddd", vacancy({ title: "Residente de Obra", work_mode: "onsite", published_at: "2026-11-10T15:00:00Z" }), { application: { id: applicationId, applied_at: "2026-11-15T17:00:00Z" } });
const E = row("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", vacancy({ title: "Planeador de Mantenimiento", compensation: null }), { availability: "closed", closed_at: "2026-11-15T15:00:00Z", application: D.application });
let items: SavedJobItem[];
let applications: ApplicationsPage["items"];
const data = (): SavedJobs => ({ items, total: items.length, limit: 200 });
const card = (id: string) => document.querySelector(`[data-pf-saved-vacancy="${id}"]`) as HTMLElement;
const select = (id: string) => card(id).querySelector("[data-pf-saved-select]") as HTMLButtonElement;
const queue = () => screen.getByRole("list", { name: /^Por postularte/ });
const order = () => Array.from(queue().querySelectorAll("[data-pf-saved-vacancy]")).map(node => node.getAttribute("data-pf-saved-vacancy"));
const reasons = (id: string) => Array.from(card(id).querySelectorAll("[data-pf-saved-reason]")).map(node => node.textContent);
const preview = () => screen.getByRole("complementary");
const SUMMARY = "5 guardadas · 3 por postularte · 1 ya no está disponible";
function narrow(on: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: on && query === "(max-width: 1279px)", media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(NOW));
  identity = { role: "candidate", user: { id: "candidate" } } as Identity;
  items = [A, B, C, D, E];
  applications = [{ id: applicationId, vacancy: { id: D.job_id, title: "Residente de Obra", state: "open" }, company: { id: vacancyDetail.company.id, name: "Acme" }, applied_at: "2026-11-15T17:00:00Z", status: "in_process", message: null }];
  vi.mocked(loadSavedJobsAction).mockImplementation(async () => ({ ok: true, data: data() }));
  vi.mocked(loadApplicationsAction).mockImplementation(async () => ({ ok: true, data: { items: applications, next_cursor: null } }));
  vi.mocked(removeSavedJobAction).mockImplementation(async id => { items = items.filter(item => item.job_id !== id); return { ok: true, data: null }; });
  vi.mocked(saveJobAction).mockImplementation(async id => { items = [A, ...items.filter(item => item.job_id !== A.job_id)]; return { ok: true, data: { job_id: String(id), saved_at: NOW } }; });
  vi.mocked(removeClosedSavedJobsAction).mockImplementation(async () => { items = items.filter(item => item.availability !== "closed"); return { ok: true, data: { removed: 1 } }; });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  narrow(false);
});
afterEach(() => { cleanup(); savedJobsQueryClient(identity).clear(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function loaded() { render(<SavedVacanciesWorkspace />); await screen.findByText(SUMMARY); }

describe("header and groups", () => {
  it("summarises the three groups, keeps the route width and titles the queue «Postúlate primero»", async () => {
    await loaded();
    expect(document.querySelector("[data-pf-saved-vacancies-workspace]")).toHaveClass("max-w-screen-2xl");
    expect(screen.getByRole("heading", { level: 2, name: "Vacantes guardadas" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Postúlate primero 3" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ya te postulaste 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ya no disponibles 1" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("link", { name: "Ver postulaciones" })).toHaveAttribute("href", "/candidato/postulaciones");
  });
  it("says every saved vacancy is still open when none closed, in the singular too", async () => {
    items = [A]; render(<SavedVacanciesWorkspace />);
    await screen.findByText("1 guardada · 1 por postularte · sigue abierta");
    expect(screen.queryByRole("heading", { name: /Ya te postulaste/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ya no disponibles/ })).not.toBeInTheDocument();
    // One vacancy cannot be sorted: no sort control.
    expect(screen.queryByRole("group", { name: "Ordenar por postularte" })).not.toBeInTheDocument();
    items = [A, B]; cleanup(); savedJobsQueryClient(identity).clear(); render(<SavedVacanciesWorkspace />);
    await screen.findByText("2 guardadas · 2 por postularte · todas siguen abiertas");
  });
  it("explains the order in an ⓘ popover", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "¿Cómo se ordena?" }));
    const dialog = screen.getByRole("dialog", { name: "Ayuda" });
    expect(within(dialog).getByText("¿Cómo se ordena?")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Sugerido: primero las que llevan más días publicadas.");
    expect(dialog).toHaveTextContent("Bruto y neto no se comparan entre sí");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cerrar ayuda" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("sort and reasons", () => {
  it("Sugerido puts the longest published first, breaks day ties by the newest saved and names only facts", async () => {
    // Backend order puts C (saved yesterday) before A (saved today): the tie on 6 days must still put A first.
    items = [C, B, A, D, E]; await loaded();
    expect(screen.getByRole("button", { name: "Sugerido" })).toHaveAttribute("aria-pressed", "true");
    expect(order()).toEqual([A.job_id, C.job_id, B.job_id]);
    expect(reasons(A.job_id)).toEqual(["Lleva 6 días publicada"]);
    expect(reasons(C.job_id)).toEqual(["Lleva 6 días publicada", "La única remota"]);
    expect(reasons(B.job_id)).toEqual(["Lleva 2 días publicada", "La única híbrida"]);
    expect(within(card(A.job_id)).getByText("Supervisor de Almacén")).toBeInTheDocument();
    expect(card(A.job_id)).toHaveTextContent("Acme · Apodaca, Nuevo León · Presencial");
    expect(card(A.job_id).querySelector("[data-pf-saved-salary]")).toHaveTextContent("$22k–26kbruto");
    expect(card(C.job_id).querySelector("[data-pf-saved-salary]")).toHaveTextContent("$30k–45kbruto o neto sin indicar");
  });
  it("Salario ranks by the published maximum within one basis and never ranks neto against bruto", async () => {
    const F = row("ffffffff-ffff-4fff-8fff-ffffffffffff", vacancy({ title: "Contador Sr.", work_mode: "onsite", compensation: money("35000.00", "40000.00", "net") }));
    const G = row("99999999-9999-4999-8999-999999999999", vacancy({ title: "Sin salario", work_mode: "onsite", compensation: null }));
    items = [G, B, A, C, F]; render(<SavedVacanciesWorkspace />);
    await screen.findByText("5 guardadas · 5 por postularte · todas siguen abiertas");
    fireEvent.click(screen.getByRole("button", { name: "Salario" }));
    // Neto $40,000 does not outrank bruto $26,000: each basis is ranked on its own scale.
    expect(order()).toEqual([A.job_id, F.job_id, B.job_id, C.job_id, G.job_id]);
    expect(reasons(A.job_id)[0]).toBe("Hasta $26,000 bruto");
    expect(reasons(F.job_id)[0]).toBe("Hasta $40,000 neto");
    expect(reasons(C.job_id)[0]).toBe("Hasta $45,000, sin indicar bruto o neto");
    expect(reasons(G.job_id)).toEqual(["Salario no publicado"]);
    expect(card(G.job_id).querySelector("[data-pf-saved-salary]")).toHaveTextContent("—sin salario");
    expect(screen.getByText("Salario máximo publicado, de mayor a menor. Bruto y neto por separado.")).toBeInTheDocument();
  });
  it("Recientes puts the last saved first with «Guardada hace …»", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Recientes" }));
    expect(order()).toEqual([B.job_id, A.job_id, C.job_id]);
    expect(reasons(B.job_id)[0]).toBe("Guardada hace 2 h");
    expect(reasons(C.job_id)[0]).toBe("Guardada ayer");
  });
  it("flags a missing salary outside the Salario sort and says «Publicada hoy» on day zero", async () => {
    const H = row("88888888-8888-4888-8888-888888888888", vacancy({ title: "Nueva", work_mode: "onsite", compensation: null, published_at: "2026-11-18T08:00:00Z" }));
    items = [A, H]; render(<SavedVacanciesWorkspace />);
    await screen.findByText("2 guardadas · 2 por postularte · todas siguen abiertas");
    expect(reasons(H.job_id)).toEqual(["Publicada hoy", "Salario no publicado"]);
  });
  it("sorting reorders the same rows without remounting them or the sections (no re-animation)", async () => {
    await loaded();
    const section = queue().closest("section"); const first = card(A.job_id);
    expect(section).toHaveAttribute("data-pf-saved-enter");
    fireEvent.click(screen.getByRole("button", { name: "Recientes" }));
    expect(queue().closest("section")).toBe(section);
    expect(card(A.job_id)).toBe(first);
  });
});

describe("selection and preview", () => {
  it("selects the first row and previews its place, salary, facts, reasons and actions", async () => {
    await loaded();
    expect(select(A.job_id)).toHaveAttribute("aria-current", "true");
    expect(select(C.job_id)).not.toHaveAttribute("aria-current");
    const panel = preview();
    expect(panel).toHaveAccessibleName("Supervisor de Almacén");
    expect(within(panel).getByText("Número 1 para postularte")).toBeInTheDocument();
    expect(within(panel).getByText("$22,000 – $26,000 MXN")).toBeInTheDocument();
    expect(within(panel).getByText("Mensual · Bruto")).toBeInTheDocument();
    const facts = Array.from(panel.querySelectorAll("dl > div")).map(node => node.textContent);
    expect(facts).toEqual(["UbicaciónApodaca, Nuevo León", "ModalidadPresencial", "PublicadaHace 6 días", "GuardadaHace 2 h"]);
    expect(within(within(panel).getByRole("list", { name: "Por qué está en este lugar" })).getAllByRole("listitem").map(node => node.textContent)).toEqual(["Lleva 6 días publicada"]);
    expect(within(panel).getByRole("link", { name: "Postularme" })).toHaveAttribute("href", `/vacantes/${A.job_id}/postular`);
    expect(within(panel).getByRole("link", { name: "Ver vacante" })).toHaveAttribute("href", `/vacantes/${A.job_id}`);
    expect(within(panel).getByRole("button", { name: "Quitar Supervisor de Almacén de guardadas" })).toBeInTheDocument();
  });
  it("moves the selection with ArrowDown and ArrowUp and follows it in the preview", async () => {
    await loaded();
    select(A.job_id).focus();
    fireEvent.keyDown(select(A.job_id), { key: "ArrowDown" });
    expect(select(C.job_id)).toHaveFocus();
    expect(select(C.job_id)).toHaveAttribute("aria-current", "true");
    expect(select(A.job_id)).not.toHaveAttribute("aria-current");
    expect(within(preview()).getByText("Número 2 para postularte")).toBeInTheDocument();
    expect(within(preview()).getByText("Periodicidad y neto/bruto no especificados")).toBeInTheDocument();
    // A legacy vacancy has no application form.
    expect(within(preview()).queryByRole("link", { name: "Postularme" })).not.toBeInTheDocument();
    fireEvent.keyDown(select(C.job_id), { key: "ArrowUp" });
    expect(select(A.job_id)).toHaveFocus();
    expect(select(A.job_id)).toHaveAttribute("aria-current", "true");
  });
  it("selecting an applied row previews its status and the link to the application", async () => {
    await loaded();
    fireEvent.click(select(D.job_id));
    const panel = preview();
    expect(within(panel).getByText("Ya te postulaste")).toBeInTheDocument();
    expect(within(panel).getByText("En proceso")).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Ver postulación" })).toHaveAttribute("href", `/candidato/postulaciones?postulacion=${applicationId}`);
  });
  it("below the breakpoint expands the selected row in place with the same content and no side panel", async () => {
    narrow(true); await loaded();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(select(A.job_id)).toHaveAttribute("aria-expanded", "true");
    expect(select(A.job_id)).not.toHaveAttribute("aria-current");
    expect(within(card(A.job_id)).getByText("$22,000 – $26,000 MXN")).toBeInTheDocument();
    expect(within(card(A.job_id)).getByRole("link", { name: "Postularme" })).toHaveClass("min-h-11");
    fireEvent.click(select(B.job_id));
    expect(select(A.job_id)).toHaveAttribute("aria-expanded", "false");
    expect(within(card(B.job_id)).getByText("$17,000 – $20,000 MXN")).toBeInTheDocument();
    expect(within(card(A.job_id)).queryByRole("link", { name: "Postularme" })).not.toBeInTheDocument();
    fireEvent.click(select(B.job_id));
    expect(select(B.job_id)).toHaveAttribute("aria-expanded", "false");
  });
});

describe("applied status join", () => {
  it("joins the application status by application id, read-only", async () => {
    await loaded();
    expect(await within(card(D.job_id)).findByText("En proceso")).toBeInTheDocument();
    expect(card(D.job_id)).toHaveTextContent("Te postulaste el 15 de noviembre de 2026");
    expect(loadApplicationsAction).toHaveBeenCalledWith({ limit: 50 });
  });
  it("pages until it finds the application and falls back to the date alone when it cannot join", async () => {
    vi.mocked(loadApplicationsAction).mockResolvedValueOnce({ ok: true, data: { items: [], next_cursor: "next" } }).mockResolvedValueOnce({ ok: true, data: { items: applications, next_cursor: null } });
    await loaded();
    expect(await within(card(D.job_id)).findByText("En proceso")).toBeInTheDocument();
    expect(loadApplicationsAction).toHaveBeenLastCalledWith({ limit: 50, cursor: "next" });
    cleanup(); savedJobsQueryClient(identity).clear();
    vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: false, reason: "server_error", reference: { status: 503 } });
    await loaded();
    await waitFor(() => expect(loadApplicationsAction).toHaveBeenCalledTimes(3));
    expect(card(D.job_id)).toHaveTextContent("Te postulaste el 15 de noviembre de 2026");
    expect(within(card(D.job_id)).queryByText(/Enviada|En proceso|Cerrada/)).not.toBeInTheDocument();
  });
});

describe("Quitar and Deshacer", () => {
  it("keeps the row and counts until confirmed, removes it, moves focus to the next row and undoes", async () => {
    await loaded(); let confirm!: (value: { ok: true; data: null }) => void;
    vi.mocked(removeSavedJobAction).mockImplementationOnce(() => new Promise(resolve => { confirm = value => { items = items.filter(item => item.job_id !== A.job_id); resolve(value); }; }));
    const remove = within(preview()).getByRole("button", { name: "Quitar Supervisor de Almacén de guardadas" });
    fireEvent.click(remove); fireEvent.click(remove);
    expect(remove).toBeDisabled(); expect(card(A.job_id)).not.toBeNull();
    expect(screen.getByText(SUMMARY)).toBeInTheDocument();
    expect(notifyActionResult).not.toHaveBeenCalled();
    await act(async () => confirm({ ok: true, data: null }));
    await waitFor(() => expect(card(A.job_id)).toBeNull());
    expect(removeSavedJobAction).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(select(C.job_id)).toHaveFocus());
    expect(select(C.job_id)).toHaveAttribute("aria-current", "true");
    expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ title: "Quitaste la vacante", action: expect.objectContaining({ title: "Deshacer" }) }));
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    await waitFor(() => expect(saveJobAction).toHaveBeenCalledWith(A.job_id));
    await waitFor(() => expect(card(A.job_id)).not.toBeNull());
  });
  it("puts the queue right under the summary, adding the status row only while there is a result to show", async () => {
    await loaded();
    // An always-mounted empty status slot (40px) plus two 20px gaps left ~80px between the summary and the first group.
    const workspace = document.querySelector("[data-pf-saved-vacancies-workspace]")!;
    const header = screen.getByText(SUMMARY).closest("header")!;
    expect(header.nextElementSibling).not.toHaveAttribute("data-pf-action-bar");
    expect(header.nextElementSibling).toContainElement(screen.getByRole("heading", { name: "Postúlate primero 3" }));
    expect(workspace.querySelectorAll(":scope > [data-pf-action-bar]")).toHaveLength(0);
    vi.mocked(removeSavedJobAction).mockResolvedValueOnce({ ok: false, reason: "server_error", reference: { status: 503 } });
    fireEvent.click(within(preview()).getByRole("button", { name: /Quitar .* de guardadas/ }));
    const retry = await screen.findByRole("button", { name: "Reintentar" });
    expect(header.nextElementSibling).toHaveAttribute("data-pf-action-bar");
    expect(header.nextElementSibling).toContainElement(retry);
  });
  it("preserves rows and counts on failure with a persistent retry and a sanitized error reference", async () => {
    await loaded();
    vi.mocked(removeSavedJobAction).mockResolvedValueOnce({ ok: false, reason: "server_error", reference: { status: 503 } });
    fireEvent.click(within(preview()).getByRole("button", { name: /Quitar .* de guardadas/ }));
    await screen.findByRole("button", { name: "Reintentar" });
    expect(card(A.job_id)).not.toBeNull(); expect(screen.getByText(SUMMARY)).toBeInTheDocument();
    expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error", title: "El servidor tuvo un problema", reference: { status: 503, at: expect.any(String) } }));
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(card(A.job_id)).toBeNull());
  });
  it("preserves the empty state until undo is confirmed and explains a rejected re-save", async () => {
    items = [A]; render(<SavedVacanciesWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: /Quitar .* de guardadas/ }));
    await screen.findByText("Todavía no guardas vacantes");
    vi.mocked(saveJobAction).mockResolvedValueOnce({ ok: false, reason: "job_unavailable", reference: { status: 409, code: "job_unavailable" } });
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    await screen.findByText("Esta vacante ya no está disponible");
    expect(card(A.job_id)).toBeNull();
  });
});

describe("unavailable fold", () => {
  it("starts collapsed, lists the closed rows, confirms the bulk cleanup with an AlertDialog and reconciles ids", async () => {
    await loaded(); const disclosure = screen.getByRole("button", { name: "Ya no disponibles 1" });
    fireEvent.click(disclosure);
    expect(await screen.findByText("Acme · Cerró el 15 de noviembre de 2026")).toBeVisible();
    expect(within(card(E.job_id)).getByRole("button", { name: "Quitar Planeador de Mantenimiento de guardadas" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Quitar las que ya no están disponibles" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(removeClosedSavedJobsAction).not.toHaveBeenCalled();
    expect(dialog.querySelector('[data-slot="alert-dialog-header"] [data-slot="alert-dialog-media"]')).not.toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(removeClosedSavedJobsAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Quitar las que ya no están disponibles" }));
    const invalidate = vi.spyOn(savedJobsQueryClient(identity), "invalidateQueries");
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Quitar vacantes" }));
    await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Quitaste 1 vacante" })));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: savedJobIdsKey });
    await waitFor(() => expect(card(E.job_id)).toBeNull());
  });
  it("keeps the bulk confirmation open on failure, blocks double confirmation and retries only after another click", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Ya no disponibles 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Quitar las que ya no están disponibles" }));
    const dialog = await screen.findByRole("alertdialog");
    let reject!: () => void;
    vi.mocked(removeClosedSavedJobsAction).mockImplementationOnce(() => new Promise(resolve => { reject = () => resolve({ ok: false, reason: "no_response", reference: {} }); }));
    const confirm = within(dialog).getByRole("button", { name: "Quitar vacantes" });
    fireEvent.click(confirm); fireEvent.click(confirm);
    expect(confirm).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeDisabled();
    expect(removeClosedSavedJobsAction).toHaveBeenCalledTimes(1);
    await act(async () => reject());
    expect(dialog).toBeVisible();
    expect(card(E.job_id)).not.toBeNull();
    expect(screen.getByText(SUMMARY)).toBeInTheDocument();
    expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error", title: "No hubo respuesta del servidor" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(card(E.job_id)).toBeNull());
  });
  it("uses the server bulk result rather than the stale closed count and handles a zero result", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Ya no disponibles 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Quitar las que ya no están disponibles" }));
    vi.mocked(removeClosedSavedJobsAction).mockResolvedValueOnce({ ok: true, data: { removed: 0 } });
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Quitar vacantes" }));
    await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ title: "Quitaste 0 vacantes" })));
    expect(card(E.job_id)).not.toBeNull();
  });
  it("keeps unknown closed dates absent", async () => {
    items = [{ ...E, closed_at: null }];
    render(<SavedVacanciesWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Ya no disponibles 1" }));
    expect(await screen.findByText("Planeador de Mantenimiento")).toBeInTheDocument();
    expect(screen.queryByText(/Cerró/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Postularme" })).not.toBeInTheDocument();
  });
});

describe("states", () => {
  it("shows the inviting empty state with both ways out", async () => {
    items = []; render(<SavedVacanciesWorkspace />);
    expect(await screen.findByRole("heading", { name: "Todavía no guardas vacantes" })).toBeInTheDocument();
    expect(screen.getByText("Tu lista para decidir")).toBeInTheDocument();
    expect(screen.getByText("Guarda vacantes para compararlas y postularte cuando quieras.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Explorar vacantes" })).toHaveAttribute("href", "/vacantes");
    expect(screen.getByRole("link", { name: "Ver mis postulaciones" })).toHaveAttribute("href", "/candidato/postulaciones");
    expect(screen.queryByRole("group", { name: "Ordenar por postularte" })).not.toBeInTheDocument();
  });
  it("says so when every open saved vacancy already has an application", async () => {
    items = [D]; render(<SavedVacanciesWorkspace />);
    expect(await screen.findByRole("heading", { name: "Ya te postulaste a todas tus guardadas" })).toBeInTheDocument();
  });
  it("shows queue and preview skeletons while loading, then the content", async () => {
    let finish!: () => void;
    vi.mocked(loadSavedJobsAction).mockImplementation(() => new Promise(resolve => { finish = () => resolve({ ok: true, data: data() }); }));
    render(<SavedVacanciesWorkspace />);
    const busy = screen.getByText("Cargando vacantes guardadas").closest('[aria-busy="true"]')!;
    expect(busy).not.toBeNull();
    expect(busy.querySelectorAll("[data-pf-saved-loading-row]")).toHaveLength(3);
    expect(busy.querySelector("[data-pf-saved-loading-preview]")).not.toBeNull();
    await act(async () => finish());
    await screen.findByText(SUMMARY);
    expect(screen.queryByText("Cargando vacantes guardadas")).not.toBeInTheDocument();
  });
  it("shows the limit notice including closed rows", async () => {
    items = Array.from({ length: 200 }, (_, i) => row(String(i), vacancyDetail, { availability: "closed", closed_at: null }));
    render(<SavedVacanciesWorkspace />);
    expect(await screen.findByText("Llegaste al límite de 200 vacantes guardadas. Quita alguna para guardar otra.")).toBeInTheDocument();
  });
  it("shows a load error StateCard and a read-only retry", async () => {
    vi.mocked(loadSavedJobsAction).mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} });
    render(<SavedVacanciesWorkspace />);
    expect(await screen.findByText("No pudimos cargar tus vacantes guardadas")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await screen.findByText(SUMMARY);
    expect(removeSavedJobAction).not.toHaveBeenCalled();
  });
});
