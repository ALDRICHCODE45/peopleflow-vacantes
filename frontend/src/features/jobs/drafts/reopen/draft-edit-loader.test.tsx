import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { loadDraftForEditAction, type DraftEditResult } from "./load";
import { DraftEditLoader } from "./draft-edit-loader";
import { draftEditSeedFromRead } from "./seed";
import { filledDraftRead, storedWriteFields } from "./test-fixture";
import { saveDraftV2Action } from "../actions";

vi.mock("./load", () => ({loadDraftForEditAction:vi.fn()}));
vi.mock("../actions", () => ({saveDraftV2Action:vi.fn()}));
vi.mock("sileo", () => ({sileo:{success:vi.fn(),error:vi.fn(),dismiss:vi.fn()}}));
const read = filledDraftRead();
const success = {ok:true,seed:draftEditSeedFromRead(read),identity:{draftId:read.id,etag:'"get-etag"'}} as const;
function deferred() {
  let resolve!: (value:DraftEditResult) => void;
  let reject!: (reason:unknown) => void;
  const promise = new Promise<DraftEditResult>((yes,no) => {resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadDraftForEditAction).mockResolvedValue(success);
  vi.mocked(saveDraftV2Action).mockResolvedValue({ok:true,draftId:read.id,etag:'"next-etag"',version:"8",savedAt:read.updated_at});
});
afterEach(cleanup);

it("shows editor-shaped Skeletons with one accessible status while loading", async () => {
  const pending = deferred();
  vi.mocked(loadDraftForEditAction).mockReturnValue(pending.promise);
  const {container} = render(<DraftEditLoader draftId={read.id} />);
  expect(loadDraftForEditAction).toHaveBeenCalledExactlyOnceWith(read.id);
  expect(screen.getByRole("status")).toHaveTextContent("Cargando borrador");
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status").closest('[aria-busy="true"]')).not.toBeNull();
  const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
  expect(skeletons.length).toBeGreaterThan(5);
  expect(container.querySelector('[data-slot="skeleton"].max-w-prose')).not.toBeNull();
  skeletons.forEach(item => expect(item.closest('[aria-hidden="true"]')).not.toBeNull());
  expect(screen.queryByRole("textbox",{name:"Título"})).not.toBeInTheDocument();
  const skeletonCards = [...container.querySelectorAll('[data-slot="card"]')];
  const slots = (node: Element) => [...node.querySelectorAll('[data-slot]')].map(part => part.getAttribute("data-slot")).filter(slot => slot?.startsWith("card-"));
  const skeletonSlots = skeletonCards.map(slots);
  expect(skeletonCards).toHaveLength(3);
  expect(skeletonCards[0].querySelectorAll('[data-slot="field"]')).toHaveLength(5);
  await act(async () => pending.resolve(success));
  expect(screen.queryByText("Cargando borrador")).not.toBeInTheDocument();
  const loadedCards = [...container.querySelectorAll('[data-pf-draft-section="1"] [data-slot="card"]')];
  expect(skeletonSlots).toEqual(loadedCards.map(slots));
});
it("loads the real seeded editor and first saves every stored field by PATCH with the GET ETag", async () => {
  render(<DraftEditLoader draftId={read.id} />);
  expect(await screen.findByRole("textbox",{name:"Título"})).toHaveValue(read.fields.title);
  fireEvent.click(screen.getByRole("button", { name: "Revisión y publicación" }));
  fireEvent.click(screen.getByRole("button",{name:"Guardar cambios"}));
  await waitFor(() => expect(saveDraftV2Action).toHaveBeenCalledExactlyOnceWith({draftId:read.id,etag:'"get-etag"',body:{fields:storedWriteFields(read)}}));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Guardado · versión 8"));
  expect(loadDraftForEditAction).toHaveBeenCalledTimes(1);
});
it.each(["not_found","unauthenticated","forbidden","company_inactive","company_not_active","server_error","no_response","unrecognized_response"] as const)("shows %s with its real link and explicit retry", async reason => {
  vi.mocked(loadDraftForEditAction).mockResolvedValueOnce({ok:false,reason});
  const {container} = render(<DraftEditLoader draftId={read.id} />);
  const retry = await screen.findByRole("button",{name:"Reintentar"});
  expect(container.querySelector('[data-slot="empty"]')).not.toBeNull();
  expect(screen.getByRole("link")).toHaveAttribute("href", reason === "unauthenticated" ? "/empresa/login" : reason.startsWith("company_") ? "/empresa/configuracion" : "/empresa/vacantes");
  expect(saveDraftV2Action).not.toHaveBeenCalled();
  expect(screen.queryByRole("textbox",{name:"Título"})).not.toBeInTheDocument();
  fireEvent.click(retry);
  expect(await screen.findByRole("textbox",{name:"Título"})).toHaveValue(read.fields.title);
  expect(loadDraftForEditAction).toHaveBeenCalledTimes(2);
});
it("turns a rejected action into safe no-response copy and allows retry", async () => {
  vi.mocked(loadDraftForEditAction).mockRejectedValueOnce(new Error("private exception text"));
  const {container} = render(<DraftEditLoader draftId={read.id} />);
  expect(await screen.findByRole("heading",{name:"No hubo respuesta del servidor"})).toBeVisible();
  expect(container).not.toHaveTextContent("private exception text");
  fireEvent.click(screen.getByRole("button",{name:"Reintentar"}));
  expect(await screen.findByRole("textbox",{name:"Título"})).toBeVisible();
});
it("returns to the loading skeleton during a pending retry", async () => {
  const pending = deferred();
  vi.mocked(loadDraftForEditAction).mockResolvedValueOnce({ok:false,reason:"no_response"}).mockReturnValueOnce(pending.promise);
  render(<DraftEditLoader draftId={read.id} />);
  fireEvent.click(await screen.findByRole("button",{name:"Reintentar"}));
  expect(screen.getByRole("status")).toHaveTextContent("Cargando borrador");
  expect(screen.queryByRole("button",{name:"Reintentar"})).not.toBeInTheDocument();
  await act(async () => pending.resolve(success));
  expect(await screen.findByRole("textbox",{name:"Título"})).toBeVisible();
});
it.each(["success","rejection"] as const)("ignores late %s after unmount", async outcome => {
  const pending = deferred();
  vi.mocked(loadDraftForEditAction).mockReturnValueOnce(pending.promise);
  const {unmount,container} = render(<DraftEditLoader draftId={read.id} />);
  unmount();
  await act(async () => {
    if (outcome === "success") pending.resolve(success);
    else pending.reject(new Error("private exception text"));
  });
  expect(container).toBeEmptyDOMElement();
  expect(loadDraftForEditAction).toHaveBeenCalledTimes(1);
  expect(saveDraftV2Action).not.toHaveBeenCalled();
});
it("ignores the old request when the draft id changes", async () => {
  const pending = deferred();
  const nextId = "423e4567-e89b-42d3-a456-426614174000";
  vi.mocked(loadDraftForEditAction).mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ok:false,reason:"not_found"});
  const {rerender} = render(<DraftEditLoader draftId={read.id} />);
  rerender(<DraftEditLoader draftId={nextId} />);
  expect(await screen.findByRole("heading",{name:"No encontramos este borrador"})).toBeVisible();
  await act(async () => pending.resolve(success));
  expect(screen.getByRole("heading",{name:"No encontramos este borrador"})).toBeVisible();
  expect(screen.queryByRole("textbox",{name:"Título"})).not.toBeInTheDocument();
  expect(loadDraftForEditAction).toHaveBeenLastCalledWith(nextId);
});
