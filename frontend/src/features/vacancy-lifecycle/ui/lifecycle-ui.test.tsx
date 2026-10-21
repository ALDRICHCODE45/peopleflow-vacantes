import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { LifecycleActionDialog } from "./lifecycle-action-dialog";
import { getLifecycleAction, transitionLifecycleAction } from "../actions";
import type { Lifecycle } from "../model";
vi.mock("../actions", () => ({ getLifecycleAction: vi.fn(), transitionLifecycleAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
const view: Lifecycle = { publication: "published", process: "active", version: "1", published_at: null, paused_at: null, closed_at: null, process_finished_at: null, allowed_actions: ["pause", "close"] };
const snapshot = { ok: true as const, data: view, etag: '"vl-id-v1"' };
const changed = vi.fn();
function mount(action: "close" | "pause" | "reopen" = "close") { return render(<LifecycleActionDialog draftId="id" title="Analista" action={action} snapshot={{ ...snapshot, data: { ...view, allowed_actions: [action] } }} open onOpenChange={vi.fn()} onChanged={changed} />); }
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))); vi.mocked(getLifecycleAction).mockResolvedValue(snapshot); vi.mocked(transitionLifecycleAction).mockResolvedValue({ ...snapshot, data: { ...view, publication: "closed" } }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it.each([412, 428])("reloads on %s without another write", async status => {
 vi.mocked(transitionLifecycleAction).mockResolvedValue({ ok: false, reason: "version_conflict", reload: true, message: "Recarga el estado", reference: { status } });
 mount("pause"); fireEvent.click(screen.getByRole("button", { name: "Pausar" }));
 await waitFor(() => expect(getLifecycleAction).toHaveBeenCalledWith("id"));
 expect(changed).toHaveBeenCalledWith(view); expect(transitionLifecycleAction).toHaveBeenCalledTimes(1);
});
it("does not replay after checking a changed lifecycle", async () => {
 vi.mocked(transitionLifecycleAction).mockResolvedValue({ ok: false, reason: "no_response", uncertain: true, message: "Resultado incierto", reference: {} });
 vi.mocked(getLifecycleAction).mockResolvedValue({ ...snapshot, etag: "new-etag", data: { ...view, publication: "paused", allowed_actions: ["resume"] } });
 mount("pause"); fireEvent.click(screen.getByRole("button", { name: "Pausar" })); fireEvent.click(await screen.findByRole("button", { name: "Comprobar" }));
 expect(await screen.findByText("Estado actualizado. Revisa las acciones disponibles.")).toBeVisible();
 expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument(); expect(transitionLifecycleAction).toHaveBeenCalledTimes(1);
});
it("ignores empty close choice and cancellation never writes", () => {
 mount(); const choice = screen.getByRole("button", { name: "Seguir con el proceso" }); fireEvent.click(choice);
 expect(choice).toHaveAttribute("aria-pressed", "true"); fireEvent.click(screen.getByRole("button", { name: "Cancelar" })); expect(transitionLifecycleAction).not.toHaveBeenCalled();
});
it.each(["continue", "finish"] as const)("confirms close with %s process choice", async process => {
 mount();
 expect(screen.getByRole("button", { name: "Seguir con el proceso" })).toHaveAttribute("aria-pressed", "true");
 if (process === "finish") fireEvent.click(screen.getByRole("button", { name: "Finalizar el proceso" }));
 fireEvent.click(screen.getByRole("button", { name: "Cerrar vacante" }));
 await waitFor(() => expect(transitionLifecycleAction).toHaveBeenCalledWith(expect.objectContaining({ action: "close", body: { process }, ifMatch: snapshot.etag, idempotencyKey: expect.any(String) })));
 expect(changed).toHaveBeenCalled();
});
it.each(["pause", "close"] as const)("checks an uncertain %s and replays the exact intent with the same key", async action => {
 vi.mocked(transitionLifecycleAction).mockResolvedValueOnce({ ok: false, reason: "no_response", uncertain: true, message: "Resultado incierto", reference: {} });
 mount(action);
 if (action === "close") fireEvent.click(screen.getByRole("button", { name: "Finalizar el proceso" }));
 fireEvent.click(screen.getByRole("button", { name: action === "close" ? "Cerrar vacante" : "Pausar" }));
 const check = await screen.findByRole("button", { name: "Comprobar" });
 expect(transitionLifecycleAction).toHaveBeenCalledTimes(1);
 fireEvent.click(check);
 fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
 await waitFor(() => expect(transitionLifecycleAction).toHaveBeenCalledTimes(2));
 expect(vi.mocked(transitionLifecycleAction).mock.calls[1]).toEqual(vi.mocked(transitionLifecycleAction).mock.calls[0]);
});
it("shows publication missing labels", async () => {
 vi.mocked(transitionLifecycleAction).mockResolvedValue({ ok: false, reason: "publication_incomplete", missing: ["title_missing", "delivery_target_missing"], message: "Te falta para publicar", reference: { status: 422 } });
 mount("reopen"); fireEvent.click(screen.getByRole("button", { name: "Reabrir" }));
 expect(await screen.findByRole("heading", { name: "Te falta para publicar" })).toBeVisible();
 expect(screen.getByText("Título", { selector: '[data-slot="item-title"]' })).toBeVisible(); expect(screen.getByText("Objetivo de entrega", { selector: '[data-slot="item-title"]' })).toBeVisible();
});
it("refreshes the parent on a 409 without retrying", async () => {
 const lifecycle = { ...view, publication: "paused" as const, allowed_actions: ["resume" as const] };
 vi.mocked(transitionLifecycleAction).mockResolvedValue({ ok: false, reason: "lifecycle_transition_invalid", message: "El estado cambió", lifecycle, reference: { status: 409 } });
 mount("pause"); fireEvent.click(screen.getByRole("button", { name: "Pausar" }));
 await waitFor(() => expect(changed).toHaveBeenCalledWith(lifecycle));
 expect(await screen.findByText("El estado cambió")).toBeVisible(); expect(transitionLifecycleAction).toHaveBeenCalledTimes(1);
});
