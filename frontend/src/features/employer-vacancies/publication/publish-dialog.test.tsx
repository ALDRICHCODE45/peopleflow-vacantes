import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
vi.mock("@/features/jobs/drafts/reopen/load", () => ({ loadDraftForEditAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/publication-actions", () => ({ loadDraftPublicationAction: vi.fn(), publishDraftAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/delivery-actions", () => ({ loadDraftDeliveryAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/actions", () => ({ loadDraftPipelineAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn(), dismissActionResult: vi.fn() }));
import { loadDraftForEditAction } from "@/features/jobs/drafts/reopen/load";
import { loadDraftPublicationAction, publishDraftAction } from "@/features/jobs/drafts/pipeline/publication-actions";
import { loadDraftDeliveryAction } from "@/features/jobs/drafts/pipeline/delivery-actions";
import { loadDraftPipelineAction } from "@/features/jobs/drafts/pipeline/actions";
import { notifyActionResult } from "@/components/feedback/notify";
import { filledDraftRead } from "@/features/jobs/drafts/reopen/test-fixture";
import { draftEditSeedFromRead } from "@/features/jobs/drafts/reopen/seed";
import { PublishButton, PublishDialog } from "./publish-dialog";
const draft = filledDraftRead();
const onOpenChange = vi.fn(); const onPublished = vi.fn();
const date = "2026-10-16T12:00:00Z";
const ready = { ok: true, publication: { status: "draft", publishedAt: null, missing: [] } } as const;
beforeEach(() => {
 vi.resetAllMocks();
 vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
 vi.mocked(loadDraftForEditAction).mockResolvedValue({ ok: true, seed: draftEditSeedFromRead(draft), identity: { draftId: draft.id, etag: '"draft-etag"' } });
 vi.mocked(loadDraftPublicationAction).mockResolvedValue({ ...ready, publication: { ...ready.publication, missing: [] } });
 vi.mocked(loadDraftDeliveryAction).mockResolvedValue({ ok: true, etag: '"delivery"', delivery: { version: "1", cutoffStageId: draft.id, targetQuantity: 5, commitmentDate: "2026-11-30", limits: { maxTargetQuantity: 999 }, calendar: { timeZone: "America/Mexico_City", today: "2026-10-16", minDate: "2026-10-16", maxDate: "2027-10-16", nonBusinessDates: [] } } });
 vi.mocked(loadDraftPipelineAction).mockResolvedValue({ ok: true, etag: '"pipeline"', pipeline: { version: "1", stages: [{ id: draft.id, kind: "screening_ok", name: "Lista para entrevista" }], exit: { id: draft.id, kind: "discarded", name: "Fuera" }, limits: { maxCustomStages: 3, nameMaxLength: 40 }, structure_locked: false } });
 vi.mocked(publishDraftAction).mockResolvedValue({ ok: true, publication: { id: draft.id, status: "published", publishedAt: date } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount(unsavedChanges = false) { return render(<PublishDialog draftId={draft.id} open onOpenChange={onOpenChange} onPublished={onPublished} unsavedChanges={unsavedChanges} />); }
async function confirm() { const button = await screen.findByRole("button", { name: "Publicar vacante" }); await act(async () => fireEvent.click(button)); }
it("loads all four reads in parallel with structure skeleton and pre-result ActionBar slot", async () => {
 let resolve!: (value: Awaited<ReturnType<typeof loadDraftPublicationAction>>) => void;
 vi.mocked(loadDraftPublicationAction).mockReturnValue(new Promise(yes => { resolve = yes; })); mount();
 expect(loadDraftForEditAction).toHaveBeenCalledTimes(1); expect(loadDraftDeliveryAction).toHaveBeenCalledTimes(1); expect(loadDraftPipelineAction).toHaveBeenCalledTimes(1);
 expect(document.querySelector('[aria-busy="true"] [data-slot="skeleton"]')).not.toBeNull();
 expect(document.querySelector('[data-slot="dialog-footer"] [data-pf-action-bar] [data-pf-action-status-slot]')).not.toBeNull();
 const slots = () => [...document.querySelectorAll('[data-slot^="item"]')].map(node => node.getAttribute("data-slot"));
 const loadingSlots = slots();
 expect(document.querySelectorAll('[data-slot="item"]')).toHaveLength(4);
 await act(async () => resolve({ ...ready, publication: { ...ready.publication, missing: [] } }));
 expect(slots()).toEqual(loadingSlots);
});
it("blocks unsaved changes before reads or publish", async () => { mount(true); expect(await screen.findByText("Guarda los cambios antes de publicar")).toBeVisible(); expect(screen.queryByRole("button", { name: "Publicar vacante" })).not.toBeInTheDocument(); expect(loadDraftForEditAction).not.toHaveBeenCalled(); });
it("groups checklist links by owner with unknown-code fallback and no publish", async () => {
 vi.mocked(loadDraftPublicationAction).mockResolvedValue({ ok: true, publication: { status: "draft", publishedAt: null, missing: ["title_missing", "request_date_missing", "commitment_date_past", "future"] } }); mount();
 await screen.findByRole("heading", { name: "Te falta para publicar" });
 for (const name of ["Editor de la vacante", "Solicitud", "Entrega"]) {
  const heading = screen.getByRole("heading", { name });
  expect(heading).toBeVisible();
  expect(heading.closest('[data-slot="card-title"]')?.parentElement).toHaveAttribute("data-slot", "card-header");
  expect(heading.closest('[data-slot="card"]')?.querySelector('[data-slot="card-content"] [data-slot="item-group"]')).not.toBeNull();
 }
 expect(screen.getByText("Otro requisito pendiente", { selector: '[data-slot="item-title"]' })).toBeVisible(); expect(screen.getByText("La fecha compromiso ya pasó", { selector: '[data-slot="item-title"]' })).toBeVisible();
 expect(screen.getAllByRole("link", { name: /Completar/ }).map(link => link.getAttribute("href"))).toEqual([`/empresa/vacantes/borradores/${draft.id}`, `/empresa/vacantes/borradores/${draft.id}`, `/empresa/vacantes/${draft.id}/configuracion/solicitud`, `/empresa/vacantes/${draft.id}/configuracion/entrega`]);
 expect(screen.queryByRole("button", { name: "Publicar vacante" })).not.toBeInTheDocument();
});
it("shows honest summary and confirms body/key/draft ETag then notifies, closes and updates owner", async () => { mount(); await screen.findByText("Lista para entrevista"); expect(screen.getByText("30 de noviembre de 2026")).toBeVisible(); expect(screen.getByText("5 candidatos")).toBeVisible(); for (const label of ["Columna de corte", "Objetivo de entrega", "Fecha compromiso"]) expect(screen.getByText(label)).toBeVisible(); expect(screen.queryByText(/Columna de entrega|Meta de entrega/)).toBeNull(); expect(screen.getByText(/Los candidatos todavía no la verán/)).toBeVisible(); await confirm(); await waitFor(() => expect(onPublished).toHaveBeenCalledWith(date)); expect(publishDraftAction).toHaveBeenCalledExactlyOnceWith({ draftId: draft.id, ifMatch: '"draft-etag"', idempotencyKey: expect.any(String), body: {} }); expect(onOpenChange).toHaveBeenCalledWith(false); expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Vacante publicada" })); });
it("keeps a long checklist compact and scrollable without clipping any group", async () => {
 vi.mocked(loadDraftPublicationAction).mockResolvedValue({ ok: true, publication: { status: "draft", publishedAt: null, missing: ["title_missing", "description_missing", "location_missing", "request_date_missing", "commitment_date_past"] } }); mount();
 await screen.findByRole("heading", { name: "Te falta para publicar" });
 expect(screen.getByText("Faltan 5 datos en 3 secciones. Completa cada uno y vuelve a publicar.")).toBeVisible();
 const cards = [...document.querySelectorAll('[data-slot="card"]')];
 expect(cards).toHaveLength(3);
 // One scroll region owns the overflow; groups never shrink (shrinking clipped their rows).
 for (const card of cards) {
  expect(card.closest('[data-slot="scroll-area"]')).not.toBeNull();
  expect(card).toHaveClass("shrink-0");
 }
 // Compact rows: no outlined box per item, separators between rows, a count per group.
 expect(document.querySelectorAll('[data-slot="item"][data-variant="outline"]')).toHaveLength(0);
 expect(cards[0].querySelectorAll('[data-slot="item-separator"]')).toHaveLength(2);
 expect(cards.map(card => card.querySelector('[data-slot="card-action"]')?.textContent)).toEqual(["3", "1", "1"]);
});
it("422 switches to server checklist", async () => { vi.mocked(publishDraftAction).mockResolvedValue({ ok: false, reason: "publication_incomplete", missing: ["description_missing"], reference: { status: 422 } }); mount(); await confirm(); expect(await screen.findByRole("heading", { name: "Te falta para publicar" })).toBeVisible(); expect(screen.getByText("Descripción", { selector: '[data-slot="item-title"]' })).toBeVisible(); });
it("409 already published reloads readiness and treats confirmed state as informational success", async () => { vi.mocked(publishDraftAction).mockResolvedValue({ ok: false, reason: "already_published", reference: { status: 409 } }); vi.mocked(loadDraftPublicationAction).mockResolvedValueOnce({ ...ready, publication: { ...ready.publication, missing: [] } }).mockResolvedValueOnce({ ok: true, publication: { status: "published", publishedAt: date, missing: [] } }); mount(); await confirm(); await waitFor(() => expect(onPublished).toHaveBeenCalledWith(date)); expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "info", title: "Esta vacante ya está publicada" })); });
it("412 requires full reload and a new confirmation key", async () => { vi.mocked(publishDraftAction).mockResolvedValueOnce({ ok: false, reason: "version_conflict", reference: { status: 412 } }); mount(); await confirm(); expect(await screen.findByText("Esto cambió en otro lugar")).toBeVisible(); expect(screen.getByRole("heading", { name: "Publicar vacante" })).toHaveFocus(); vi.mocked(loadDraftForEditAction).mockResolvedValue({ ok: true, seed: draftEditSeedFromRead(draft), identity: { draftId: draft.id, etag: '"updated-draft"' } }); fireEvent.click(screen.getByRole("button", { name: "Revisar de nuevo" })); await confirm(); await waitFor(() => expect(publishDraftAction).toHaveBeenCalledTimes(2)); expect(loadDraftForEditAction).toHaveBeenCalledTimes(2); expect(vi.mocked(publishDraftAction).mock.calls[1][0].ifMatch).toBe('"updated-draft"'); expect(vi.mocked(publishDraftAction).mock.calls[0][0].idempotencyKey).not.toBe(vi.mocked(publishDraftAction).mock.calls[1][0].idempotencyKey); });
it.each(["no_response", "server_error", "unrecognized_response"] as const)("uncertain %s requires Comprobar, no automatic retry and retains key on draft", async reason => { vi.mocked(publishDraftAction).mockResolvedValueOnce({ ok: false, reason, reference: {} }); mount(); await confirm(); const check = await screen.findByRole("button", { name: "Comprobar" }); expect(publishDraftAction).toHaveBeenCalledTimes(1); expect(screen.queryByRole("button", { name: "Publicar vacante" })).not.toBeInTheDocument(); fireEvent.click(check); await confirm(); await waitFor(() => expect(publishDraftAction).toHaveBeenCalledTimes(2)); expect(vi.mocked(publishDraftAction).mock.calls[0][0]).toEqual(vi.mocked(publishDraftAction).mock.calls[1][0]); });
it("uncertain published reconciliation succeeds without another POST", async () => { vi.mocked(publishDraftAction).mockResolvedValue({ ok: false, reason: "no_response", reference: {} }); vi.mocked(loadDraftPublicationAction).mockResolvedValueOnce({ ...ready, publication: { ...ready.publication, missing: [] } }).mockResolvedValueOnce({ ok: true, publication: { status: "published", publishedAt: date, missing: [] } }); mount(); await confirm(); fireEvent.click(await screen.findByRole("button", { name: "Comprobar" })); await waitFor(() => expect(onPublished).toHaveBeenCalledWith(date)); expect(publishDraftAction).toHaveBeenCalledTimes(1); });
it("keeps the trigger inert before opening and restores focus after Cancelar", async () => {
 render(<PublishButton draftId={draft.id} onPublished={onPublished} />);
 expect(loadDraftForEditAction).not.toHaveBeenCalled();
 const trigger = screen.getByRole("button", { name: "Publicar" }); trigger.focus(); fireEvent.click(trigger);
 await screen.findByText("Lista para entrevista");
 fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
 await waitFor(() => expect(trigger).toHaveFocus());
 expect(publishDraftAction).not.toHaveBeenCalled();
});
it("guards double submission and shows the official publishing Spinner", async () => {
 let resolve!: (result: Awaited<ReturnType<typeof publishDraftAction>>) => void;
 vi.mocked(publishDraftAction).mockReturnValue(new Promise(yes => { resolve = yes; })); mount(); await confirm();
 const button = screen.getByRole("button", { name: "Publicando…" }); expect(button).toBeDisabled(); expect(button.querySelector('[data-slot="spinner"]')).not.toBeNull(); fireEvent.click(button);
 expect(publishDraftAction).toHaveBeenCalledTimes(1);
 await act(async () => resolve({ ok: true, publication: { id: draft.id, status: "published", publishedAt: date } }));
});
it("failed reconciliation preserves uncertainty until a later explicit check", async () => {
 vi.mocked(publishDraftAction).mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
 vi.mocked(loadDraftPublicationAction).mockResolvedValueOnce({ ...ready, publication: { ...ready.publication, missing: [] } }).mockResolvedValueOnce({ ok: false, reason: "server_error", reference: { status: 500 } }).mockResolvedValueOnce({ ok: true, publication: { status: "published", publishedAt: date, missing: [] } });
 mount(); await confirm(); await act(async () => fireEvent.click(screen.getByRole("button", { name: "Comprobar" })));
 expect(screen.getByRole("button", { name: "Comprobar" })).toBeEnabled(); expect(screen.queryByRole("button", { name: "Publicar vacante" })).not.toBeInTheDocument();
 await act(async () => fireEvent.click(screen.getByRole("button", { name: "Comprobar" })));
 expect(onPublished).toHaveBeenCalledWith(date); expect(publishDraftAction).toHaveBeenCalledTimes(1);
});
it("failed loading stays inline and retries only explicitly", async () => { vi.mocked(loadDraftDeliveryAction).mockResolvedValueOnce({ ok: false, reason: "server_error", reference: { status: 500 } }); mount(); fireEvent.click(await screen.findByRole("button", { name: "Reintentar" })); await screen.findByText("Lista para entrevista"); expect(loadDraftDeliveryAction).toHaveBeenCalledTimes(2); });
