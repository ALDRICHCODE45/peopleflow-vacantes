import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { legacyDetail, vacancyDetail } from "@/features/jobs/api/public-fixtures";
import type { SavedJobItem, SavedJobs } from "@/features/saved-vacancies/model";
import { loadSavedJobsAction, removeSavedJobAction, removeClosedSavedJobsAction, saveJobAction } from "@/features/saved-vacancies/actions";
import { notifyActionResult } from "@/components/feedback/notify";
import { savedJobIdsKey, savedJobsQueryClient } from "@/features/saved-vacancies/queries";
import type { Identity } from "@/features/identity/model";
import { SavedVacanciesWorkspace } from "./saved-vacancies-workspace";
vi.mock("@/features/saved-vacancies/actions", () => ({ loadSavedJobsAction: vi.fn(), removeSavedJobAction: vi.fn(), removeClosedSavedJobsAction: vi.fn(), saveJobAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn(), dismissActionResult: vi.fn() }));
let identity: Identity;
vi.mock("@/features/identity/identity-session", () => ({ useIdentity: () => ({ status: "ready", result: { ok: true, data: identity } }) }));
const date = "2026-11-01T12:00:00Z";
function row(id: string, overrides: Partial<SavedJobItem> = {}): SavedJobItem {
  return { job_id: id, saved_at: date, availability: "open", closed_at: null, application: null, job: vacancyDetail, ...overrides };
}
const first = row(vacancyDetail.id);
const legacy = row(legacyDetail.id, { job: legacyDetail });
const applied = row("11111111-1111-4111-8111-111111111111", { application: { id: "22222222-2222-4222-8222-222222222222", applied_at: date } });
const closed = row("33333333-3333-4333-8333-333333333333", { availability: "closed", closed_at: date, application: applied.application });
let items: SavedJobItem[];
const data = (): SavedJobs => ({ items, total: items.length, limit: 200 });
const card = (id: string) => document.querySelector(`[data-pf-saved-vacancy="${id}"]`) as HTMLElement;
beforeEach(() => {
  vi.clearAllMocks();
  identity = { role: "candidate", user: { id: "candidate" } } as Identity;
  items = [first, legacy, applied, closed];
  vi.mocked(loadSavedJobsAction).mockImplementation(async () => ({ ok: true, data: data() }));
  vi.mocked(removeSavedJobAction).mockImplementation(async id => { items = items.filter(item => item.job_id !== id); return { ok: true, data: null }; });
  vi.mocked(saveJobAction).mockImplementation(async id => { items = [first, ...items]; return { ok: true, data: { job_id: String(id), saved_at: date } }; });
  vi.mocked(removeClosedSavedJobsAction).mockImplementation(async () => { items = items.filter(item => item.availability !== "closed"); return { ok: true, data: { removed: 1 } }; });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); savedJobsQueryClient(identity).clear(); vi.unstubAllGlobals(); });
async function loaded() { render(<SavedVacanciesWorkspace />); await screen.findByText("4 guardadas · 2 por postularte"); }
it("groups by next step preserving backend order, counts closed applications only as closed, and keeps route width", async () => {
  await loaded();
  expect(screen.getByRole("heading", { name: "Por postularte 2" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Ya te postulaste 1" })).toBeInTheDocument();
  expect(Array.from(document.querySelectorAll('[aria-label="Por postularte"] [data-pf-saved-vacancy]')).map(node => node.getAttribute("data-pf-saved-vacancy"))).toEqual([first.job_id, legacy.job_id]);
  expect(document.querySelector('[data-pf-saved-vacancies-workspace]')).toHaveClass("max-w-screen-2xl");
  expect(within(card(applied.job_id)).getByRole("link", { name: "Ver postulación" })).toHaveAttribute("href", `/candidato/postulaciones?postulacion=${applied.application!.id}`);
  expect(within(card(first.job_id)).getByRole("link", { name: "Postularme" })).toHaveAttribute("href", `/vacantes/${first.job_id}/postular`);
  expect(within(card(legacy.job_id)).queryByRole("link", { name: "Postularme" })).not.toBeInTheDocument();
  expect(within(card(first.job_id)).getByRole("link", { name: "Ver vacante" })).toHaveAttribute("href", `/vacantes/${first.job_id}`);
});
it("formats both salary shapes with the public card formatter and displays saved dates", async () => {
  await loaded();
  expect(card(first.job_id)).toHaveTextContent("$30,000 – $40,000 MXN");
  expect(card(first.job_id)).toHaveTextContent("Mensual · Bruto");
  expect(card(legacy.job_id)).toHaveTextContent("$30,000 – $45,000 MXN");
  expect(card(legacy.job_id)).toHaveTextContent("Periodicidad y neto/bruto no especificados");
  expect(card(first.job_id)).toHaveTextContent("Guardada el 1 de noviembre de 2026");
});
it("omits empty groups and uses singular summary", async () => {
  items = [first]; render(<SavedVacanciesWorkspace />);
  await screen.findByText("1 guardada · 1 por postularte");
  expect(screen.queryByRole("heading", { name: /Ya te postulaste/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Ya no disponibles/ })).not.toBeInTheDocument();
});
it("starts the unavailable disclosure collapsed, confirms bulk cleanup with an AlertDialog, and reconciles ids", async () => {
  await loaded(); const disclosure = screen.getByRole("button", { name: "Ya no disponibles 1" });
  expect(disclosure).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(disclosure);
  expect(await screen.findByText("Cerró el 1 de noviembre de 2026")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Quitar las que ya no están disponibles" }));
  const dialog = await screen.findByRole("alertdialog");
  expect(removeClosedSavedJobsAction).not.toHaveBeenCalled();
  expect(dialog.querySelector('[data-slot="alert-dialog-header"] [data-slot="alert-dialog-media"]')).not.toBeNull();
  expect(document.querySelector('[data-slot="alert-dialog-overlay"]')).not.toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
  expect(removeClosedSavedJobsAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Quitar las que ya no están disponibles" }));
  const invalidate = vi.spyOn(savedJobsQueryClient(identity), "invalidateQueries");
  fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Quitar vacantes" }));
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Quitaste 1 vacante" })));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: savedJobIdsKey });
  await waitFor(() => expect(card(closed.job_id)).toBeNull());
});
it("keeps a row and counts until confirmed, then removes it and offers a working undo outside the toast", async () => {
  await loaded(); let confirm!: (value: { ok: true; data: null }) => void;
  vi.mocked(removeSavedJobAction).mockImplementationOnce(() => new Promise(resolve => { confirm = value => { items = items.filter(item => item.job_id !== first.job_id); resolve(value); }; }));
  const toggle = within(card(first.job_id)).getByRole("button", { name: /Quitar .* de guardadas/ });
  fireEvent.click(toggle); fireEvent.click(toggle);
  expect(toggle).toBeDisabled(); expect(card(first.job_id)).not.toBeNull();
  expect(screen.getByText("4 guardadas · 2 por postularte")).toBeInTheDocument();
  expect(notifyActionResult).not.toHaveBeenCalled();
  await act(async () => confirm({ ok: true, data: null }));
  await waitFor(() => expect(card(first.job_id)).toBeNull());
  expect(removeSavedJobAction).toHaveBeenCalledTimes(1);
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ title: "Quitaste la vacante", action: expect.objectContaining({ title: "Deshacer" }) }));
  fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
  await waitFor(() => expect(saveJobAction).toHaveBeenCalledWith(first.job_id));
  await waitFor(() => expect(card(first.job_id)).not.toBeNull());
});
it("preserves rows and counts on mutation failure with persistent retry and sanitized error reference", async () => {
  await loaded();
  vi.mocked(removeSavedJobAction).mockResolvedValueOnce({ ok: false, reason: "server_error", reference: { status: 503 } });
  fireEvent.click(within(card(first.job_id)).getByRole("button", { name: /Quitar .* de guardadas/ }));
  await screen.findByRole("button", { name: "Reintentar" });
  expect(card(first.job_id)).not.toBeNull(); expect(screen.getByText("4 guardadas · 2 por postularte")).toBeInTheDocument();
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error", title: "El servidor tuvo un problema", reference: { status: 503, at: expect.any(String) } }));
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  await waitFor(() => expect(card(first.job_id)).toBeNull());
});
it("shows the limit notice including closed rows", async () => {
  items = Array.from({ length: 200 }, (_, i) => row(String(i), { availability: "closed" }));
  render(<SavedVacanciesWorkspace />);
  expect(await screen.findByText("Llegaste al límite de 200 vacantes guardadas. Quita alguna para guardar otra.")).toBeInTheDocument();
});
it("shows the exact actionable empty state", async () => {
  items = []; render(<SavedVacanciesWorkspace />);
  expect(await screen.findByText("Todavía no tienes vacantes guardadas")).toBeInTheDocument();
  expect(screen.getByText("Guarda las vacantes que te interesen para postularte cuando estés listo o lista.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Explorar vacantes" })).toHaveAttribute("href", "/vacantes");
});
it("keeps bulk confirmation open on failure, blocks double confirmation, and retries only after another click", async () => {
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
  expect(notifyActionResult).not.toHaveBeenCalled();
  await act(async () => reject());
  expect(dialog).toBeVisible();
  expect(card(closed.job_id)).not.toBeNull();
  expect(screen.getByText("4 guardadas · 2 por postularte")).toBeInTheDocument();
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error", title: "No hubo respuesta del servidor" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Reintentar" }));
  await waitFor(() => expect(card(closed.job_id)).toBeNull());
});
it("uses the server bulk result rather than the stale closed count and handles a zero result", async () => {
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Ya no disponibles 1" }));
  fireEvent.click(screen.getByRole("button", { name: "Quitar las que ya no están disponibles" }));
  vi.mocked(removeClosedSavedJobsAction).mockResolvedValueOnce({ ok: true, data: { removed: 0 } });
  fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Quitar vacantes" }));
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ title: "Quitaste 0 vacantes" })));
  expect(card(closed.job_id)).not.toBeNull();
});
it("keeps unknown closed dates absent and makes missing salary explicit", async () => {
  items = [row(first.job_id, { availability: "closed", job: { ...vacancyDetail, compensation: null } })];
  render(<SavedVacanciesWorkspace />);
  fireEvent.click(await screen.findByRole("button", { name: "Ya no disponibles 1" }));
  expect(screen.queryByText(/Cerró el/)).not.toBeInTheDocument();
  expect(screen.getByText("Salario no publicado")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Postularme" })).not.toBeInTheDocument();
});
it("preserves the empty state until undo is confirmed and explains a rejected re-save", async () => {
  items = [first]; render(<SavedVacanciesWorkspace />);
  const toggle = await screen.findByRole("button", { name: /Quitar .* de guardadas/ });
  fireEvent.click(toggle);
  await screen.findByText("Todavía no tienes vacantes guardadas");
  vi.mocked(saveJobAction).mockResolvedValueOnce({ ok: false, reason: "job_unavailable", reference: { status: 409, code: "job_unavailable" } });
  fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
  await screen.findByText("Esta vacante ya no está disponible");
  expect(screen.getByText("0 guardadas · 0 por postularte")).toBeInTheDocument();
  expect(card(first.job_id)).toBeNull();
});
it("reserves real card slots during initial loading", async () => {
  let finish!: () => void;
  vi.mocked(loadSavedJobsAction).mockImplementation(() => new Promise(resolve => { finish = () => resolve({ ok: true, data: data() }); }));
  const { container } = render(<SavedVacanciesWorkspace />);
  expect(screen.getByText("Cargando vacantes guardadas").closest('[aria-busy="true"]')).not.toBeNull();
  const cardSlots = (element: Element) => Array.from(element.querySelectorAll('[data-slot^="card-"]')).map(node => node.getAttribute("data-slot"));
  const sequence = cardSlots(container.querySelector('[data-pf-saved-loading]')!);
  expect(sequence).toEqual(["card-header", "card-title", "card-description", "card-action", "card-content", "card-footer"]);
  await act(async () => finish());
  await screen.findByText("4 guardadas · 2 por postularte");
  expect(cardSlots(card(first.job_id))).toEqual(sequence);
});
it("shows a load error StateCard and a read-only retry", async () => {
  vi.mocked(loadSavedJobsAction).mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} });
  render(<SavedVacanciesWorkspace />);
  expect(await screen.findByText("No pudimos cargar tus vacantes guardadas")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  await screen.findByText("4 guardadas · 2 por postularte");
  expect(removeSavedJobAction).not.toHaveBeenCalled();
});
