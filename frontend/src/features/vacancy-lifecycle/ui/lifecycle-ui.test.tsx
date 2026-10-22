import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { notifyActionResult } from "@/components/feedback/notify";
import { LifecycleActionDialog } from "./lifecycle-action-dialog";
import { getLifecycleAction, transitionLifecycleAction } from "../actions";
import type { Lifecycle } from "../model";
vi.mock("../actions", () => ({ getLifecycleAction: vi.fn(), transitionLifecycleAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
const view: Lifecycle = { close_reason: null, close_reason_note: null, publication: "published", process: "active", version: "1", published_at: null, paused_at: null, closed_at: null, process_finished_at: null, allowed_actions: ["pause", "close"] };
const snapshot = { ok: true as const, data: view, etag: '"vl-id-v1"' };
const changed = vi.fn();
function mount(action: "close" | "pause" | "reopen" | "resume" | "finish_process" = "close") { return render(<LifecycleActionDialog draftId="id" title="Analista" action={action} snapshot={{ ...snapshot, data: { ...view, allowed_actions: [action] } }} open onOpenChange={vi.fn()} onChanged={changed} />); }
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))); vi.mocked(getLifecycleAction).mockResolvedValue(snapshot); vi.mocked(transitionLifecycleAction).mockResolvedValue({ ...snapshot, data: { ...view, publication: "closed" } }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it.each([
 ["pause", "Pausar", "Vacante pausada"],
 ["resume", "Reanudar", "Vacante reanudada"],
 ["close", "Cerrar vacante", "Vacante cerrada"],
 ["finish_process", "Finalizar proceso", "Proceso finalizado"],
 ["reopen", "Reabrir", "Vacante reabierta"],
] as const)("announces the result of %s", async (action, button, title) => {
 mount(action);
 if (action === "close") fireEvent.click(screen.getByRole("button", { name: "Cancelada" }));
 fireEvent.click(screen.getByRole("button", { name: button }));
 await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title })));
});
it("requires a reason and focuses the first invalid field", () => {
 mount(); fireEvent.click(screen.getByRole("button", { name: "Cerrar vacante" }));
 expect(transitionLifecycleAction).not.toHaveBeenCalled();
 expect(screen.getByText("Elige un motivo de cierre.")).toHaveAttribute("data-slot", "field-error");
 expect(screen.getByRole("button", { name: "Cubierta" })).toHaveFocus();
});
it.each([["Cubierta", "filled"], ["Cancelada", "cancelled"], ["Otro", "other"]] as const)("sends reason %s", async (label, reason) => {
 mount(); fireEvent.click(screen.getByRole("button", { name: label }));
 if (reason === "other") fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "  Cambio de planes  " } });
 fireEvent.click(screen.getByRole("button", { name: "Cerrar vacante" }));
 await waitFor(() => expect(transitionLifecycleAction).toHaveBeenCalledWith(expect.objectContaining({ body: { process: "continue", reason, reason_note: reason === "other" ? "Cambio de planes" : null } })));
});
it.each(["   ", "a".repeat(201)])("rejects invalid other note", note => {
 mount(); fireEvent.click(screen.getByRole("button", { name: "Otro" }));
 const input = screen.getByLabelText("Motivo"); fireEvent.change(input, { target: { value: note } });
 fireEvent.click(screen.getByRole("button", { name: "Cerrar vacante" }));
 expect(transitionLifecycleAction).not.toHaveBeenCalled(); expect(input).toHaveFocus(); expect(input).toHaveAttribute("aria-invalid", "true");
});
it.each([2, null])("disables filled with insufficient target %s", required => {
 render(<LifecycleActionDialog draftId="id" title="Analista" action="close" coverage={{ covered: 1, required }} snapshot={snapshot} open onOpenChange={vi.fn()} onChanged={changed} />);
 expect(screen.getByRole("button", { name: "Cubierta" })).toBeDisabled();
 expect(screen.getByText(required === null ? "Esta vacante no tiene un objetivo de posiciones." : "Hay 1 de 2 posiciones cubiertas.")).toBeVisible();
});
it("keeps the form and refreshes lifecycle after coverage rejection", async () => {
 vi.mocked(transitionLifecycleAction).mockResolvedValue({ ok: false, reason: "close_reason_not_covered", reload: true, coverage: { covered: 1, required: 2 }, message: "Hay 1 de 2 posiciones cubiertas.", reference: { status: 422 } });
 mount(); fireEvent.click(screen.getByRole("button", { name: "Cubierta" })); fireEvent.click(screen.getByRole("button", { name: "Cerrar vacante" }));
 await waitFor(() => expect(getLifecycleAction).toHaveBeenCalledWith("id"));
 expect(screen.getByRole("alertdialog")).toBeVisible(); expect(screen.getByText("Hay 1 de 2 posiciones cubiertas.")).toBeVisible();
 expect(screen.getByRole("button", { name: "Cubierta" })).toBeDisabled(); expect(transitionLifecycleAction).toHaveBeenCalledTimes(1);

 // The explanation sits in the dialog; a toast would repeat it (and land under the backdrop).
 expect(notifyActionResult).not.toHaveBeenCalled();
 // Only the error text is red: the remaining choices keep their normal look.
 expect(screen.getByRole("button", { name: "Cancelada" }).closest("[data-invalid]")).toBeNull();
});
it("counts trimmed Unicode notes and clears them from non-other bodies", async () => {
 mount(); fireEvent.click(screen.getByRole("button", { name: "Otro" }));
 fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: `  ${"😀".repeat(200)}  ` } });
 expect(screen.getByText("200 / 200 caracteres")).toBeVisible();
 fireEvent.click(screen.getByRole("button", { name: "Cancelada" }));
 expect(screen.queryByLabelText("Motivo")).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button", { name: "Cerrar vacante" }));
 await waitFor(() => expect(transitionLifecycleAction).toHaveBeenCalledWith(expect.objectContaining({ body: { process: "continue", reason: "cancelled", reason_note: null } })));
});
it("uses a fresh intent only after the user corrects a rejected reason", async () => {
 vi.mocked(transitionLifecycleAction).mockResolvedValueOnce({ ok: false, reason: "close_reason_not_covered", reload: true, coverage: { covered: 1, required: 2 }, message: "Hay 1 de 2 posiciones cubiertas.", reference: { status: 422 } });
 vi.mocked(getLifecycleAction).mockResolvedValue({ ...snapshot, etag: "fresh-tag" });
 mount(); fireEvent.click(screen.getByRole("button", { name: "Cubierta" })); fireEvent.click(screen.getByRole("button", { name: "Cerrar vacante" }));
 await waitFor(() => expect(screen.getByRole("button", { name: "Cancelada" })).toBeEnabled());
 expect(transitionLifecycleAction).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole("button", { name: "Cancelada" })); fireEvent.click(screen.getByRole("button", { name: "Cerrar vacante" }));
 await waitFor(() => expect(transitionLifecycleAction).toHaveBeenCalledTimes(2));
 const calls = vi.mocked(transitionLifecycleAction).mock.calls;
 expect(calls[1][0]).toMatchObject({ ifMatch: "fresh-tag", body: { process: "continue", reason: "cancelled", reason_note: null } });
 expect(calls[1][0].idempotencyKey).not.toBe(calls[0][0].idempotencyKey);
});
it("uses an archive icon for close", () => {
 mount();
 expect(screen.getByRole("alertdialog").querySelector(".lucide-archive")).not.toBeNull();
});
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
 fireEvent.click(screen.getByRole("button", { name: "Cancelada" }));
 if (process === "finish") fireEvent.click(screen.getByRole("button", { name: "Finalizar el proceso" }));
 fireEvent.click(screen.getByRole("button", { name: "Cerrar vacante" }));
 await waitFor(() => expect(transitionLifecycleAction).toHaveBeenCalledWith(expect.objectContaining({ action: "close", body: { process, reason: "cancelled", reason_note: null }, ifMatch: snapshot.etag, idempotencyKey: expect.any(String) })));
 expect(changed).toHaveBeenCalled();
 expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ title: "Vacante cerrada", description: process === "finish" ? "El proceso finalizó y el tablero quedó en solo lectura." : "El proceso continúa y el tablero sigue funcionando." }));
});
it.each(["pause", "close"] as const)("checks an uncertain %s and replays the exact intent with the same key", async action => {
 vi.mocked(transitionLifecycleAction).mockResolvedValueOnce({ ok: false, reason: "no_response", uncertain: true, message: "Resultado incierto", reference: {} });
 mount(action);
 if (action === "close") { fireEvent.click(screen.getByRole("button", { name: "Cancelada" })); fireEvent.click(screen.getByRole("button", { name: "Finalizar el proceso" })); }
 fireEvent.click(screen.getByRole("button", { name: action === "close" ? "Cerrar vacante" : "Pausar" }));
 const check = await screen.findByRole("button", { name: "Comprobar" });
 expect(transitionLifecycleAction).toHaveBeenCalledTimes(1);
 fireEvent.click(check);
 fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
 await waitFor(() => expect(transitionLifecycleAction).toHaveBeenCalledTimes(2));
 expect(vi.mocked(transitionLifecycleAction).mock.calls[1]).toEqual(vi.mocked(transitionLifecycleAction).mock.calls[0]);
});
it("names the vacancy naturally when finishing its process", () => {
 mount("finish_process");
 expect(screen.getByRole("heading", { name: "¿Finalizar el proceso de Analista?" })).toBeVisible();
});
it.each(["resume", "reopen"] as const)("offers Volver after %s publication missing", async action => {
 vi.mocked(transitionLifecycleAction).mockResolvedValue({ ok: false, reason: "publication_incomplete", missing: ["title_missing"], message: "Te falta para publicar", reference: { status: 422 } });
 mount(action); fireEvent.click(screen.getByRole("button", { name: action === "resume" ? "Reanudar" : "Reabrir" }));
 await screen.findByRole("heading", { name: "Te falta para publicar" });
 expect(screen.getByRole("button", { name: "Volver" })).toBeVisible();
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

it("marks the chosen close option visibly and left-aligns both options (seen in Chromium dark mode)", () => {
  mount();
  const keep = screen.getByRole("button", { name: "Seguir con el proceso" });
  const finish = screen.getByRole("button", { name: "Finalizar el proceso" });
  for (const option of [keep, finish]) expect(option).toHaveClass("text-left");
  expect(keep.querySelector('[data-pf-close-choice-check]')).not.toBeNull();
  expect(finish.querySelector('[data-pf-close-choice-check]')).toBeNull();
  fireEvent.click(finish);
  expect(finish.querySelector('[data-pf-close-choice-check]')).not.toBeNull();
  expect(keep.querySelector('[data-pf-close-choice-check]')).toBeNull();
});
it("marks the chosen close reason with the primary accent, readable in dark mode too", () => {
 mount(); const other = screen.getByRole("button", { name: "Otro" });
 expect(other.className).toContain("aria-pressed:border-primary");
 expect(other.className).toContain("aria-pressed:bg-primary/10");
 // §13.1: primary text on a dark primary tint is hard to read; the label keeps the foreground color.
 expect(other.className).toContain("aria-pressed:text-foreground");
});
