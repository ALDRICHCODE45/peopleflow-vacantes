import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { loadBoardAction, setParticipationSubstateAction, moveParticipationAction } from "./actions";
import { boardFixture } from "./board-fixture";
import { useMovementBoard } from "./use-movement-board";
import { BoardColumns } from "./board-columns";
import { CandidateSheet } from "./candidate-sheet";
import { BoardSubstateFilter, SubstateSelect } from "./substate-controls";
import { matchesSubstateFilter, substateOptions } from "./substates";
import { boardSuccessCopy } from "./board-toast-copy";
import { applyParticipationToBoard } from "./helpers";
import type { Board, Move, Result } from "./model";
vi.mock("./actions", () => ({ loadBoardAction: vi.fn(), setParticipationSubstateAction: vi.fn(), moveParticipationAction: vi.fn(), loadHistoryAction: vi.fn(async () => ({ ok: true, data: { items: [] } })), loadParticipationAction: vi.fn(async () => ({ ok: false, reason: "no_response", reference: {} })) }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
function fixture(): Board {
  const board = boardFixture(); board.stages[2].kind = "in_process";
  board.substates = [{ id: "tech", name: "Entrevista técnica" }, { id: "offer", name: "Oferta" }];
  board.participations[0] = { ...board.participations[0], stage_id: "interview", substate_id: "tech" }; return board;
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: fixture() }); });
afterEach(cleanup);
it.each(["substate_requires_in_process", "version_conflict", "not_found", "uncertain", "unrecognized_response", "precondition_required"] as const)("substate %s reloads once without retry", async reason => {
  vi.mocked(setParticipationSubstateAction).mockResolvedValue({ ok: false, reason, reference: {} });
  const { result } = renderHook(() => useMovementBoard("vacancy")); await waitFor(() => expect(result.current.board).not.toBeNull());
  await act(async () => result.current.setSubstate("person", null));
  await waitFor(() => expect(loadBoardAction).toHaveBeenCalledTimes(2)); expect(setParticipationSubstateAction).toHaveBeenCalledTimes(1);
});
it("substate validation keeps the board with a clear persistent error", async () => {
  vi.mocked(setParticipationSubstateAction).mockResolvedValue({ ok: false, reason: "validation_error", reference: { status: 400 } });
  const { result } = renderHook(() => useMovementBoard("vacancy")); await waitFor(() => expect(result.current.board).not.toBeNull());
  await act(async () => result.current.setSubstate("person", null));
  await waitFor(() => expect(result.current.notices.person.text).toBe("No se guardó el subestado. Elige una opción del catálogo actual."));
  expect(result.current.board?.participations[0].substate_id).toBe("tech"); expect(loadBoardAction).toHaveBeenCalledTimes(1);
});
it("set/clear uses the same per-card mutex as moves, applies returned item and accepts no-op", async () => {
  let resolve!: (result: Result<Move>) => void;
  vi.mocked(setParticipationSubstateAction).mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  const { result } = renderHook(() => useMovementBoard("vacancy")); await waitFor(() => expect(result.current.board).not.toBeNull());
  act(() => { result.current.setSubstate("person", null); result.current.requestMove("person", "screen"); result.current.setSubstate("person", "offer"); });
  expect(setParticipationSubstateAction).toHaveBeenCalledTimes(1); expect(moveParticipationAction).not.toHaveBeenCalled(); expect(result.current.pending.has("person")).toBe(true);
  const board = fixture(); const data = { ...board.participations[0], substate_id: null, etag: '"cleared"', coverage: board.coverage };
  await act(async () => resolve({ ok: true, data }));
  expect(result.current.board?.participations[0]).toMatchObject({ substate_id: null, etag: '"cleared"' });
  vi.mocked(setParticipationSubstateAction).mockResolvedValue({ ok: true, data });
  await act(async () => result.current.setSubstate("person", null));
  await waitFor(() => expect(result.current.pending.size).toBe(0));
  expect(setParticipationSubstateAction).toHaveBeenLastCalledWith(expect.objectContaining({ etag: '"cleared"', body: { substate_id: null } }));
  expect(loadBoardAction).toHaveBeenCalledTimes(1);
});
it.each(["move", "discard"])("%s leaving in_process trusts the returned cleared substate and re-entry stays empty", operation => {
  const board = fixture(); const item = board.participations[0];
  const returned: Move = { ...item, substate_id: null, stage_id: operation === "move" ? "screen" : "exit", discard: operation === "move" ? null : { reason: { group: "recruiter", key: "profile_mismatch" }, previous_stage_id: "interview", discarded_at: item.moved_at }, coverage: board.coverage };
  const next = applyParticipationToBoard(board, returned);
  expect(next.participations[0].substate_id).toBeNull();
  const reentry = applyParticipationToBoard(next, { ...returned, discard: null, stage_id: "interview" });
  expect(reentry.participations[0].substate_id).toBeNull();
});
it("409 reconciles a stage changed elsewhere and rejects another substate write outside in_process", async () => {
  const refreshed = fixture(); refreshed.participations[0] = { ...refreshed.participations[0], stage_id: "screen", substate_id: null };
  vi.mocked(loadBoardAction).mockResolvedValueOnce({ ok: true, data: fixture() }).mockResolvedValueOnce({ ok: true, data: refreshed });
  vi.mocked(setParticipationSubstateAction).mockResolvedValue({ ok: false, reason: "substate_requires_in_process", reference: { status: 409 } });
  const { result } = renderHook(() => useMovementBoard("vacancy")); await waitFor(() => expect(result.current.board).not.toBeNull());
  await act(async () => result.current.setSubstate("person", "offer"));
  await waitFor(() => expect(result.current.board?.participations[0].stage_id).toBe("screen"));
  act(() => result.current.setSubstate("person", null));
  expect(setParticipationSubstateAction).toHaveBeenCalledTimes(1); expect(loadBoardAction).toHaveBeenCalledTimes(2);
});
it("OR filter includes null only in in_process; options preserve catalog order", () => {
  const board = fixture(); const item = board.participations[0];
  expect(substateOptions(board).map(option => option.label)).toEqual(["Entrevista técnica", "Oferta", "Sin subestado"]);
  expect(matchesSubstateFilter(board, item, [])).toBe(true);
  expect(matchesSubstateFilter(board, item, ["offer", "tech"])).toBe(true);
  expect(matchesSubstateFilter(board, { ...item, substate_id: null }, ["tech", "none"])).toBe(true);
  expect(matchesSubstateFilter(board, { ...item, stage_id: "new", substate_id: null }, ["none"])).toBe(false);
  expect(matchesSubstateFilter(board, item, ["none"])).toBe(false);
});
it("card shows only the active substate badge; filtering gives X de Y and empty copy", async () => {
  const board = fixture(); board.stages[2].count = 1;
  const props = { board, pending: new Set<string>(), locked: false, notices: {}, onMove: vi.fn(), onDetail: vi.fn(), onDisposition: vi.fn(), onSubstate: vi.fn() };
  const view = render(<BoardColumns {...props} />);
  expect(screen.getByText("Entrevista técnica").closest('[data-slot="badge"]')).toHaveAttribute("data-variant", "secondary");
  view.rerender(<BoardColumns {...props} substateFilter={["none"]} />);
  expect(screen.queryByRole("button", { name: "Ver detalle de Ana Pérez" })).not.toBeInTheDocument();
  expect(screen.getAllByText("Ningún candidato coincide con el filtro")).toHaveLength(5);
  expect(screen.getByText("0 de 1")).toBeVisible();
  view.rerender(<BoardColumns {...props} substateFilter={[]} />);
  expect(screen.getByRole("button", { name: "Ver detalle de Ana Pérez" })).toBeVisible();
  await act(async () => {});
});
it("filter announces selection count and clear resets it without writing", () => {
  const change = vi.fn(); render(<BoardSubstateFilter board={fixture()} value={["tech", "none"]} onChange={change} />);
  expect(screen.getByRole("button", { name: /Subestados.*2/ })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Limpiar" })); expect(change).toHaveBeenCalledWith([]);
  expect(setParticipationSubstateAction).not.toHaveBeenCalled();
});
it.each(["in_process", "custom", "discarded"])("selector only appears in in_process, not %s", async kind => {
  const board = fixture(); const item = { ...board.participations[0], ...(kind === "discarded" ? { stage_id: "exit" } : {}) }; board.stages[2].kind = kind === "discarded" ? "in_process" : kind as "custom" | "in_process";
  render(<CandidateSheet vacancyId="vacancy" item={item} board={board} onClose={vi.fn()} onSubstate={vi.fn()} />);
  expect(screen.queryByRole("combobox", { name: "Subestado" }) !== null).toBe(kind === "in_process");
  await act(async () => {});
});
it("select uses the current item, not stale detail, and exposes controlled value", () => {
  render(<SubstateSelect board={fixture()} item={fixture().participations[0]} onChange={vi.fn()} />);
  expect(screen.getByRole("combobox", { name: "Subestado" })).toHaveTextContent("Entrevista técnica");
});
it("substate toast names target and previous substate; clearing uses natural copy", () => {
  const board = fixture(), item = board.participations[0];
  expect(boardSuccessCopy(board, { ...item, substate_id: null }, { kind: "substate", substateId: "tech" }, { ...item, coverage: board.coverage })).toEqual({ title: "Ana Pérez quedó en «Entrevista técnica»", description: "Antes: Sin subestado." });
  expect(boardSuccessCopy(board, item, { kind: "substate", substateId: null }, { ...item, substate_id: null, coverage: board.coverage })).toEqual({ title: "Ana Pérez quedó sin subestado", description: "Antes: Entrevista técnica." });
});
