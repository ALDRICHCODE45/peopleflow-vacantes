import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { loadDraftDeliveryAction, saveDraftDeliveryAction, previewDraftDeliveryAction, loadDeliveryStatusAction, renegotiateDraftCommitmentAction, type DraftDeliveryActionResult } from "@/features/jobs/drafts/pipeline/delivery-actions";
import { notifyActionResult } from "@/components/feedback/notify";
import { DeliveryEditor } from "./editor";
import { deliveryFixture } from "./test-fixture";
import { pipelineFixture } from "../stage-config/test-fixture";
vi.mock("@/features/jobs/drafts/pipeline/delivery-actions", () => ({ loadDraftDeliveryAction: vi.fn(), saveDraftDeliveryAction: vi.fn(), previewDraftDeliveryAction: vi.fn(), loadDeliveryStatusAction: vi.fn(), renegotiateDraftCommitmentAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
// Calendar focus management inside AlertDialog also loops in jsdom. The draft
// tests below retain the real Calendar; the new dialog uses a controlled day probe.
vi.mock("@/components/ui/calendar", async importOriginal => {
  const actual = await importOriginal<typeof import("@/components/ui/calendar")>();
  return { ...actual, Calendar: (props: React.ComponentProps<typeof actual.Calendar>) => {
    if (!document.querySelector('[role="alertdialog"]')) return <actual.Calendar {...props} />;
    const day = new Date(2026, 9, 19);
    return <div data-slot="calendar"><button data-day="19/10/2026" onClick={() => { if (props.mode === "single") props.onSelect?.(day, day, {}, {} as React.MouseEvent); }}>19</button></div>;
  } };
});
// Base UI portal focus restoration loops in jsdom (same boundary as the installed
// DatePickerField tests). Keep the real Calendar, replace only popup boundaries.
vi.mock("@/components/ui/popover", () => {
  const Context = React.createContext<{ open: boolean; change: (value: boolean) => void }>({ open: false, change: () => {} });
  return {
    Popover: ({ open, onOpenChange, children }: { open: boolean; onOpenChange: (value: boolean) => void; children: React.ReactNode }) => <Context.Provider value={{ open, change: onOpenChange }}>{children}</Context.Provider>,
    PopoverTrigger: ({ render }: { render: React.ReactElement<{ onClick?: () => void }> }) => { const context = React.useContext(Context); return React.cloneElement(render, { onClick: () => context.change(true) }); },
    PopoverContent: ({ children }: { children: React.ReactNode }) => React.useContext(Context).open ? <div role="dialog">{children}</div> : null,
  };
});
vi.mock("@/components/ui/select", () => {
  type Value = { value: string; items: { value: string; label: string }[]; change: (value: string) => void };
  const Context = React.createContext<Value>({ value: "", items: [], change: () => {} });
  return {
    Select: ({ value, items, onValueChange, children }: Value & { onValueChange: Value["change"]; children: React.ReactNode }) => <Context.Provider value={{ value, items, change: onValueChange }}>{children}</Context.Provider>,
    SelectTrigger: ({ children, ...props }: React.ComponentProps<"button">) => <button role="combobox" aria-expanded="true" aria-controls="cutoff-options-probe" {...props}>{children}</button>,
    SelectValue: () => { const context = React.useContext(Context); return context.items.find(item => item.value === context.value)?.label; },
    SelectContent: ({ children }: { children: React.ReactNode }) => <div role="listbox" id="cutoff-options-probe">{children}</div>,
    SelectGroup: ({ children }: { children: React.ReactNode }) => <div role="group">{children}</div>,
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => { const context = React.useContext(Context); return <button role="option" aria-selected={context.value === value} onClick={() => context.change(value)}>{children}</button>; },
  };
});
const published = { publication: "published" as const, process: "active" as const, version: "1", published_at: "2026-10-16T12:00:00Z", paused_at: null, closed_at: null, close_reason: null, close_reason_note: null, process_finished_at: null, allowed_actions: [] };
function publishedMount() { return render(<DeliveryEditor draftId={draftId} delivery={{ ...deliveryFixture(), commitmentDate: "2026-11-30" }} etag='"delivery-0"' stages={pipelineFixture().stages} lifecycle={published} />); }
async function openRenegotiation() {
  fireEvent.click(screen.getByRole("button", { name: "Renegociar fecha" }));
  return screen.findByRole("alertdialog", { name: "Renegociar la fecha compromiso" });
}
async function chooseNewDate() {
  fireEvent.click(screen.getByRole("button", { name: "Nueva fecha compromiso" }));
  fireEvent.click(document.querySelector('[data-slot="calendar"] button[data-day="19/10/2026"]')!);
}
it("published commitment is read-only next to an outline renegotiation, PUT preserves the current date", async () => {
  publishedMount();
  expect(screen.queryByRole("button", { name: "Fecha compromiso" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Renegociar fecha" })).toHaveClass("border-border");
  expect(screen.queryByRole("button", { name: "Quitar fecha" })).not.toBeInTheDocument();
  expect(screen.getByText("30 de noviembre de 2026")).toBeVisible();
  edit(); fireEvent.click(save());
  await waitFor(() => expect(saveDraftDeliveryAction).toHaveBeenCalledExactlyOnceWith({ draftId, ifMatch: '"delivery-0"', body: { cutoffStageId: null, targetQuantity: 5, commitmentDate: "2026-11-30" } }));
  expect(previewDraftDeliveryAction).toHaveBeenCalledExactlyOnceWith({ draftId, body: { cutoffStageId: null, targetQuantity: 5, commitmentDate: "2026-11-30" } });
});
it("draft keeps direct date editing and has no renegotiation action", () => {
  mount(); expect(screen.getByRole("button", { name: "Fecha compromiso" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Renegociar fecha" })).not.toBeInTheDocument();
});
it("opens one commitment confirmation with the approved anatomy", async () => {
  publishedMount(); const dialog = await openRenegotiation();
  expect(dialog).toHaveTextContent("Fecha actual: 30 de noviembre de 2026");
  expect(dialog.querySelector('[data-slot="alert-dialog-header"] [data-slot="alert-dialog-media"]')).not.toBeNull();
  expect(dialog.querySelector('[data-slot="confirm-action-details"]')).not.toBeNull();
  expect(within(dialog).getByRole("button", { name: "Renegociar" })).toBeDisabled();
});
it("one approved dialog validates date, reason and Otro note before POST; cancel does not write", async () => {
  publishedMount(); const dialog = await openRenegotiation();
  expect(dialog).toHaveTextContent("Fecha actual: 30 de noviembre de 2026");
  expect(dialog).toHaveTextContent("El cambio queda en los movimientos de la vacante.");
  expect(document.querySelector('[data-slot="alert-dialog-overlay"]')).not.toBeNull();
  const confirm = within(dialog).getByRole("button", { name: "Renegociar" }); expect(confirm).toBeDisabled();
  await chooseNewDate(); expect(confirm).toBeDisabled(); fireEvent.click(screen.getByRole("option", { name: "Otro" })); expect(confirm).toBeEnabled();
  fireEvent.click(confirm);
  const note = screen.getByRole("textbox", { name: "Nota" }); expect(note).toBeRequired(); expect(note).toHaveAttribute("aria-invalid", "true"); expect(note).toHaveFocus();
  expect(renegotiateDraftCommitmentAction).not.toHaveBeenCalled();
  fireEvent.change(note, { target: { value: "x".repeat(501) } }); fireEvent.click(confirm); expect(renegotiateDraftCommitmentAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" })); expect(renegotiateDraftCommitmentAction).not.toHaveBeenCalled();
});
it("renegotiation adopts new date and ETag while preserving unsaved delivery edits", async () => {
  vi.mocked(renegotiateDraftCommitmentAction).mockResolvedValue({ ok: true, delivery: { ...deliveryFixture(), commitmentDate: "2026-10-19", version: "1" }, etag: '"renegotiated"' });
  publishedMount(); edit("7"); await openRenegotiation(); await chooseNewDate(); fireEvent.click(screen.getByRole("option", { name: "Pedido del cliente" })); fireEvent.click(screen.getByRole("button", { name: "Renegociar" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  expect(screen.getByText("19 de octubre de 2026")).toBeVisible(); expect(target()).toHaveValue("7");
  const input = vi.mocked(renegotiateDraftCommitmentAction).mock.calls[0][0];
  expect(input).toMatchObject({ draftId, ifMatch: '"delivery-0"', body: { commitment_date: "2026-10-19", reason: "client_request" } }); expect(input.idempotencyKey).toMatch(/^[\da-f-]{36}$/i);
  fireEvent.click(save()); await waitFor(() => expect(saveDraftDeliveryAction).toHaveBeenCalledWith(expect.objectContaining({ ifMatch: '"renegotiated"', body: { cutoffStageId: null, targetQuantity: 7, commitmentDate: "2026-10-19" } })));
});
it.each(["commitment_unchanged", "commitment_note_required", "version_conflict"] as const)("keeps dialog data on %s with Spanish feedback", async reason => {
  vi.mocked(renegotiateDraftCommitmentAction).mockResolvedValue({ ok: false, reason, reference: { status: reason === "commitment_note_required" ? 422 : reason === "version_conflict" ? 412 : 409 } } as DraftDeliveryActionResult);
  publishedMount(); await openRenegotiation(); await chooseNewDate(); fireEvent.click(screen.getByRole("option", { name: "Otro" })); fireEvent.change(screen.getByRole("textbox", { name: "Nota" }), { target: { value: "Cambio acordado" } }); fireEvent.click(screen.getByRole("button", { name: "Renegociar" }));
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalled());
  expect(screen.getByRole("alertdialog")).toBeVisible(); expect(screen.getByRole("textbox", { name: "Nota" })).toHaveValue("Cambio acordado");
  if (reason === "commitment_unchanged") expect(screen.getByText("Elige una fecha distinta a la actual.")).toHaveAttribute("data-slot", "field-error");
  if (reason === "commitment_note_required") { expect(screen.getByRole("textbox", { name: "Nota" })).toHaveAttribute("aria-invalid", "true"); expect(screen.getByRole("textbox", { name: "Nota" })).toHaveFocus(); }
  if (reason === "version_conflict") expect(screen.getByRole("button", { name: "Cargar versión actual" })).toBeEnabled();
  expect(loadDraftDeliveryAction).not.toHaveBeenCalled(); expect(renegotiateDraftCommitmentAction).toHaveBeenCalledTimes(1);
});
it("retries the exact uncertain attempt with the same UUID and freezes its fields", async () => {
  vi.mocked(renegotiateDraftCommitmentAction).mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} }).mockResolvedValue({ ok: true, delivery: { ...deliveryFixture(), commitmentDate: "2026-10-19", version: "1" }, etag: '"next"' });
  publishedMount(); await openRenegotiation(); await chooseNewDate(); fireEvent.click(screen.getByRole("option", { name: "Cambio de alcance" })); fireEvent.click(screen.getByRole("button", { name: "Renegociar" }));
  fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
  await waitFor(() => expect(renegotiateDraftCommitmentAction).toHaveBeenCalledTimes(2));
  expect(vi.mocked(renegotiateDraftCommitmentAction).mock.calls[1][0]).toEqual(vi.mocked(renegotiateDraftCommitmentAction).mock.calls[0][0]);
});
it("a PUT publication race tells the user to renegotiate and removes direct date editing", async () => {
  vi.mocked(saveDraftDeliveryAction).mockResolvedValue({ ok: false, reason: "commitment_change_requires_renegotiation", reference: { status: 409, code: "commitment_change_requires_renegotiation" } });
  mount({ ...deliveryFixture(), commitmentDate: "2026-10-16" }); edit("8"); fireEvent.click(save());
  expect(await screen.findByRole("button", { name: "Renegociar fecha" })).toBeEnabled();
  expect(screen.getByRole("status")).toHaveTextContent("No se guardó · usa «Renegociar fecha»");
  expect(screen.queryByRole("button", { name: "Fecha compromiso" })).not.toBeInTheDocument(); expect(target()).toHaveValue("8");
  expect(saveDraftDeliveryAction).toHaveBeenCalledTimes(1); expect(loadDraftDeliveryAction).not.toHaveBeenCalled();
});
it("412 reloads only on demand and a new confirmation uses a fresh UUID and delivery ETag", async () => {
  vi.mocked(renegotiateDraftCommitmentAction).mockResolvedValueOnce({ ok: false, reason: "version_conflict", reference: { status: 412, code: "version_conflict" } }).mockResolvedValue({ ok: true, delivery: { ...deliveryFixture(), commitmentDate: "2026-10-19", version: "3" }, etag: '"final"' });
  vi.mocked(loadDraftDeliveryAction).mockResolvedValue({ ok: true, delivery: { ...deliveryFixture(), commitmentDate: "2026-10-20", version: "2" }, etag: '"reloaded"' });
  publishedMount(); await openRenegotiation(); await chooseNewDate(); fireEvent.click(screen.getByRole("option", { name: "Retraso interno" })); fireEvent.click(screen.getByRole("button", { name: "Renegociar" }));
  const reload = await screen.findByRole("button", { name: "Cargar versión actual" }); expect(loadDraftDeliveryAction).not.toHaveBeenCalled(); expect(screen.getByRole("button", { name: "Renegociar" })).toBeDisabled();
  fireEvent.click(reload); await waitFor(() => expect(screen.getByRole("button", { name: "Renegociar" })).toBeEnabled());
  expect(screen.getByText("Fecha actual: 20 de octubre de 2026")).toBeVisible(); fireEvent.click(screen.getByRole("button", { name: "Renegociar" }));
  await waitFor(() => expect(renegotiateDraftCommitmentAction).toHaveBeenCalledTimes(2));
  const [first, second] = vi.mocked(renegotiateDraftCommitmentAction).mock.calls.map(call => call[0]);
  expect(second.ifMatch).toBe('"reloaded"'); expect(second.idempotencyKey).not.toBe(first.idempotencyKey); expect(second.body).toEqual(first.body);
});
it("pending commitment blocks duplicate POSTs and cancellation", async () => {
  let resolve!: (value: DraftDeliveryActionResult) => void; vi.mocked(renegotiateDraftCommitmentAction).mockReturnValue(new Promise(yes => { resolve = yes; }));
  publishedMount(); await openRenegotiation(); await chooseNewDate(); fireEvent.click(screen.getByRole("option", { name: "Otro" })); fireEvent.change(screen.getByRole("textbox", { name: "Nota" }), { target: { value: "  Cambio acordado  " } });
  fireEvent.click(screen.getByRole("button", { name: "Renegociar" })); const pending = screen.getByRole("button", { name: "Renegociando…" }); fireEvent.click(pending);
  expect(pending).toBeDisabled(); expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled(); expect(screen.getByRole("textbox", { name: "Nota" })).toBeDisabled();
  expect(renegotiateDraftCommitmentAction).toHaveBeenCalledTimes(1); expect(vi.mocked(renegotiateDraftCommitmentAction).mock.calls[0][0].body).toEqual({ commitment_date: "2026-10-19", reason: "other", note: "Cambio acordado" });
  await act(async () => resolve({ ok: true, delivery: { ...deliveryFixture(), commitmentDate: "2026-10-19", version: "1" }, etag: '"next"' }));
});
const fulfillment = { fulfilled_at: "2026-10-16T12:00:00Z", result: "on_time" as const, business_days_delta: 2, target: 1, cutoff_stage_id: "screen", cutoff_stage_name: "Corte congelado", commitment_date: "2026-10-20", candidates: [{ participation_id: "person", candidate: { id: "candidate", full_name: "Ana Pérez" }, reached_at: "2026-10-15T12:00:00Z" }] };
const fulfillmentStatus = { state: "fulfilled" as const, delivered: 1, target: 1, cutoff_stage_id: "screen", commitment_date: "2026-10-20", business_days_remaining: null, fulfillment };
const fulfillsPreview = { would_fulfill: true, delivered: 1, target: 1, candidates: fulfillment.candidates };
it("renders fulfilled delivery read-only with frozen snapshot and explaining candidates", async () => {
  vi.mocked(loadDeliveryStatusAction).mockResolvedValue({ ok: true, status: fulfillmentStatus });
  mount({ ...deliveryFixture(), fulfilled: true });
  expect(await screen.findByText("Corte congelado")).toBeVisible(); expect(screen.getByText("Ana Pérez")).toBeVisible();
  expect(screen.getByText("Entregada 2 días hábiles antes")).toHaveAttribute("data-variant", "success");
  expect(screen.getByText("1 candidatos")).toBeVisible();
  for (const date of [fulfillment.fulfilled_at, fulfillment.commitment_date, fulfillment.candidates[0].reached_at]) expect(document.querySelector(`time[datetime="${date}"]`)).not.toBeNull();
  expect(screen.getByText("La entrega ya se cumplió; su configuración no se puede cambiar.")).toBeVisible();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Guardar cambios" })).not.toBeInTheDocument();
});
it("previews the exact body, confirms candidates, then PUTs with explicit confirmation and ETag", async () => {
  vi.mocked(previewDraftDeliveryAction).mockResolvedValue({ ok: true, preview: fulfillsPreview }); mount(); edit("1"); fireEvent.click(save());
  const confirm = await screen.findByRole("button", { name: "Guardar y cumplir" }); expect(screen.getByRole("alertdialog")).toHaveTextContent("Ana Pérez"); expect(saveDraftDeliveryAction).not.toHaveBeenCalled();
  fireEvent.click(confirm); await waitFor(() => expect(saveDraftDeliveryAction).toHaveBeenCalledExactlyOnceWith({ draftId, ifMatch: '"delivery-0"', body: { cutoffStageId: null, targetQuantity: 1, commitmentDate: null, confirm_fulfillment: true } }));
  expect(previewDraftDeliveryAction).toHaveBeenCalledExactlyOnceWith({ draftId, body: { cutoffStageId: null, targetQuantity: 1, commitmentDate: null } });
});
it("confirmation formats the civil commitment date without shifting the business day", async () => {
  vi.mocked(previewDraftDeliveryAction).mockResolvedValue({ ok: true, preview: fulfillsPreview }); mount({ ...deliveryFixture(), commitmentDate: "2026-10-20" }); edit("1"); fireEvent.click(save());
  const dialog = await screen.findByRole("alertdialog"); expect(within(dialog).getByText("20 oct 2026")).toHaveAttribute("datetime", "2026-10-20");
});
it("a confirmed fulfilling save adopts the frozen result, never leaving an editable form", async () => {
  vi.mocked(previewDraftDeliveryAction).mockResolvedValue({ ok: true, preview: fulfillsPreview });
  vi.mocked(saveDraftDeliveryAction).mockResolvedValue({ ok: true, delivery: { ...deliveryFixture(), fulfilled: true, version: "1", targetQuantity: 1 }, etag: '"fulfilled"' });
  vi.mocked(loadDeliveryStatusAction).mockResolvedValue({ ok: true, status: fulfillmentStatus }); mount(); edit("1"); fireEvent.click(save());
  fireEvent.click(await screen.findByRole("button", { name: "Guardar y cumplir" }));
  expect(await screen.findByText("Corte congelado")).toBeVisible(); expect(screen.queryByRole("textbox")).not.toBeInTheDocument(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("a confirmed save still preserves If-Match/412 without an automatic reload or PUT retry", async () => {
  vi.mocked(previewDraftDeliveryAction).mockResolvedValue({ ok: true, preview: fulfillsPreview });
  vi.mocked(saveDraftDeliveryAction).mockResolvedValue({ ok: false, reason: "version_conflict", reference: { status: 412, code: "version_conflict" } }); mount(); edit("1"); fireEvent.click(save());
  fireEvent.click(await screen.findByRole("button", { name: "Guardar y cumplir" })); await screen.findByRole("button", { name: "Cargar versión actual" });
  expect(target()).toHaveValue("1"); expect(saveDraftDeliveryAction).toHaveBeenCalledTimes(1); expect(loadDraftDeliveryAction).not.toHaveBeenCalled(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("canceling fulfillment keeps edits and performs no PUT", async () => {
  vi.mocked(previewDraftDeliveryAction).mockResolvedValue({ ok: true, preview: fulfillsPreview }); mount(); edit("1"); fireEvent.click(save());
  fireEvent.click(await screen.findByRole("button", { name: "Cancelar" })); expect(target()).toHaveValue("1"); expect(save()).toBeEnabled(); expect(saveDraftDeliveryAction).not.toHaveBeenCalled();
});
it("409 confirmation race reads fresh preview and waits for another click", async () => {
  vi.mocked(previewDraftDeliveryAction).mockResolvedValueOnce({ ok: true, preview: { ...fulfillsPreview, would_fulfill: false, delivered: 0, candidates: [] } }).mockResolvedValue({ ok: true, preview: fulfillsPreview });
  vi.mocked(saveDraftDeliveryAction).mockResolvedValue({ ok: false, reason: "fulfillment_confirmation_required", reference: { status: 409, code: "fulfillment_confirmation_required" } });
  mount(); edit("1"); fireEvent.click(save()); expect(await screen.findByRole("button", { name: "Guardar y cumplir" })).toBeEnabled(); expect(previewDraftDeliveryAction).toHaveBeenCalledTimes(2); expect(saveDraftDeliveryAction).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" })); expect(target()).toHaveValue("1");
});
it("delivery_fulfilled reloads the read-only result without retrying PUT", async () => {
  vi.mocked(saveDraftDeliveryAction).mockResolvedValue({ ok: false, reason: "delivery_fulfilled", reference: { status: 409, code: "delivery_fulfilled" } });
  vi.mocked(loadDraftDeliveryAction).mockResolvedValue({ ok: true, delivery: { ...deliveryFixture(), fulfilled: true }, etag: '"frozen"' });
  vi.mocked(loadDeliveryStatusAction).mockResolvedValue({ ok: true, status: fulfillmentStatus }); mount(); edit(); fireEvent.click(save());
  expect(await screen.findByText("Corte congelado")).toBeVisible(); expect(screen.queryByRole("textbox")).not.toBeInTheDocument(); expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ title: "La entrega ya se cumplió" })); expect(saveDraftDeliveryAction).toHaveBeenCalledTimes(1);
});
it("an explicit uncertainty check adopts fulfilled even when another edit won", async () => {
  vi.mocked(saveDraftDeliveryAction).mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
  vi.mocked(loadDraftDeliveryAction).mockResolvedValue({ ok: true, delivery: { ...deliveryFixture(), fulfilled: true, version: "2", targetQuantity: 7 }, etag: '"frozen"' });
  vi.mocked(loadDeliveryStatusAction).mockResolvedValue({ ok: true, status: fulfillmentStatus }); mount(); edit(); fireEvent.click(save());
  fireEvent.click(await screen.findByRole("button", { name: "Comprobar" }));
  expect(await screen.findByText("Corte congelado")).toBeVisible(); expect(screen.queryByRole("textbox")).not.toBeInTheDocument(); expect(saveDraftDeliveryAction).toHaveBeenCalledTimes(1);
});
it("status read failure never re-enables fulfilled configuration and retries only the read", async () => {
  vi.mocked(loadDeliveryStatusAction).mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} }).mockResolvedValue({ ok: true, status: fulfillmentStatus });
  mount({ ...deliveryFixture(), fulfilled: true }); fireEvent.click(await screen.findByRole("button", { name: "Reintentar lectura" }));
  expect(await screen.findByText("Corte congelado")).toBeVisible(); expect(screen.queryByRole("textbox")).not.toBeInTheDocument(); expect(saveDraftDeliveryAction).not.toHaveBeenCalled();
});
it("failed preview retains edits, shows safe feedback and never PUTs", async () => {
  vi.mocked(previewDraftDeliveryAction).mockResolvedValue({ ok: false, reason: "no_response", reference: {} }); mount(); edit(); fireEvent.click(save());
  await screen.findByRole("status"); expect(target()).toHaveValue("5"); expect(saveDraftDeliveryAction).not.toHaveBeenCalled(); expect(screen.queryByRole("button", { name: "Comprobar" })).not.toBeInTheDocument();
});
it("unpublished draft preview rejection still permits the normal conditional save", async () => {
  vi.mocked(previewDraftDeliveryAction).mockResolvedValue({ ok: false, reason: "vacancy_not_published", reference: { status: 409 } }); mount(); edit(); fireEvent.click(save()); await screen.findByText("Guardado"); expect(saveDraftDeliveryAction).toHaveBeenCalledTimes(1);
});
it("confirmation has an accessible summary, cancel focus, Escape and return focus", async () => {
  const user = userEvent.setup(); vi.mocked(previewDraftDeliveryAction).mockResolvedValue({ ok: true, preview: fulfillsPreview }); mount(); edit("1"); await user.click(save());
  const dialog = await screen.findByRole("alertdialog", { name: "¿Guardar y cumplir la entrega?" }); expect(dialog).toHaveAccessibleDescription("Con este cambio la entrega queda cumplida y su configuración se congela.");
  expect(within(dialog).getByRole("button", { name: "Guardar y cumplir" })).toBeEnabled();
  expect(within(dialog).getAllByRole("listitem")).toHaveLength(1); expect(dialog).toHaveTextContent("Objetivo de entrega"); expect(dialog).toHaveTextContent("Columna de corte"); expect(dialog).toHaveTextContent("Fecha compromiso");
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancelar" })).toHaveFocus());
  await user.keyboard("{Escape}"); await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  await waitFor(() => expect(save()).toHaveFocus()); expect(target()).toHaveValue("1"); expect(saveDraftDeliveryAction).not.toHaveBeenCalled();
});
it("pending confirmed save blocks duplicate confirmation and Escape", async () => {
  const user = userEvent.setup(); vi.mocked(previewDraftDeliveryAction).mockResolvedValue({ ok: true, preview: fulfillsPreview });
  let resolve!: (value: DraftDeliveryActionResult) => void; vi.mocked(saveDraftDeliveryAction).mockReturnValue(new Promise(yes => { resolve = yes; }));
  mount(); edit("1"); fireEvent.click(save()); const confirm = await screen.findByRole("button", { name: "Guardar y cumplir" }); fireEvent.click(confirm); fireEvent.click(confirm);
  expect(confirm).toBeDisabled(); expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled(); await user.keyboard("{Escape}"); expect(screen.getByRole("alertdialog")).toBeVisible();
  await act(async () => resolve(success())); expect(saveDraftDeliveryAction).toHaveBeenCalledTimes(1);
});
const draftId = "123e4567-e89b-42d3-a456-426614174000";
const save = () => screen.getByRole("button", { name: "Guardar cambios" });
const target = () => screen.getByRole("textbox", { name: "Objetivo de entrega" });
const edit = (value = "5") => fireEvent.change(target(), { target: { value } });
const success = (version = "1", quantity: number | null = 5): DraftDeliveryActionResult => ({ ok: true, delivery: { ...deliveryFixture(), version, targetQuantity: quantity }, etag: '"delivery-next"' });
function mount(delivery = deliveryFixture()) { return render(<DeliveryEditor draftId={draftId} delivery={delivery} etag={'"delivery-0"'} stages={pipelineFixture().stages} />); }
beforeEach(() => { vi.resetAllMocks(); vi.mocked(previewDraftDeliveryAction).mockResolvedValue({ ok: true, preview: { would_fulfill: false, delivered: 0, target: 5, candidates: [] } }); vi.mocked(saveDraftDeliveryAction).mockResolvedValue(success()); vi.mocked(loadDraftDeliveryAction).mockResolvedValue(success()); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("composes one Entrega card, three icon Fields and an empty status slot below actions", () => {
  const { container } = mount(); expect(screen.getByRole("heading", { level: 3, name: "Entrega" })).toBeVisible();
  expect(screen.getByText("Define qué cuenta como entrega de esta vacante y para cuándo te comprometes. Puedes guardar los datos por partes; para publicar harán falta los tres.")).toBeVisible();
  expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(1); expect(container.querySelectorAll('[data-slot="field"]')).toHaveLength(3);
  for (const label of container.querySelectorAll('[data-slot="field-label"]')) expect(label.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  expect(target()).toHaveAttribute("type", "text"); expect(target()).toHaveAttribute("inputmode", "numeric"); expect(target()).toHaveAccessibleDescription("Cuántos candidatos distintos tienes que entregar (1 a 999).");
  const slot = container.querySelector('[data-pf-action-status-slot]')!; expect(slot).toBeEmptyDOMElement(); expect(save().compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // Compact action footer (rules §12): one ActionBar row inside the CardFooter.
  expect(slot.closest("[data-pf-action-bar]")).not.toBeNull();
  expect(slot.closest('[data-slot="card-footer"]')).toContainElement(save());
  expect(save()).toBeDisabled(); expect(screen.getByRole("button", { name: "Descartar cambios" })).toBeDisabled();
});
it("offers Sin definir plus current progression names in order, excluding the exit", async () => {
  const user = userEvent.setup(); const stages = pipelineFixture().stages.map((stage, index) => ({ ...stage, name: `Actual ${index}` }));
  render(<DeliveryEditor draftId={draftId} delivery={deliveryFixture()} etag='"delivery"' stages={stages} />);
  const select = screen.getByRole("combobox", { name: "Columna de corte" }); expect(select).toHaveTextContent("Sin definir"); await user.click(select);
  const options = await screen.findAllByRole("option"); expect(options.map(option => option.textContent)).toEqual(["Sin definir", ...stages.map(stage => stage.name)]);
  await user.click(options[2]); expect(select).toHaveTextContent("Actual 1"); fireEvent.click(save());
  await waitFor(() => expect(saveDraftDeliveryAction).toHaveBeenCalledWith({ draftId, ifMatch: '"delivery"', body: { cutoffStageId: stages[1].id, targetQuantity: null, commitmentDate: null } }));
});
it("uses the server calendar, Spanish dates, window bounds and disabled business days", async () => {
  const user = userEvent.setup(); mount(); await user.click(screen.getByRole("button", { name: "Fecha compromiso" }));
  const calendar = document.querySelector('[data-slot="calendar"]')!; expect(calendar).not.toBeNull();
  expect(calendar).toHaveClass("[--cell-size:--spacing(10)]");
  const day = (date: string) => calendar.querySelector(`button[data-day="${date}"]`) as HTMLButtonElement;
  expect(day("15/10/2026")).toBeDisabled(); expect(day("17/10/2026")).toBeDisabled(); expect(day("18/10/2026")).toBeDisabled(); expect(day("16/10/2026")).toBeEnabled();
  await user.click(day("16/10/2026")); expect(screen.getByRole("button", { name: "Fecha compromiso" })).toHaveTextContent("16 de octubre de 2026");
  fireEvent.click(save()); await waitFor(() => expect(saveDraftDeliveryAction).toHaveBeenCalledWith(expect.objectContaining({ body: { cutoffStageId: null, targetQuantity: null, commitmentDate: "2026-10-16" } })));
});
it("respects both inclusive server boundaries even when the browser's date differs", async () => {
  const user = userEvent.setup();
  const delivery = deliveryFixture(); delivery.calendar.maxDate = "2026-10-20";
  mount(delivery); await user.click(screen.getByRole("button", { name: "Fecha compromiso" }));
  const calendar = document.querySelector('[data-slot="calendar"]')!;
  const day = (date: string) => calendar.querySelector(`button[data-day="${date}"]`) as HTMLButtonElement;
  expect(day("15/10/2026")).toBeDisabled(); expect(day("16/10/2026")).toBeEnabled();
  expect(day("20/10/2026")).toBeEnabled(); expect(day("21/10/2026")).toBeDisabled();
  expect(day("16/10/2026").closest("td")).toHaveClass("rdp-today");
  await user.click(day("20/10/2026")); fireEvent.click(save());
  await waitFor(() => expect(saveDraftDeliveryAction).toHaveBeenCalledWith(expect.objectContaining({ body: { cutoffStageId: null, targetQuantity: null, commitmentDate: "2026-10-20" } })));
});
it("can clear a stored date and discard raw edits", () => {
  mount({ ...deliveryFixture(), commitmentDate: "2026-10-16" }); fireEvent.click(screen.getByRole("button", { name: "Quitar fecha" })); edit("abc");
  fireEvent.click(screen.getByRole("button", { name: "Descartar cambios" })); expect(target()).toHaveValue(""); expect(screen.getByRole("button", { name: "Fecha compromiso" })).toHaveTextContent("16 de octubre de 2026"); expect(save()).toBeDisabled();
});
it.each([["abc", "Escribe un número entero."], ["1.5", "Escribe un número entero."], ["0", "Usa un número entre 1 y 999."], ["1000", "Usa un número entre 1 y 999."]])("validates raw %s inline", (value, message) => {
  mount(); edit(value); fireEvent.blur(target()); expect(screen.getByText(message)).toHaveAttribute("data-slot", "field-error"); expect(target()).toHaveAttribute("aria-invalid", "true"); expect(target()).toHaveAccessibleDescription(expect.stringContaining(message)); fireEvent.click(save()); expect(saveDraftDeliveryAction).not.toHaveBeenCalled();
});
it("paints the stale-date warning with the semantic warning tone, not muted text (rules §10.5)", () => {
  mount({ ...deliveryFixture(), commitmentDate: "2025-01-01" });
  const warning = screen.getByText("La fecha compromiso ya pasó; elige otra antes de publicar.");
  expect(warning).toHaveClass("text-status-review");
  expect(warning).not.toHaveClass("text-muted-foreground");
});
it("focuses the first invalid field on a rejected save, not always the target", () => {
  mount({ ...deliveryFixture(), cutoffStageId: "00000000-0000-4000-8000-0000000000aa" }); edit(); fireEvent.click(save());
  expect(saveDraftDeliveryAction).not.toHaveBeenCalled();
  expect(screen.getByRole("combobox", { name: "Columna de corte" })).toHaveFocus();
});
it("warns on an unchanged stale date but sends it unchanged while saving other fields", async () => {
  mount({ ...deliveryFixture(), commitmentDate: "2025-01-01" }); expect(screen.getByText("La fecha compromiso ya pasó; elige otra antes de publicar.")).toBeVisible(); edit(); fireEvent.click(save());
  await waitFor(() => expect(saveDraftDeliveryAction).toHaveBeenCalledExactlyOnceWith({ draftId, ifMatch: '"delivery-0"', body: { cutoffStageId: null, targetQuantity: 5, commitmentDate: "2025-01-01" } }));
});
it("sends exact body with ETag, adopts new ETag and never marks subsequent edits saved", async () => {
  mount(); edit(); fireEvent.click(save()); await screen.findByText("Guardado"); expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ key: "delivery-save", type: "success", title: "Entrega guardada" })); expect(save()).toBeDisabled();
  edit("6"); expect(screen.getByRole("status")).toHaveTextContent("Cambios sin guardar"); fireEvent.click(save()); await waitFor(() => expect(saveDraftDeliveryAction).toHaveBeenCalledTimes(2)); expect(vi.mocked(saveDraftDeliveryAction).mock.calls[1][0].ifMatch).toBe('"delivery-next"');
});
it("emits info on a server no-op", async () => { vi.mocked(saveDraftDeliveryAction).mockResolvedValue(success("0")); mount(); edit(); fireEvent.click(save()); await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "info", title: "No había cambios que guardar" }))); });
it("keeps conflicting edits until an explicit version reload", async () => {
  vi.mocked(saveDraftDeliveryAction).mockResolvedValue({ ok: false, reason: "version_conflict", reference: { status: 412, code: "version_conflict" } }); vi.mocked(loadDraftDeliveryAction).mockResolvedValue(success("2", 7));
  mount(); edit(); fireEvent.click(save()); const reload = await screen.findByRole("button", { name: "Cargar versión actual" }); expect(target()).toHaveValue("5"); expect(loadDraftDeliveryAction).not.toHaveBeenCalled(); fireEvent.click(reload); await waitFor(() => expect(target()).toHaveValue("7")); expect(save()).toBeDisabled();
});
it.each(["saved", "not_saved", "conflict"] as const)("reconciles uncertain %s without replaying PUT", async outcome => {
  vi.mocked(saveDraftDeliveryAction).mockResolvedValue({ ok: false, reason: "no_response", reference: {} }); vi.mocked(loadDraftDeliveryAction).mockResolvedValue(outcome === "saved" ? success() : outcome === "not_saved" ? success("0", null) : success("2", 7));
  mount(); edit(); fireEvent.click(save()); const check = await screen.findByRole("button", { name: "Comprobar" }); expect(target()).toHaveValue("5"); expect(loadDraftDeliveryAction).not.toHaveBeenCalled(); fireEvent.click(check);
  if (outcome === "saved") await waitFor(() => expect(save()).toBeDisabled());
  else if (outcome === "not_saved") { await screen.findByText("No se guardó. Puedes guardar de nuevo; es seguro."); expect(target()).toHaveValue("5"); }
  else { await screen.findByRole("button", { name: "Cargar versión actual" }); expect(target()).toHaveValue("5"); }
  expect(saveDraftDeliveryAction).toHaveBeenCalledTimes(1);
});
it("retains edits and recovery if the reconciliation GET fails", async () => {
  vi.mocked(saveDraftDeliveryAction).mockResolvedValue({ ok: false, reason: "server_error", reference: { status: 500 } }); vi.mocked(loadDraftDeliveryAction).mockRejectedValue(new Error("unsafe")); mount(); edit(); fireEvent.click(save()); fireEvent.click(await screen.findByRole("button", { name: "Comprobar" })); await waitFor(() => expect(loadDraftDeliveryAction).toHaveBeenCalledTimes(1)); expect(target()).toHaveValue("5"); expect(screen.getByRole("button", { name: "Comprobar" })).toBeEnabled();
});
it("keeps published vacancy edits and reports missing labels without retry", async () => {
  vi.mocked(saveDraftDeliveryAction).mockResolvedValue({ ok: false, reason: "publication_incomplete", missing: ["delivery_target_missing", "delivery_cutoff_missing", "future"], reference: { status: 422, code: "publication_incomplete" } });
  mount({ ...deliveryFixture(), targetQuantity: 5 }); edit(""); fireEvent.click(save());
  const status = await screen.findByRole("status");
  expect(status).toHaveTextContent("No se guardó · faltan datos para una vacante publicada");
  expect(status.closest("[data-pf-action-bar]")).toContainElement(save());
  expect(save()).toHaveAttribute("aria-describedby", "delivery-save-status");
  expect(target()).toHaveValue(""); expect(save()).toBeEnabled();
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ key: "delivery-save", type: "error", title: "La vacante está publicada", description: "No puedes dejarla sin: Objetivo de entrega, Columna de corte, Otro requisito pendiente. Tus cambios siguen aquí.", reference: { status: 422, code: "publication_incomplete", at: expect.any(String) } }));
  expect(vi.mocked(notifyActionResult).mock.calls.at(-1)![0].action).toBeUndefined();
  expect(screen.queryByRole("button", { name: /Reintentar|Comprobar|Cargar versión/ })).not.toBeInTheDocument();
  expect(loadDraftDeliveryAction).not.toHaveBeenCalled(); expect(saveDraftDeliveryAction).toHaveBeenCalledTimes(1);
});
it("maps non_business_date to an associated date FieldError without losing edits", async () => {
  vi.mocked(saveDraftDeliveryAction).mockResolvedValue({ ok: false, reason: "non_business_date", reference: { status: 400, code: "non_business_date" } }); mount(); edit(); fireEvent.click(save());
  expect(await screen.findByText("Ese día no es hábil. Elige otro.")).toHaveAttribute("data-slot", "field-error"); const date = screen.getByRole("button", { name: "Fecha compromiso" }); expect(date).toHaveAttribute("aria-invalid", "true"); expect(date).toHaveAccessibleDescription(expect.stringContaining("Ese día no es hábil.")); expect(target()).toHaveValue("5");
});
it("shows spinner, blocks duplicate writes and preserves the form during pending saves", async () => {
  let resolve!: (value: DraftDeliveryActionResult) => void; vi.mocked(saveDraftDeliveryAction).mockReturnValue(new Promise(yes => { resolve = yes; })); const { container } = mount(); edit(); fireEvent.click(save());
  const pending = screen.getByRole("button", { name: "Guardando…" }); expect(pending).toBeDisabled(); expect(container.querySelector('[data-slot="spinner"]')).not.toBeNull(); expect(target()).toBeDisabled(); fireEvent.click(pending); await act(async () => resolve(success())); expect(saveDraftDeliveryAction).toHaveBeenCalledTimes(1);
});
it("makes the toast shortcut follow the status line's real link instead of opening a URL itself", async () => {
  vi.mocked(saveDraftDeliveryAction).mockResolvedValue({ ok: false, reason: "unauthenticated", reference: {} });
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  mount(); edit(); fireEvent.click(save()); await screen.findByRole("status");
  const call = vi.mocked(notifyActionResult).mock.calls.at(-1)![0];
  call.action!.onClick();
  expect(open).not.toHaveBeenCalled();
  expect(click).toHaveBeenCalledTimes(1);
  expect(click.mock.contexts[0]).toHaveAttribute("href", "/empresa/login");
});
it.each(["unauthenticated", "company_inactive"] as const)("offers a real recovery link for %s", async reason => {
  vi.mocked(saveDraftDeliveryAction).mockResolvedValue({ ok: false, reason, reference: {} }); mount(); edit(); fireEvent.click(save()); const status = await screen.findByRole("status"); expect(within(status).getByRole("link")).toHaveAttribute("href", reason === "unauthenticated" ? "/empresa/login" : "/empresa/configuracion");
});
