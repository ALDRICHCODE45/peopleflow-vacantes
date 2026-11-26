import "./board-filter-popover-test-double";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MovementBoard } from "./board";
import { boardFixture } from "./board-fixture";
import { loadBoardAction, loadHistoryAction, loadParticipationAction } from "./actions";
import { notifyActionResult } from "@/components/feedback/notify";

// The sheet's detail read stays pending: the sheet renders from the board's item, which is all these tests need.
vi.mock("./actions", () => ({ loadBoardAction: vi.fn(), loadParticipationAction: vi.fn(), loadHistoryAction: vi.fn() }));
// Next's search-params context: on (as in the app router) it re-reads the URL each render, so a rerender models a client-side navigation; off ⇒ no provider (null).
const nav = vi.hoisted(() => ({ context: true }));
vi.mock("next/navigation", async importOriginal => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  useSearchParams: () => nav.context ? new URLSearchParams(window.location.search) : null,
}));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
// Closing restores focus and opens the name tooltip: exclude only its positioning portal (no anchor geometry in jsdom), as board-additional does.
vi.mock("@/components/ui/tooltip", async importOriginal => ({
  ...await importOriginal<typeof import("@/components/ui/tooltip")>(), TooltipContent: () => null,
}));
vi.mock("@/features/vacancy-checklist/actions", () => ({
  loadChecklistAction: vi.fn(async () => ({ ok: true, data: { version: "0", criteria: [], reminder_stage_ids: [] } })),
  loadChecklistMarksAction: vi.fn(async () => ({ ok: true, data: { items: [] } })),
}));
vi.mock("@/features/languages/use-language-catalog", () => ({ useLanguageCatalog: () => ({ status: "success", data: { items: [] } }) }));
vi.mock("./use-board-column-order", () => ({ useBoardColumnOrder: (_id: string, board: unknown) => ({ board, locked: true, structureLocked: true }) }));
vi.mock("@/features/jobs/drafts/pipeline/delivery-actions", () => ({ loadDeliveryStatusAction: vi.fn(async () => ({ ok: false })) }));
beforeEach(() => {
  nav.context = true; vi.clearAllMocks(); vi.stubGlobal("PointerEvent", MouseEvent); window.history.replaceState(null, "", "/empresa/vacantes/v/pipeline");
  vi.mocked(loadParticipationAction).mockReturnValue(new Promise(() => {}));
  vi.mocked(loadHistoryAction).mockReturnValue(new Promise(() => {}));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function people() {
  const board = boardFixture();
  const base = board.participations[0];
  board.participations = [
    { ...base, id: "ana", candidate: { ...base.candidate, id: "c-ana", full_name: "Ana Pérez" } },
    { ...base, id: "luis", candidate: { ...base.candidate, id: "c-luis", full_name: "Luis López" } },
    { ...base, id: "gone", stage_id: "exit", discard: { reason: { group: "recruiter", key: "profile_mismatch" }, discarded_at: "2026-10-17T12:00:00Z", previous_stage_id: "new", recovery_stage_id: "new" }, candidate: { ...base.candidate, id: "c-gone", full_name: "Rosa Descartada" } },
  ] as typeof board.participations;
  return board;
}
async function open(url: string) {
  window.history.replaceState(null, "", url);
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: people() });
  const view = render(<MovementBoard vacancyId="vacancy" />);
  await screen.findByRole("button", { name: "Filtros" });
  return view;
}
/** A client-side navigation to the same pipeline (e.g. a notification link): the URL changes and Next re-renders, without a remount. */
function navigate(view: ReturnType<typeof render>, url: string) {
  window.history.pushState(null, "", url);
  view.rerender(<MovementBoard vacancyId="vacancy" />);
}
const params = () => new URL(window.location.href).searchParams;
it("opens the sheet of the candidate named by ?candidato= on load", async () => {
  await open("/empresa/vacantes/v/pipeline?candidato=luis");
  expect(await screen.findByRole("dialog", { name: "Luis López" })).toBeVisible();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
});
it("closing the sheet removes ?candidato= and keeps the other parameters", async () => {
  await open("/empresa/vacantes/v/pipeline?tab=pipeline&q=lu&candidato=luis");
  const sheet = await screen.findByRole("dialog", { name: "Luis López" });
  fireEvent.click(within(sheet).getByRole("button", { name: "Cerrar ficha" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Luis López" })).not.toBeInTheDocument());
  expect(params().has("candidato")).toBe(false);
  expect(params().get("q")).toBe("lu");
  expect(params().get("tab")).toBe("pipeline");
  expect(window.location.pathname).toBe("/empresa/vacantes/v/pipeline");
});
it.each([
  ["an id that is not on this board", "?candidato=someone-else"],
  ["a malformed id", "?candidato=%20%3Cscript%3E"],
  ["an empty id", "?candidato="],
  ["a candidate hidden by the search", "?q=ana&candidato=luis"],
])("opens nothing and reports nothing for %s", async (_case, query) => {
  await open(`/empresa/vacantes/v/pipeline${query}`);
  await waitFor(() => expect(loadBoardAction).toHaveBeenCalled());
  // Give a would-be opening effect its chance to run.
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(notifyActionResult).not.toHaveBeenCalled();
  expect(loadParticipationAction).not.toHaveBeenCalled();
  expect(screen.getByRole("region", { name: "Columnas del pipeline" })).toBeVisible();
});
it("a closed linked sheet stays closed, and opening by click does not write the URL", async () => {
  await open("/empresa/vacantes/v/pipeline?candidato=luis");
  const sheet = await screen.findByRole("dialog", { name: "Luis López" });
  fireEvent.click(within(sheet).getByRole("button", { name: "Cerrar ficha" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Ver detalle de Ana Pérez" }));
  expect(await screen.findByRole("dialog", { name: "Ana Pérez" })).toBeVisible();
  // Opening by click keeps the previous behavior: the URL is not written.
  expect(params().has("candidato")).toBe(false);
});
it("opens a discarded candidate's sheet too: a notification about someone later discarded still lands on them", async () => {
  await open("/empresa/vacantes/v/pipeline?candidato=gone");
  expect(await screen.findByRole("dialog", { name: "Rosa Descartada" })).toBeVisible();
});
it("follows a client-side navigation to a new or different ?candidato= on the mounted board", async () => {
  const view = await open("/empresa/vacantes/v/pipeline?q=");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  navigate(view, "/empresa/vacantes/v/pipeline?candidato=luis");
  expect(await screen.findByRole("dialog", { name: "Luis López" })).toBeVisible();
  navigate(view, "/empresa/vacantes/v/pipeline?candidato=ana");
  expect(await screen.findByRole("dialog", { name: "Ana Pérez" })).toBeVisible();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(loadBoardAction).toHaveBeenCalledTimes(1);
});
it("does not reopen a closed sheet for the same value, but a new navigation to it opens it again", async () => {
  const view = await open("/empresa/vacantes/v/pipeline?candidato=luis");
  fireEvent.click(within(await screen.findByRole("dialog", { name: "Luis López" })).getByRole("button", { name: "Cerrar ficha" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  view.rerender(<MovementBoard vacancyId="vacancy" />);
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  navigate(view, "/empresa/vacantes/v/pipeline?candidato=luis");
  expect(await screen.findByRole("dialog", { name: "Luis López" })).toBeVisible();
});
it("ignores a navigation to a candidate hidden by the current search", async () => {
  const view = await open("/empresa/vacantes/v/pipeline?q=ana");
  navigate(view, "/empresa/vacantes/v/pipeline?q=ana&candidato=luis");
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(notifyActionResult).not.toHaveBeenCalled();
});
it("without Next's search-params context, follows back/forward (popstate)", async () => {
  nav.context = false;
  await open("/empresa/vacantes/v/pipeline");
  window.history.pushState(null, "", "/empresa/vacantes/v/pipeline?candidato=luis");
  act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
  expect(await screen.findByRole("dialog", { name: "Luis López" })).toBeVisible();
});
