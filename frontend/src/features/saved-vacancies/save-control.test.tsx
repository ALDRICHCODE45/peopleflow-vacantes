import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { IdentityContext, type IdentityState } from "@/features/identity/identity-session";
import { notifyActionResult } from "@/components/feedback/notify";
import { loadSavedJobIdsAction, saveJobAction, removeSavedJobAction } from "./actions";
import { SavedJobControl } from "./save-control";
import { PublicVacancyCard } from "@/features/jobs/components/PublicVacancyCard";
import { PublicJobDetailView } from "@/features/jobs/components/PublicJobDetailView";
import { legacyDetail, listItem, vacancyDetail } from "@/features/jobs/api/public-fixtures";
vi.mock("./actions", () => ({ loadSavedJobIdsAction: vi.fn(), saveJobAction: vi.fn(), removeSavedJobAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn(), dismissActionResult: vi.fn() }));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/vacantes", useSearchParams: () => new URLSearchParams("q=Go") }));
const id = vacancyDetail.id;
const title = vacancyDetail.title;
function identity(role: "candidate" | "recruiter" = "candidate"): IdentityState {
  return { status: "ready", email: "test@example.test", retry() {}, update() {}, result: { ok: true, data: { role, user: { id, email: "test@example.test", full_name: "Prueba" } } } };
}
function mount(state = identity(), children = <SavedJobControl jobId={id} title={title} />) {
  return render(<IdentityContext.Provider value={state}>{children}</IdentityContext.Provider>);
}
const success = { ok: true as const, data: { job_id: id, saved_at: "2026-11-01T12:00:00Z" } };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadSavedJobIdsAction).mockResolvedValue({ ok: true, data: { job_ids: [] } });
  vi.mocked(saveJobAction).mockResolvedValue(success);
  vi.mocked(removeSavedJobAction).mockResolvedValue({ ok: true, data: null });
});
afterEach(cleanup);
it("shares one ids read across cards and detail, including legacy, and preserves public actions", async () => {
  vi.mocked(loadSavedJobIdsAction).mockResolvedValue({ ok: true, data: { job_ids: [id, legacyDetail.id] } });
  const { container } = mount(identity(), <><ul><PublicVacancyCard job={listItem(vacancyDetail)} /><PublicVacancyCard job={listItem(legacyDetail)} /></ul><PublicJobDetailView job={vacancyDetail} /></>);
  const buttons = await screen.findAllByRole("button", { name: `Quitar ${title} de guardadas` });
  expect(buttons).toHaveLength(2);
  expect(await screen.findByRole("button", { name: `Quitar ${legacyDetail.title} de guardadas` })).toHaveAttribute("aria-pressed", "true");
  expect(loadSavedJobIdsAction).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[data-slot="card-footer"]')?.textContent).toContain("Ver vacante");
  expect(screen.getByRole("link", { name: "Postularme" }).parentElement?.parentElement).toContainElement(buttons[1]);
  expect(buttons[1]).toHaveClass("size-12");
  expect(screen.getAllByRole("link", { name: "Ver vacante" })).toHaveLength(2);
});
it("keeps the toggle unchanged and disabled with a ring until confirmation; save, remove, undo and navigation are real", async () => {
  let finish!: (value: typeof success) => void;
  vi.mocked(saveJobAction).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  mount();
  const button = await screen.findByRole("button", { name: `Guardar ${title}` });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(button).toHaveAttribute("aria-busy", "true"));
  expect(button).toHaveAttribute("aria-pressed", "false"); expect(button).toBeDisabled();
  expect(button.querySelector(".animate-spin")).not.toBeNull();
  expect(notifyActionResult).not.toHaveBeenCalled();
  await act(async () => finish(success));
  expect(await screen.findByRole("button", { name: `Quitar ${title} de guardadas` })).toHaveAttribute("aria-pressed", "true");
  expect(notifyActionResult).toHaveBeenLastCalledWith(expect.objectContaining({ key: `saved-job:${id}`, type: "success", title: "Vacante guardada", description: "La encontrarás en Vacantes guardadas.", action: expect.objectContaining({ title: "Ver guardadas" }) }));
  act(() => vi.mocked(notifyActionResult).mock.calls.at(-1)![0].action!.onClick());
  expect(push).toHaveBeenCalledWith("/candidato/guardadas");
  expect(screen.getByRole("link", { name: "Ver guardadas" })).toHaveAttribute("href", "/candidato/guardadas");
  fireEvent.click(screen.getByRole("button", { name: `Quitar ${title} de guardadas` }));
  await waitFor(() => expect(removeSavedJobAction).toHaveBeenCalledWith(id));
  await screen.findByRole("button", { name: "Deshacer" });
  expect(notifyActionResult).toHaveBeenLastCalledWith(expect.objectContaining({ type: "success", title: "Quitaste la vacante", description: "Ya no aparece en tus vacantes guardadas.", action: expect.objectContaining({ title: "Deshacer" }) }));
  fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
  await screen.findByRole("button", { name: `Quitar ${title} de guardadas` });
  expect(saveJobAction).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("status")).toHaveTextContent("Vacante guardada");
});
it.each([
  ["saved_jobs_limit", 409, "Llegaste al límite de 200 vacantes guardadas", "Quita alguna que ya no te interese para guardar otra."],
  ["job_unavailable", 409, "Esta vacante ya no está disponible", undefined],
  ["not_found", 404, "Esta vacante ya no está disponible", undefined],
  ["validation_error", 400, "Revisa los datos marcados", undefined],
  ["unauthenticated", 401, "Tu sesión expiró", undefined],
  ["forbidden", 403, "No tienes permiso para esta acción", undefined],
  ["server_error", 503, "No se pudo guardar la vacante", "Puedes reintentar: no se duplicará."],
  ["no_response", undefined, "No se pudo guardar la vacante", "Puedes reintentar: no se duplicará."],
  ["unrecognized_response", undefined, "No pudimos confirmar el resultado", "Puedes reintentar: no se duplicará."],
] as const)("maps %s without flipping or leaking backend details", async (reason, status, message, description) => {
  vi.mocked(saveJobAction).mockResolvedValue({ ok: false, reason, reference: { status, code: reason } });
  mount();
  const button = await screen.findByRole("button", { name: `Guardar ${title}` });
  await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button);
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalled());
  expect(button).toHaveAttribute("aria-pressed", "false");
  expect(notifyActionResult).toHaveBeenLastCalledWith(expect.objectContaining({ type: "error", title: message,
    ...(description ? { description } : {}), reference: { status, code: reason, at: expect.any(String) } }));
  expect(screen.getByRole("status")).toHaveTextContent(message);
  if (["server_error", "no_response", "unrecognized_response"].includes(reason)) {
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeEnabled();
    vi.mocked(saveJobAction).mockResolvedValue(success);
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await screen.findByRole("button", { name: `Quitar ${title} de guardadas` });
  }
});
it("hides for company and loading; visitor uses the named T3 seam with current next", async () => {
  const { rerender } = mount(identity("recruiter"));
  expect(screen.queryByRole("button")).toBeNull(); expect(loadSavedJobIdsAction).not.toHaveBeenCalled();
  rerender(<IdentityContext.Provider value={{ ...identity(), status: "loading" }}><SavedJobControl jobId={id} title={title} /></IdentityContext.Provider>);
  expect(screen.queryByRole("button")).toBeNull();
  rerender(<IdentityContext.Provider value={{ ...identity(), status: "unauthenticated" }}><SavedJobControl jobId={id} title={title} /></IdentityContext.Provider>);
  fireEvent.click(screen.getByRole("button", { name: `Guardar ${title}` }));
  expect(push).toHaveBeenCalledWith("/candidato/login?next=%2Fvacantes%3Fq%3DGo");
  expect(loadSavedJobIdsAction).not.toHaveBeenCalled(); expect(saveJobAction).not.toHaveBeenCalled();
});
it("shares the busy lock and confirmed state between duplicate controls without queuing another write", async () => {
  let finish!: (value: typeof success) => void;
  vi.mocked(saveJobAction).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  mount(identity(), <><SavedJobControl jobId={id} title={title} /><SavedJobControl jobId={id} title={title} /></>);
  const buttons = await screen.findAllByRole("button", { name: `Guardar ${title}` });
  await waitFor(() => expect(buttons.every(button => !button.hasAttribute("disabled"))).toBe(true));
  fireEvent.click(buttons[0]); fireEvent.click(buttons[1]);
  await waitFor(() => buttons.forEach(button => expect(button).toHaveAttribute("aria-busy", "true")));
  expect(saveJobAction).toHaveBeenCalledTimes(1);
  await act(async () => finish(success));
  await waitFor(() => expect(screen.getAllByRole("button", { name: `Quitar ${title} de guardadas` })).toHaveLength(2));
});
it("delegates visitor intent to T3 without navigation or writes", () => {
  const onVisitorSaveT3 = vi.fn();
  mount({ ...identity(), status: "unauthenticated" }, <SavedJobControl jobId={id} title={title} onVisitorSaveT3={onVisitorSaveT3} />);
  fireEvent.click(screen.getByRole("button", { name: `Guardar ${title}` }));
  expect(onVisitorSaveT3).toHaveBeenCalledWith(id, "/vacantes?q=Go");
  expect(push).not.toHaveBeenCalled(); expect(saveJobAction).not.toHaveBeenCalled();
});
it("isolates ids on account changes and keeps company detail apply restrictions", async () => {
  const { rerender } = mount(identity(), <PublicJobDetailView job={vacancyDetail} />);
  await waitFor(() => expect(screen.getByRole("button", { name: `Guardar ${title}` })).toBeEnabled());
  rerender(<IdentityContext.Provider value={identity("recruiter")}><PublicJobDetailView job={vacancyDetail} /></IdentityContext.Provider>);
  expect(screen.queryByRole("button", { name: /Guardar/ })).toBeNull();
  expect(screen.queryByRole("link", { name: "Postularme" })).toBeNull();
  expect(screen.getByText("Las postulaciones son para cuentas de candidato")).toBeVisible();
  vi.mocked(loadSavedJobIdsAction).mockResolvedValue({ ok: true, data: { job_ids: [id] } });
  rerender(<IdentityContext.Provider value={identity()}><PublicJobDetailView job={vacancyDetail} /></IdentityContext.Provider>);
  await screen.findByRole("button", { name: `Quitar ${title} de guardadas` });
  expect(loadSavedJobIdsAction).toHaveBeenCalledTimes(2);
});
it("does not treat a failed ids read as an empty saved set; retry reads without writing", async () => {
  vi.mocked(loadSavedJobIdsAction).mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} });
  mount();
  await screen.findByRole("button", { name: "Reintentar" });
  expect(screen.getByRole("button", { name: `Guardar ${title}` })).toBeDisabled();
  expect(notifyActionResult).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  await waitFor(() => expect(screen.getByRole("button", { name: `Guardar ${title}` })).toBeEnabled());
  expect(saveJobAction).not.toHaveBeenCalled();
});
