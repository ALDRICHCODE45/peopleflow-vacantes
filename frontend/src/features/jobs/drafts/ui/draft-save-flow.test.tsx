import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { sileo } from "sileo";
import { saveDraftV2Action, type DraftSaveResult } from "../actions";
import { DraftSaveFeedback, notifyDraftSaveResult } from "./draft-save-feedback";
import { LocalDraftForm } from "./local-draft-form";
import { createDraftModel } from "../model";
import { draftEditSeedFromRead } from "../reopen/seed";
import { filledDraftRead, storedWriteFields } from "../reopen/test-fixture";

import { loadDraftPublicationAction } from "../pipeline/publication-actions";

// Integration tests that mount the full five-step draft editor per case. Alone each case takes
// ~1–3 s; under the full parallel suite some exceeded vitest's 5 s default and failed by timeout,
// not by assertion. The budget reflects that load; correctness assertions are unchanged.
vi.setConfig({ testTimeout: 30_000 });
vi.mock("../pipeline/publication-actions", () => ({ loadDraftPublicationAction: vi.fn(), publishDraftAction: vi.fn() }));
vi.mock("../actions", () => ({ saveDraftV2Action: vi.fn() }));
vi.mock("@/features/geo/use-geo-catalog", () => ({ useGeoCatalog: () => ({ countries: { status: "success", data: { items: [{ id: "MX", name: "México" }, { id: "CO", name: "Colombia" }] }, retry: vi.fn() }, states: { status: "success", data: { items: [{ id: "09", name: "Ciudad de México" }] } }, municipalities: { status: "success", data: { items: [] } } }), useGeoPostalCode: () => ({ status: "idle" }) }));
vi.mock("sileo", () => ({ sileo: { success: vi.fn(() => "draft-success"), error: vi.fn(() => "draft-error"), dismiss: vi.fn() } }));
const key = "123e4567-e89b-42d3-a456-426614174000";
const success = {ok:true, draftId:"saved-id", etag:'"v1"', version:"1", savedAt:"2026-10-06T03:00:00Z"} as const;
const save = () => screen.getByRole("button", {name:/^Guardar borrador$|^Guardar cambios$/});
function review() {
  fireEvent.click(screen.getByRole("tab", { name: "Revisión y publicación" }));
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(crypto, "randomUUID").mockReturnValue(key);
  vi.mocked(saveDraftV2Action).mockResolvedValue(success);
  vi.mocked(loadDraftPublicationAction).mockResolvedValue({ ok: true, publication: { status: "draft", publishedAt: null, missing: [] } });
});
afterEach(() => {cleanup(); vi.restoreAllMocks();});
it.each([
  ["server_error", "El servidor tuvo un problema"],
  ["no_response", "No hubo respuesta del servidor"],
  ["unrecognized_response", "No pudimos confirmar el resultado"],
] as const)("replaces %s toast on retry and retains accessible status", async (reason, title) => {
  vi.mocked(saveDraftV2Action).mockResolvedValueOnce({ok:false,reason,reference:{status:500,code:"internal_error"}})
    .mockResolvedValueOnce({ok:false,reason:"version_conflict",reference:{status:412,code:"version_conflict"}});
  render(<LocalDraftForm />); review(); fireEvent.click(save());
  expect(await screen.findByRole("status")).toHaveTextContent("Resultado sin confirmar · ver aviso");
  expect(sileo.error).toHaveBeenLastCalledWith(expect.objectContaining({title, duration:null}));
  const {container} = render(<>{vi.mocked(sileo.error).mock.calls[0][0].description}</>);
  expect(container).toHaveTextContent("no se creará un duplicado");
  expect(container).toHaveTextContent("HTTP 500 · internal_error");
  expect(save()).toHaveAttribute("aria-describedby", "draft-save-status");
  fireEvent.click(save());
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No se guardó · ver aviso"));
  expect(sileo.error).toHaveBeenLastCalledWith(expect.objectContaining({title:"Esto cambió en otro lugar"}));
  expect(sileo.dismiss).toHaveBeenCalledWith("draft-error");
  fireEvent.click(save());
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Guardado · versión 1"));
  expect(save()).toHaveAttribute("aria-describedby", "draft-save-status");
});
it("reopens all stored fields and PATCHes unchanged with the GET identity, not the list version", async () => {
  const read = filledDraftRead();
  const seed = draftEditSeedFromRead(read);
  const replace = vi.spyOn(window.history, "replaceState");
  render(<LocalDraftForm initialModel={seed.model} initialScreeningQuestionsV2={seed.screeningQuestionsV2} initialIdentity={{draftId:read.id,etag:'"opaque-get-tag"'}} />);
  review();
  expect(save()).toHaveTextContent("Guardar cambios");
  fireEvent.click(save());
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Guardado"));
  expect(saveDraftV2Action).toHaveBeenCalledExactlyOnceWith({draftId:read.id,etag:'"opaque-get-tag"',body:{fields:storedWriteFields(read)}});
  expect(crypto.randomUUID).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
});
it("creates the validated v2 body, guards pending, then PATCHes the same draft with returned ETag", async () => {
  const replace = vi.spyOn(window.history, "replaceState");
  let resolve!: (result: DraftSaveResult) => void;
  vi.mocked(saveDraftV2Action).mockReturnValueOnce(new Promise(r => {resolve=r;}));
  render(<LocalDraftForm />);
  fireEvent.change(screen.getByRole("textbox", {name:"Título"}), {target:{value:"  Backend  "}});
  review();
  fireEvent.click(save());
  expect(screen.getByRole("button", {name:"Guardando…"})).toBeDisabled();
  expect(screen.getByRole("button", {name:"Guardando…"})).toHaveAttribute("aria-busy","true");
  expect(sileo.success).not.toHaveBeenCalled();
  expect(screen.getByRole("button", {name:"Guardando…"})).toHaveClass("min-h-10");
  expect(screen.getByRole("button", {name:"Guardando…"}).querySelector('[data-slot="spinner"]')).not.toBeNull();
  const input = vi.mocked(saveDraftV2Action).mock.calls[0][0];
  expect(input).toEqual({idempotencyKey:key,body:{fields:expect.objectContaining({title:"Backend",screening_questions:[]})}});
  expect(Object.keys((input.body as {fields:object}).fields)).toHaveLength(18);
  expect(JSON.stringify(input.body)).not.toMatch(/description_plain|requesterName|schema_version/);
  fireEvent.submit(saveDraftForm());
  expect(saveDraftV2Action).toHaveBeenCalledTimes(1);
  await act(async () => resolve(success));
  expect(screen.getByRole("status")).toHaveTextContent("Guardado · versión 1");
  expect(sileo.success).toHaveBeenLastCalledWith(expect.objectContaining({title:"Borrador guardado",description:expect.stringContaining("versión 1")}));
  expect(save()).toHaveTextContent("Guardar cambios");
  expect(replace).toHaveBeenCalledExactlyOnceWith(window.history.state, "", "/empresa/vacantes/borradores/saved-id");
  expect(sileo.success).toHaveBeenCalledTimes(1);
  fireEvent.click(save());
  await waitFor(() => expect(saveDraftV2Action).toHaveBeenCalledTimes(2));
  expect(vi.mocked(saveDraftV2Action).mock.calls[1][0]).toEqual({draftId:"saved-id",etag:'"v1"',body:input.body});
  await waitFor(() => expect(sileo.success).toHaveBeenLastCalledWith(expect.objectContaining({title:"Cambios guardados"})));
  expect(replace).toHaveBeenCalledTimes(1);
});
it("requires a saved draft before publication; unsaved edits block the publish dialog", async () => {
  render(<LocalDraftForm />); review();
  fireEvent.click(screen.getByRole("button", { name: "Publicar vacante" }));
  expect(screen.getByText("Guarda los cambios antes de publicar")).toBeVisible();
  fireEvent.click(save()); await waitFor(() => expect(save()).toHaveTextContent("Guardar cambios"));
  expect(screen.getByRole("button", { name: "Publicar vacante" })).toHaveAttribute("aria-haspopup", "dialog");
  fireEvent.click(screen.getByRole("tab", { name: "Información básica" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Título" }), { target: { value: "Cambio" } }); review();
  fireEvent.click(screen.getByRole("button", { name: "Publicar vacante" }));
  expect(await screen.findByRole("heading", { name: "Guarda los cambios antes de publicar" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Confirmar publicación" })).not.toBeInTheDocument();
});
it("offers a real way out of an empty questionnaire simulation without saving", async () => {
  render(<LocalDraftForm />); review();
  fireEvent.click(screen.getByRole("button", { name: "Revisar y probar" }));
  const edit = await screen.findByRole("button", { name: "Editar preguntas" });
  expect(edit.closest('[data-slot="empty-content"]')).not.toBeNull();
  fireEvent.click(edit);
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByRole("heading", { name: "Paso 4 de 5: Preguntas de filtro" })).toBeVisible();
  expect(saveDraftV2Action).not.toHaveBeenCalled();
});
it("makes publication the primary shell action and keeps state in the header", async () => {
  render(<LocalDraftForm initialIdentity={{ draftId: key, etag: '"draft"' }} />); review();
  expect(save()).not.toHaveClass("bg-primary");
  expect(screen.getByRole("button", { name: "Publicar vacante" })).toHaveClass("bg-primary");
  await waitFor(() => expect(document.querySelector('header [data-slot="badge"]')).toHaveTextContent("Borrador"));
});
it("does not label a reopened vacancy as draft before its publication state is known", () => {
  vi.mocked(loadDraftPublicationAction).mockReturnValue(new Promise(() => {}));
  render(<LocalDraftForm initialIdentity={{ draftId: key, etag: '"draft"' }} />);
  const header = screen.getByRole("heading", { name: "Construye tu próxima oportunidad" }).closest('header')!;
  expect(header.querySelector('[data-slot="badge"]')).toHaveTextContent("Estado por confirmar");
});
it("already published editor keeps saving content but hides Publicar", async () => {
  vi.mocked(loadDraftPublicationAction).mockResolvedValue({ ok: true, publication: { status: "published", publishedAt: "2026-10-16T12:00:00Z", missing: [] } });
  render(<LocalDraftForm initialIdentity={{ draftId: key, etag: '"draft"' }} />); review();
  await waitFor(() => expect(loadDraftPublicationAction).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByRole("button", { name: "Publicar" })).not.toBeInTheDocument());
  expect(save()).toBeEnabled();
  await waitFor(() => expect(document.querySelector('header [data-slot="badge"]')).toHaveTextContent("Activa"));
  expect(screen.getByRole("button", { name: "Activa" })).toBeDisabled();
});
function saveDraftForm() {return document.querySelector("[data-pf-local-draft-form] form")!;}
it("keeps the create key after uncertainty, even after an edit and explicit retry", async () => {
  vi.mocked(saveDraftV2Action).mockResolvedValue({ok:false,reason:"unrecognized_response",reference:{}});
  render(<LocalDraftForm />); review(); fireEvent.click(save());
  expect(await screen.findByRole("status")).toHaveTextContent("Resultado sin confirmar · ver aviso");
  expect(save()).toBeEnabled();
  fireEvent.click(screen.getByRole("tab", { name: "Información básica" }));
  fireEvent.change(screen.getByRole("textbox", {name:"Título"}),{target:{value:"Cambio"}});
  review(); fireEvent.click(save());
  await waitFor(() => expect(saveDraftV2Action).toHaveBeenCalledTimes(2));
  expect(vi.mocked(saveDraftV2Action).mock.calls[1][0].idempotencyKey).toBe(key);
  expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
  expect(sileo.success).not.toHaveBeenCalled();
});
it.each([
  ["unauthenticated",/Inicia sesión/,"/empresa/login"],
  ["not_found",/empresa|borrador/,"/empresa/configuracion"],
  ["version_conflict",/cambió en otro lugar/,null],
  ["idempotency_conflict",/contenido.*cambió|cambiaste.*contenido/,null],
] as const)("shows persistent %s feedback without discarding typed data",async(reason,copy,href)=>{
  vi.mocked(saveDraftV2Action).mockResolvedValue({ok:false,reason,reference:{}});
  render(<LocalDraftForm />);
  fireEvent.change(screen.getByRole("textbox",{name:"Título"}),{target:{value:"Mi borrador"}});
  review(); fireEvent.click(save());
  expect(await screen.findByRole("status")).toHaveTextContent("No se guardó · ver aviso");
  const {container} = render(<>{vi.mocked(sileo.error).mock.calls[0][0].description}{vi.mocked(sileo.error).mock.calls[0][0].title}</>);
  expect(container).toHaveTextContent(copy);
  if(href) expect(screen.getByRole("link")).toHaveAttribute("href",href);
  expect(screen.getByRole("status")).toBeVisible();
  expect(sileo.success).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("tab", { name: "Información básica" }));
  expect(screen.getByRole("textbox",{name:"Título"})).toHaveValue("Mi borrador");
});
it("keeps published draft edits and reports missing labels without retry or field errors", async () => {
  vi.mocked(saveDraftV2Action).mockResolvedValue({ ok: false, reason: "publication_incomplete", missing: ["title_missing", "location_missing", "future"], reference: { status: 422, code: "publication_incomplete" } });
  render(<LocalDraftForm initialIdentity={{ draftId: key, etag: '"draft"' }} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Título" }), { target: { value: "Mi edición" } });
  review(); fireEvent.click(save());
  const status = await screen.findByRole("status");
  expect(status).toHaveTextContent("No se guardó · faltan datos para una vacante publicada");
  expect(status.closest("[data-pf-action-bar]")).toContainElement(save());
  expect(save()).toHaveAttribute("aria-describedby", "draft-save-status");
  expect(sileo.error).toHaveBeenLastCalledWith(expect.objectContaining({ title: "La vacante está publicada", duration: null }));
  const toast = vi.mocked(sileo.error).mock.calls.at(-1)![0];
  const { container } = render(<>{toast.description}</>);
  expect(container).toHaveTextContent("No puedes dejarla sin: Título, Ubicación, Otro requisito pendiente. Tus cambios siguen aquí.");
  expect(container).toHaveTextContent("HTTP 422 · publication_incomplete");
  expect(toast.button).toBeUndefined();
  expect(screen.queryByRole("button", { name: /Reintentar|Comprobar/ })).not.toBeInTheDocument();
  expect(sileo.success).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("tab", { name: "Información básica" }));
  expect(screen.getByRole("textbox", { name: "Título" })).toHaveValue("Mi edición");
  expect(document.querySelector('[data-slot="field-error"]')).toBeNull();
  expect(saveDraftV2Action).toHaveBeenCalledTimes(1);
});
it("routes 422 location errors to the matching level, retains input and focuses it", async () => {
  vi.mocked(saveDraftV2Action).mockResolvedValue({ ok: false, reason: "invalid_request", geography: { location: [{ field: "country", reason: "unknown" }], remoteScope: [] }, reference: { status: 422, code: "invalid_location" } });
  render(<LocalDraftForm />);
  fireEvent.change(screen.getByRole("textbox", { name: "Título" }), { target: { value: "Mi borrador" } });
  review(); fireEvent.click(save());
  const country = await screen.findByRole("combobox", { name: "País" });
  await waitFor(() => expect(country).toHaveAttribute("aria-invalid", "true"));
  expect(screen.getByText("Elige una opción de la lista.")).toHaveAttribute("data-slot", "field-error");
  expect(country).toHaveFocus();
  expect(screen.getByRole("textbox", { name: "Título" })).toHaveValue("Mi borrador");
  expect(saveDraftV2Action).toHaveBeenCalledTimes(1);
});
it("does not send invalid v2 state",()=>{
  render(<LocalDraftForm />);
  fireEvent.change(screen.getByRole("textbox",{name:"Título"}),{target:{value:"a".repeat(201)}});
  review(); fireEvent.click(save());
  expect(saveDraftV2Action).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox",{name:"Título"})).toHaveAttribute("aria-invalid","true");
});
it("keeps edits made during an in-flight save dirty and sends them only on the next explicit save", async () => {
  let resolve!: (result: DraftSaveResult) => void;
  vi.mocked(saveDraftV2Action).mockReturnValueOnce(new Promise(r => {resolve=r;}));
  const replace = vi.spyOn(window.history, "replaceState");
  render(<LocalDraftForm />); review(); fireEvent.click(save());
  expect(replace).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("tab", { name: "Información básica" }));
  fireEvent.change(screen.getByRole("textbox",{name:"Título"}),{target:{value:"Edición posterior"}});
  await act(async () => resolve(success));
  expect(replace).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("textbox", {name:"Título"})).toHaveValue("Edición posterior");
  review();
  expect(screen.getByRole("status")).toHaveTextContent("Cambios sin guardar · última versión guardada: 1");
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(saveDraftV2Action).toHaveBeenCalledTimes(1);
  fireEvent.click(save());
  await waitFor(() => expect(saveDraftV2Action).toHaveBeenCalledTimes(2));
  expect(vi.mocked(saveDraftV2Action).mock.calls[1][0]).toEqual({draftId:"saved-id",etag:'"v1"',body:{fields:expect.objectContaining({title:"Edición posterior"})}});
});
it("treats a disconnected action as uncertain and retries with the original create key", async () => {
  vi.mocked(saveDraftV2Action).mockRejectedValueOnce(new Error("disconnected"));
  render(<LocalDraftForm />); review(); fireEvent.click(save());
  expect(await screen.findByRole("status")).toHaveTextContent("Resultado sin confirmar · ver aviso");
  expect(sileo.error).toHaveBeenLastCalledWith(expect.objectContaining({title:"No hubo respuesta del servidor"}));
  expect(sileo.success).not.toHaveBeenCalled();
  fireEvent.click(save());
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Guardado · versión 1"));
  expect(vi.mocked(saveDraftV2Action).mock.calls[1][0].idempotencyKey).toBe(key);
});
it.each([
  ["unauthenticated", "Tu sesión expiró", "Iniciar sesión"],
  ["forbidden", "No tienes permiso para esta acción", null],
  ["company_inactive", "Falta configurar tu empresa", "Crear empresa"],
  ["company_not_active", "Falta configurar tu empresa", "Crear empresa"],
  ["not_found", "Falta configurar tu empresa", "Crear empresa"],
  ["invalid_request", "Revisa los datos del borrador", null],
  ["idempotency_conflict", "Esto cambió en otro lugar", null],
  ["version_conflict", "Esto cambió en otro lugar", null],
  ["precondition_required", "No se pudo comprobar la versión", null],
  ["payload_too_large", "El borrador supera el tamaño permitido", null],
] as const)("uses product copy and only a useful action for %s", (reason, title, action) => {
  render(<DraftSaveFeedback result={{ok:false,reason,reference:{}}} dirty />);
  expect(screen.getByRole("status")).toHaveTextContent("No se guardó · ver aviso");
  expect(screen.getByRole("status")).not.toHaveTextContent(/clave|idempotencia|respuesta inválida/);
  notifyDraftSaveResult({ok:false,reason,reference:{}}, false, "2026-10-06T17:58:46");
  expect(sileo.error).toHaveBeenLastCalledWith(expect.objectContaining({title}));
  if (action) {
    expect(screen.getByRole("link", {name:action})).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", {name:action})).toHaveClass("min-h-10");
  } else expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
it("explains safe PATCH retry without claiming the update failed", () => {
  render(<DraftSaveFeedback result={{ok:false,reason:"server_error",reference:{status:502}}} dirty />);
  expect(screen.getByRole("status")).toHaveTextContent("Resultado sin confirmar · ver aviso");
  notifyDraftSaveResult({ok:false,reason:"server_error",reference:{status:502}}, true, "2026-10-06T17:58:46");
  const {container} = render(<>{vi.mocked(sileo.error).mock.calls[0][0].description}</>);
  expect(container).toHaveTextContent("podría haberse actualizado");
  expect(container).toHaveTextContent("no sobrescribiremos una versión más reciente");
});
it("keeps v1 validation local with no save action",()=>{
  render(<LocalDraftForm initialModel={createDraftModel()} />);review();
  fireEvent.click(screen.getByRole("button",{name:"Validar borrador"}));
  expect(saveDraftV2Action).not.toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent("Borrador local válido");
});
it("keeps the save button in place: the status slot exists below it before and after saving", async () => {
  render(<LocalDraftForm />); review();
  const button = save();
  const slot = document.querySelector("[data-pf-action-status-slot]");
  expect(slot).toBeInTheDocument();
  expect(slot).toHaveTextContent("Sin guardado automático");
  expect(button.compareDocumentPosition(slot!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(button);
  await waitFor(() => expect(slot).toHaveTextContent("Guardado · versión 1"));
  expect(save().compareDocumentPosition(screen.getByRole("status")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole("status").closest("[data-pf-action-status-slot]")).toBe(slot);
});
it("keeps the result and actions in a shared sticky ActionBar, separate from navigation", () => {
  render(<LocalDraftForm />); review();
  const actions = save().parentElement!;
  expect(actions).not.toContainElement(screen.getByRole("button", {name:"Revisar y probar"}));
  expect(screen.getByRole("button", {name:"Revisar y probar"}).closest('[data-slot="card-content"]')).not.toBeNull();
  const slot = document.querySelector("[data-pf-action-status-slot]")!;
  expect(actions).not.toContainElement(slot as HTMLElement);
  expect(actions.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // Same row: the status sits beside the actions (ActionBar), not stacked below them.
  const bar = slot.closest("[data-pf-action-bar]")!;
  expect(bar).not.toBeNull();
  expect(bar).toContainElement(save());
  const footer = save().closest('[data-pf-draft-save-bar]')!;
  expect(footer).toHaveClass("sticky", "bottom-4");
  expect(footer).not.toContainElement(screen.getByRole("button", {name:"Anterior"}));
});
