import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { sileo } from "sileo";
import { saveDraftV2Action, type DraftSaveResult } from "../actions";
import { LocalDraftForm } from "./local-draft-form";
import { createDraftModel } from "../model";

vi.mock("../actions", () => ({ saveDraftV2Action: vi.fn() }));
vi.mock("sileo", () => ({ sileo: { success: vi.fn() } }));
vi.mock("./draft-description-editor", () => ({ DraftDescriptionEditor: () => null }));
const key = "123e4567-e89b-42d3-a456-426614174000";
const success = {ok:true, draftId:"saved-id", etag:'"v1"', version:"1", savedAt:"2026-10-06T03:00:00Z"} as const;
const save = () => screen.getByRole("button", {name:/^Guardar borrador$|^Guardar cambios$/});
function review() {
  for (let i=0; i<4; i++) fireEvent.click(screen.getByRole("button", {name:"Continuar"}));
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(crypto, "randomUUID").mockReturnValue(key);
  vi.mocked(saveDraftV2Action).mockResolvedValue(success);
});
afterEach(() => {cleanup(); vi.restoreAllMocks();});
it("creates the validated v2 body, guards pending, then PATCHes the same draft with returned ETag", async () => {
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
  expect(Object.keys((input.body as {fields:object}).fields)).toHaveLength(17);
  expect(JSON.stringify(input.body)).not.toMatch(/description_plain|requesterName|schema_version/);
  fireEvent.submit(saveDraftForm());
  expect(saveDraftV2Action).toHaveBeenCalledTimes(1);
  await act(async () => resolve(success));
  expect(screen.getByText(/Borrador guardado/)).toBeVisible();
  expect(screen.getByText(/Borrador guardado/)).toHaveAttribute("data-variant", "success");
  expect(save()).toHaveTextContent("Guardar cambios");
  expect(sileo.success).toHaveBeenCalledTimes(1);
  fireEvent.click(save());
  await waitFor(() => expect(saveDraftV2Action).toHaveBeenCalledTimes(2));
  expect(vi.mocked(saveDraftV2Action).mock.calls[1][0]).toEqual({draftId:"saved-id",etag:'"v1"',body:input.body});
});
function saveDraftForm() {return document.querySelector("[data-pf-local-draft-form] form")!;}
it("keeps the create key after uncertainty, even after an edit and explicit retry", async () => {
  vi.mocked(saveDraftV2Action).mockResolvedValue({ok:false,reason:"uncertain"});
  render(<LocalDraftForm />); review(); fireEvent.click(save());
  expect(await screen.findByRole("alert")).toHaveTextContent(/No pudimos confirmar/);
  expect(save()).toBeEnabled();
  fireEvent.click(screen.getByRole("button",{name:"Atrás"}));
  for(let i=0;i<3;i++) fireEvent.click(screen.getByRole("button",{name:"Atrás"}));
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
  vi.mocked(saveDraftV2Action).mockResolvedValue({ok:false,reason});
  render(<LocalDraftForm />);
  fireEvent.change(screen.getByRole("textbox",{name:"Título"}),{target:{value:"Mi borrador"}});
  review(); fireEvent.click(save());
  expect(await screen.findByRole("alert")).toHaveTextContent(copy);
  if(href) expect(screen.getByRole("link")).toHaveAttribute("href",href);
  expect(screen.getByRole("alert")).toBeVisible();
  expect(sileo.success).not.toHaveBeenCalled();
  for(let i=0;i<4;i++) fireEvent.click(screen.getByRole("button",{name:"Atrás"}));
  expect(screen.getByRole("textbox",{name:"Título"})).toHaveValue("Mi borrador");
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
  render(<LocalDraftForm />); review(); fireEvent.click(save());
  for (let i=0;i<4;i++) fireEvent.click(screen.getByRole("button",{name:"Atrás"}));
  fireEvent.change(screen.getByRole("textbox",{name:"Título"}),{target:{value:"Edición posterior"}});
  await act(async () => resolve(success));
  review();
  expect(screen.getByRole("status")).toHaveTextContent("Hay cambios sin guardar");
  expect(saveDraftV2Action).toHaveBeenCalledTimes(1);
  fireEvent.click(save());
  await waitFor(() => expect(saveDraftV2Action).toHaveBeenCalledTimes(2));
  expect(vi.mocked(saveDraftV2Action).mock.calls[1][0]).toEqual({draftId:"saved-id",etag:'"v1"',body:{fields:expect.objectContaining({title:"Edición posterior"})}});
});
it("treats a disconnected action as uncertain and retries with the original create key", async () => {
  vi.mocked(saveDraftV2Action).mockRejectedValueOnce(new Error("disconnected"));
  render(<LocalDraftForm />); review(); fireEvent.click(save());
  expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos confirmar");
  expect(sileo.success).not.toHaveBeenCalled();
  fireEvent.click(save());
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Borrador guardado"));
  expect(vi.mocked(saveDraftV2Action).mock.calls[1][0].idempotencyKey).toBe(key);
});
it("keeps v1 validation local with no save action",()=>{
  render(<LocalDraftForm initialModel={createDraftModel()} />);review();
  fireEvent.click(screen.getByRole("button",{name:"Validar borrador"}));
  expect(saveDraftV2Action).not.toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent("Borrador local válido");
});
