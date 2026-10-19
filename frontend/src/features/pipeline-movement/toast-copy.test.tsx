import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { notifyActionResult } from "@/components/feedback/notify";
import { loadDraftPipelineAction } from "@/features/jobs/drafts/pipeline/actions";
import { discardParticipationAction, loadBoardAction, moveParticipationAction, recoverParticipationAction } from "./actions";
import { boardFixture, vacancyId } from "./board-fixture";
import { moveErrorCopy, reconciliationCopy } from "./board-feedback";
import type { Board, DiscardBody, Move, Result } from "./model";
import { useMovementBoard } from "./use-movement-board";

vi.mock("./actions", () => ({ loadBoardAction: vi.fn(), moveParticipationAction: vi.fn(), discardParticipationAction: vi.fn(), recoverParticipationAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/actions", () => ({ loadDraftPipelineAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
const reason = { group: "recruiter", key: "requirements_not_met" } as const;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadDraftPipelineAction).mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
});
afterEach(cleanup);
async function mount(stage = "new", previous?: string) {
  const board = boardFixture();
  board.participations[0].stage_id = stage;
  if (previous) board.participations[0].discard = { reason, previous_stage_id: previous, recovery_stage_id: previous, discarded_at: "2026-10-18T12:00:00Z" };
  // Deliberately different from write coverage: copy must use the response.
  board.coverage.covered = 7;
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: board });
  const hook = renderHook(() => useMovementBoard(vacancyId));
  await waitFor(() => expect(hook.result.current.reading).toBe(false));
  return { ...hook, board };
}
it("keeps a different candidate's confirmation during reconciliation, blocks its stale write and permits cancellation", async () => {
  const board = boardFixture();
  board.participations.push({ ...board.participations[0], id: "second", stage_id: "hire" });
  vi.mocked(loadBoardAction).mockResolvedValueOnce({ ok: true, data: board }).mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
  let resolve!: (value: Result<Move>) => void;
  vi.mocked(moveParticipationAction).mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  const { result } = renderHook(() => useMovementBoard(vacancyId));
  await waitFor(() => expect(result.current.reading).toBe(false));
  act(() => { result.current.requestMove("person", "screen"); result.current.confirmMove(); result.current.requestMove("second", "screen"); });
  await act(async () => resolve({ ok: false, reason: "uncertain", reference: {} }));
  expect(result.current.confirmation?.item.id).toBe("second");
  expect(result.current.stale).toBe(true);
  act(() => result.current.confirmMove());
  expect(moveParticipationAction).toHaveBeenCalledTimes(1);
  act(() => result.current.closeConfirmation());
  expect(result.current.confirmation).toBeNull();
  expect(loadBoardAction).toHaveBeenCalledTimes(2);
});

function response(board: Board, stage: string, required: number | null = 2, covered = 1): Move {
  return { delivery: board.delivery, ...board.participations[0], stage_id: stage, discard: null, coverage: { covered, required, full_coverage_reached_at: null } };
}
function toast(title: string, description: string, type = "success") {
  expect(notifyActionResult).toHaveBeenLastCalledWith(expect.objectContaining({ key: "pipeline-move-person", type, title, description }));
  const actual = vi.mocked(notifyActionResult).mock.calls.at(-1)![0];
  expect(actual.title).not.toBe(actual.description);
}
it.each([
  ["new", "screen", 2, 0, "Ana Pérez pasó a Revisión", "Antes estaba en Entrada. El cambio queda en su historial."],
  ["interview", "hire", 2, 1, "Ana Pérez llegó a Contratación", "Se cubrió una plaza: ahora 1 de 2 cubiertas."],
  ["interview", "hire", null, 3, "Ana Pérez llegó a Contratación", "Se cubrió una plaza: 3 cubiertas."],
  ["interview", "hire", 2, 2, "Ana Pérez llegó a Contratación", "Cobertura completa: 2 de 2 plazas."],
  ["hire", "screen", 2, 0, "Ana Pérez salió de Contratación", "Se liberó una plaza: 0 de 2 cubiertas. Su contratación queda en el historial."],
  ["hire", "screen", null, 0, "Ana Pérez salió de Contratación", "Se liberó una plaza: 0 cubiertas. Su contratación queda en el historial."],
] as const)("move %s → %s (%s required, %s covered) gives a specific consequence", async (from, to, required, covered, title, description) => {
  const { result, board } = await mount(from);
  vi.mocked(moveParticipationAction).mockResolvedValue({ ok: true, data: response(board, to, required, covered) });
  await act(async () => result.current.requestMove("person", to));
  await act(async () => result.current.confirmMove());
  toast(title, description);
});
it.each([
  ["screen", false, "Motivo: No cumple requisitos. Puedes recuperar su postulación desde Descartados."],
  ["screen", true, "Motivo: No cumple requisitos. Verá el estado Finalizada con tu mensaje."],
  ["hire", false, "Motivo: No cumple requisitos. Se liberó una plaza: 0 de 2 cubiertas."],
  ["hire", true, "Motivo: No cumple requisitos. Verá el estado Finalizada con tu mensaje; se liberó una plaza: 0 de 2 cubiertas."],
] as const)("discard from %s, message %s, names the reason and consequence", async (from, message, description) => {
  const { result, board } = await mount(from);
  vi.mocked(discardParticipationAction).mockResolvedValue({ ok: true, data: { ...response(board, "exit", 2, 0), discard: { reason, previous_stage_id: from, recovery_stage_id: from, discarded_at: "2026-10-18T12:00:00Z" } } });
  act(() => result.current.requestDisposition("person", "discard"));
  const body: DiscardBody = { reason, ...(message ? { candidate_message: "Gracias por participar" } : {}) };
  await act(async () => result.current.confirmDisposition(body));
  toast("Descartaste a Ana Pérez", description);
});
it.each([
  ["screen", 2, "Volvió a Revisión. El descarte queda en su historial."],
  ["hire", 2, "Volvió a Contratación y ocupa una plaza: 1 de 2 cubiertas."],
  ["hire", null, "Volvió a Contratación y ocupa una plaza: 1 cubiertas."],
] as const)("recovery into %s (%s required) explains the restored stage", async (previous, required, description) => {
  const { result, board } = await mount("exit", previous);
  vi.mocked(recoverParticipationAction).mockResolvedValue({ ok: true, data: response(board, previous, required) });
  act(() => result.current.requestDisposition("person", "recover"));
  await act(async () => result.current.confirmDisposition());
  toast("Recuperaste a Ana Pérez", description);
});
it.each([
  ["move", "No se movió a Ana Pérez"], ["discard", "No se descartó a Ana Pérez"], ["recover", "No se recuperó a Ana Pérez"],
] as const)("%s errors separate the failed action from existing guidance", async (kind, title) => {
  const { result } = await mount(kind === "recover" ? "exit" : "screen", kind === "recover" ? "screen" : undefined);
  const failure = { ok: false, reason: "validation_error", reference: { status: 400, code: "validation_error" } } as const;
  vi.mocked(moveParticipationAction).mockResolvedValue(failure);
  vi.mocked(discardParticipationAction).mockResolvedValue(failure);
  vi.mocked(recoverParticipationAction).mockResolvedValue(failure);
  if (kind === "move") await act(async () => { result.current.requestMove("person", "new"); result.current.confirmMove(); });
  else {
    act(() => result.current.requestDisposition("person", kind));
    await act(async () => result.current.confirmDisposition(kind === "discard" ? { reason } : undefined));
  }
  toast(title, kind === "move" ? moveErrorCopy("validation_error") : kind === "recover" ? "No se recuperó. Revisa la columna de regreso y elige una opción permitida antes de confirmar otra vez." : "No se guardó. Revisa los datos e intenta de nuevo.", "error");
  expect(notifyActionResult).toHaveBeenLastCalledWith(expect.objectContaining({ reference: { status: 400, code: "validation_error", at: expect.any(String) } }));
});
it.each([true, false])("reconciliation (read success %s) preserves the existing explanation", async refreshed => {
  const { result } = await mount();
  vi.mocked(moveParticipationAction).mockResolvedValue({ ok: false, reason: "version_conflict", reference: { status: 412 } });
  if (!refreshed) vi.mocked(loadBoardAction).mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} });
  await act(async () => { result.current.requestMove("person", "screen"); result.current.confirmMove(); });
  toast("Actualizamos el tablero", reconciliationCopy("version_conflict", refreshed), "error");
  expect(moveParticipationAction).toHaveBeenCalledTimes(1);
});
it("copy follows candidate identity, renamed stages and the discard catalog, never the internal comment", async () => {
  const board = boardFixture();
  board.participations[0].candidate.full_name = "Alex Rivera";
  board.stages[0].name = "Nuevos";
  board.stages[1].name = "Screening";
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: board });
  const { result } = renderHook(() => useMovementBoard(vacancyId));
  await waitFor(() => expect(result.current.reading).toBe(false));
  vi.mocked(moveParticipationAction).mockResolvedValue({ ok: true, data: response(board, "screen") });
  await act(async () => { result.current.requestMove("person", "screen"); result.current.confirmMove(); });
  toast("Alex Rivera pasó a Screening", "Antes estaba en Nuevos. El cambio queda en su historial.");
  vi.mocked(discardParticipationAction).mockResolvedValue({ ok: true, data: { ...response(board, "exit"), discard: { reason: { group: "candidate", key: "accepted_other_offer" }, previous_stage_id: "screen", recovery_stage_id: "screen", discarded_at: "2026-10-18T12:00:00Z" } } });
  act(() => result.current.requestDisposition("person", "discard"));
  await act(async () => result.current.confirmDisposition({ reason: { group: "candidate", key: "accepted_other_offer" }, comment: "Solo para la empresa" }));
  toast("Descartaste a Alex Rivera", "Motivo: Aceptó otra oferta. Puedes recuperar su postulación desde Descartados.");
});
