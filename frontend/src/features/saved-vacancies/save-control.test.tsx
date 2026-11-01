import { StrictMode } from "react";
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
// Mirror psychometrics/profile/help.test.tsx: real timers, fireEvent, no
// custom portal container. Only replace the anchored popup shell (which loops
// in jsdom even with collision work disabled). Root/Trigger/Title stay real.
// Escape, outside click and focus return remain native Base UI browser checks.
vi.mock("@/components/ui/popover", async importOriginal => ({
  ...await importOriginal<typeof import("@/components/ui/popover")>(),
  PopoverContent: ({ children, ...props }: { children?: import("react").ReactNode; "data-visitor-save"?: string }) =>
    props["data-visitor-save"] !== undefined && children
      ? <div role="dialog" aria-label="Guarda vacantes para verlas después" data-slot="popover-content">{children}</div> : null,
}));
vi.mock("./actions", () => ({ loadSavedJobIdsAction: vi.fn(), saveJobAction: vi.fn(), removeSavedJobAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn(), dismissActionResult: vi.fn() }));
const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }), usePathname: () => window.location.pathname, useSearchParams: () => new URLSearchParams(window.location.search) }));
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
  vi.resetAllMocks();
  window.history.replaceState(null, "", "/vacantes?q=Go");
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("innerWidth", 1280);
  vi.mocked(loadSavedJobIdsAction).mockResolvedValue({ ok: true, data: { job_ids: [] } });
  vi.mocked(saveJobAction).mockResolvedValue(success);
  vi.mocked(removeSavedJobAction).mockResolvedValue({ ok: true, data: null });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it.each(["card", "detail"] as const)("visitor %s popover has auth links, official composition and a toggling trigger", async placement => {
  window.history.replaceState(null, "", "/vacantes?q=Go&guardar=old&guardar=older");
  mount({ ...identity(), status: "unauthenticated" }, <SavedJobControl jobId={id} title={title} placement={placement} />);
  const trigger = screen.getByRole("button", { name: `Guardar ${title}` });
  trigger.focus(); fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "Guarda vacantes para verlas después" });
  expect(dialog).toHaveTextContent("Crea una cuenta o inicia sesión. Volverás a esta misma página y la vacante quedará guardada.");
  expect(dialog.querySelector('[data-slot="popover-header"] [data-slot="popover-title"]')).not.toBeNull();
  for (const [label, route] of [["Crear cuenta", "ingresar"], ["Iniciar sesión", "login"]]) {
    const href = screen.getByRole("link", { name: label }).getAttribute("href")!;
    expect(href.split("?")[0]).toBe(`/candidato/${route}`);
    expect(new URL(href, window.location.origin).searchParams.get("next")).toBe(`/vacantes?q=Go&guardar=${id}`);
  }
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
  fireEvent.click(trigger);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(saveJobAction).not.toHaveBeenCalled(); expect(loadSavedJobIdsAction).not.toHaveBeenCalled();
});
it("consumes one return intent across controls, rerenders, StrictMode and refresh, saving even an off-page job", async () => {
  window.history.replaceState(null, "", `/vacantes?q=Go&guardar=${id}#resultados`);
  let finish!: (value: typeof success) => void;
  vi.mocked(saveJobAction).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const state = identity();
  const controls = <StrictMode><SavedJobControl jobId={legacyDetail.id} title="Otra" /><SavedJobControl jobId={id} title={title} /></StrictMode>;
  const view = mount({ ...state, status: "loading" }, controls);
  expect(replace).not.toHaveBeenCalled(); expect(saveJobAction).not.toHaveBeenCalled();
  view.rerender(<IdentityContext.Provider value={state}>{controls}</IdentityContext.Provider>);
  await waitFor(() => expect(saveJobAction).toHaveBeenCalledTimes(1));
  expect(saveJobAction).toHaveBeenCalledWith(id);
  expect(replace).not.toHaveBeenCalled();
  expect(new URLSearchParams(window.location.search).get("guardar")).toBe(id);
  // A refresh while the request is pending must still carry a replayable intent.
  view.rerender(<IdentityContext.Provider value={state}>{controls}</IdentityContext.Provider>);
  expect(saveJobAction).toHaveBeenCalledTimes(1);
  expect(notifyActionResult).not.toHaveBeenCalled();
  await act(async () => finish(success));
  expect(replace).toHaveBeenCalledTimes(1);
  expect(replace).toHaveBeenCalledWith("/vacantes?q=Go#resultados", { scroll: false });
  expect(window.location.search).toBe("?q=Go");
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Vacante guardada" })));
  expect(notifyActionResult).toHaveBeenCalledTimes(1);
  view.unmount(); mount(state, controls);
  await act(async () => {});
  expect(saveJobAction).toHaveBeenCalledTimes(1);
});
it.each(["visitor", "company", "malformed"])("clears %s intent without saving", async kind => {
  window.history.replaceState(null, "", `/vacantes?q=Go&guardar=${kind === "malformed" ? "bad-id" : id}`);
  mount(kind === "visitor" ? { ...identity(), status: "unauthenticated" } : identity(kind === "company" ? "recruiter" : "candidate"));
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/vacantes?q=Go", { scroll: false }));
  expect(saveJobAction).not.toHaveBeenCalled(); expect(notifyActionResult).not.toHaveBeenCalled();
});
it.each([
  ["job_unavailable", "Esta vacante ya no está disponible"],
  ["saved_jobs_limit", "Llegaste al límite de 200 vacantes guardadas"],
  ["no_response", "No se pudo guardar la vacante"],
] as const)("return intent reports %s once through normal feedback", async (reason, message) => {
  window.history.replaceState(null, "", `/vacantes?guardar=${id}`);
  vi.mocked(saveJobAction).mockResolvedValue({ ok: false, reason, reference: { status: 409, code: reason } });
  mount();
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error", title: message, reference: { status: 409, code: reason, at: expect.any(String) } })));
  expect(screen.getByRole("status")).toHaveTextContent(message);
  expect(saveJobAction).toHaveBeenCalledTimes(1);
  expect(window.location.search).toBe("");
  if (reason === "no_response") {
    vi.mocked(saveJobAction).mockResolvedValue(success);
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(saveJobAction).toHaveBeenCalledTimes(2));
  }
});
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
  expect(await screen.findByRole("dialog", { name: "Guarda vacantes para verlas después" })).toBeVisible();
  expect(push).not.toHaveBeenCalled();
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
