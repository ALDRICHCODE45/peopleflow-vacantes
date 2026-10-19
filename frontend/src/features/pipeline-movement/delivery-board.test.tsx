import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { BoardDelivery } from "./board-delivery";
import { useMovementBoard } from "./use-movement-board";
import { boardFixture } from "./board-fixture";
import { loadBoardAction, moveParticipationAction, discardParticipationAction, recoverParticipationAction, setParticipationSubstateAction } from "./actions";
import { loadDeliveryStatusAction } from "@/features/jobs/drafts/pipeline/delivery-actions";
import type { DeliveryStatusActionResult } from "@/features/jobs/drafts/pipeline/delivery-actions";
import type { Move, Result } from "./model";
import { notifyActionResult } from "@/components/feedback/notify";
vi.mock("./actions", () => ({ loadBoardAction: vi.fn(), moveParticipationAction: vi.fn(), discardParticipationAction: vi.fn(), recoverParticipationAction: vi.fn(), setParticipationSubstateAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/delivery-actions", () => ({ loadDeliveryStatusAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
// Base UI's tooltip focus/positioning portal loops in jsdom. Keep the product
// trigger, date and focus behavior; verify the real portal in browser review.
vi.mock("@/components/ui/tooltip", async () => {
  const React = await import("react");
  const Context = React.createContext({ open: false, change: (value: boolean) => { void value; } });
  return {
    Tooltip: ({ children }: { children: React.ReactNode }) => { const [open, change] = React.useState(false); return <Context.Provider value={{ open, change }}>{children}</Context.Provider>; },
    TooltipTrigger: ({ render }: { render: React.ReactElement<React.HTMLAttributes<HTMLElement>> }) => { const { change } = React.useContext(Context); return React.cloneElement(render, { onFocus: () => change(true) }); },
    TooltipContent: ({ children }: { children: React.ReactNode }) => React.useContext(Context).open ? <div role="tooltip">{children}</div> : null,
  };
});
vi.mock("./use-board-column-order", () => ({ useBoardColumnOrder: (_id: string, board: unknown) => ({ board }) }));
const pending = { state: "pending" as const, delivered: 0, target: 1, cutoff_stage_id: "screen", commitment_date: "2026-10-20", business_days_remaining: 4, fulfillment: null };
const fulfillment = { fulfilled_at: "2026-10-16T12:00:00Z", result: "on_time" as const, business_days_delta: 2, target: 1, cutoff_stage_id: "screen", cutoff_stage_name: "Screening OK", commitment_date: "2026-10-20", candidates: [{ participation_id: "person", candidate: { id: "candidate", full_name: "Ana Pérez" }, reached_at: "2026-10-16T12:00:00Z" }] };
const fulfilled = { ...pending, state: "fulfilled" as const, delivered: 1, business_days_remaining: null, fulfillment };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: boardFixture() }); vi.mocked(loadDeliveryStatusAction).mockResolvedValue({ ok: true, status: pending }); });
afterEach(cleanup);
it.each([[4, "Faltan 4 días hábiles"], [1, "Falta 1 día hábil"], [0, "Vence hoy"], [-2, "Venció hace 2 días hábiles"]])("shows server business-day remainder %s beside progress", (remaining, copy) => {
  render(<BoardDelivery delivery={{ state: "pending", delivered: 3, target: 5 }} status={{ ...pending, delivered: 3, target: 5, business_days_remaining: remaining }} />);
  expect(screen.getByText("3 de 5 candidatos")).toBeVisible(); expect(screen.getByText(copy)).toBeVisible(); expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "60");
});
it.each([["on_time", 0, "Entregada a tiempo", "text-status-success"], ["on_time", 3, "Entregada 3 días hábiles antes", "text-status-success"], ["late", -2, "Entregada con 2 días hábiles de retraso", "text-status-danger"]] as const)("shows frozen %s/%s with semantic result", (result, delta, copy, tone) => {
  render(<BoardDelivery delivery={{ state: "fulfilled", delivered: 1, target: 1 }} status={{ ...fulfilled, fulfillment: { ...fulfillment, result, business_days_delta: delta } }} />);
  expect(screen.getByText(copy)).toHaveClass(tone); expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
});
it("offers the fulfilled date in a keyboard-reachable tooltip", async () => {
  const user = userEvent.setup(); render(<BoardDelivery delivery={{ state: "fulfilled", delivered: 1, target: 1 }} status={fulfilled} />);
  await user.tab(); expect(screen.getByText("Entregada 2 días hábiles antes")).toHaveFocus();
  expect(await screen.findByRole("tooltip")).toHaveTextContent("Cumplida el 16 oct 2026, 06:00");
});
it("ignores an older status response after a write flips delivery", async () => {
  let initial!: (value: DeliveryStatusActionResult) => void;
  vi.mocked(loadDeliveryStatusAction).mockReturnValueOnce(new Promise(resolve => { initial = resolve; })).mockResolvedValue({ ok: true, status: fulfilled });
  const board = boardFixture();
  vi.mocked(moveParticipationAction).mockResolvedValue({ ok: true, data: { ...board.participations[0], stage_id: "screen", coverage: board.coverage, delivery: { state: "fulfilled", delivered: 1, target: 1 } } });
  const { result } = renderHook(() => useMovementBoard("vacancy")); await waitFor(() => expect(result.current.board).not.toBeNull());
  act(() => { result.current.requestMove("person", "screen"); result.current.confirmMove(); });
  await waitFor(() => expect(result.current.deliveryStatus?.state).toBe("fulfilled"));
  await act(async () => initial({ ok: true, status: pending }));
  expect(result.current.deliveryStatus?.state).toBe("fulfilled");
});
it("reconciliation reloads status once without replaying a conflicted write", async () => {
  const board = boardFixture();
  vi.mocked(loadBoardAction).mockResolvedValueOnce({ ok: true, data: board }).mockResolvedValue({ ok: true, data: { ...board, delivery: { state: "fulfilled", delivered: 1, target: 1 } } });
  vi.mocked(loadDeliveryStatusAction).mockResolvedValueOnce({ ok: true, status: pending }).mockResolvedValue({ ok: true, status: fulfilled });
  vi.mocked(moveParticipationAction).mockResolvedValue({ ok: false, reason: "version_conflict", reference: { status: 412 } });
  const { result } = renderHook(() => useMovementBoard("vacancy")); await waitFor(() => expect(result.current.board).not.toBeNull());
  act(() => { result.current.requestMove("person", "screen"); result.current.confirmMove(); });
  await waitFor(() => expect(result.current.deliveryStatus?.state).toBe("fulfilled"));
  expect(loadDeliveryStatusAction).toHaveBeenCalledTimes(2); expect(moveParticipationAction).toHaveBeenCalledTimes(1);
  expect(vi.mocked(notifyActionResult).mock.calls.filter(([value]) => value.title === "Entrega cumplida")).toHaveLength(0);
});
it("an older overlapping pending write cannot erase fulfillment even if final reconciliation fails", async () => {
  const board = boardFixture(); board.participations.push({ ...board.participations[0], id: "second" });
  vi.mocked(loadBoardAction).mockResolvedValueOnce({ ok: true, data: board }).mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
  vi.mocked(loadDeliveryStatusAction).mockResolvedValueOnce({ ok: true, status: pending }).mockResolvedValue({ ok: true, status: fulfilled });
  let first!: (value: Result<Move>) => void, second!: (value: Result<Move>) => void;
  vi.mocked(moveParticipationAction).mockReturnValueOnce(new Promise(resolve => { first = resolve; })).mockReturnValueOnce(new Promise(resolve => { second = resolve; }));
  const { result } = renderHook(() => useMovementBoard("vacancy")); await waitFor(() => expect(result.current.board).not.toBeNull());
  act(() => { result.current.requestMove("person", "screen"); result.current.confirmMove(); result.current.requestMove("second", "screen"); result.current.confirmMove(); });
  await act(async () => second({ ok: true, data: { ...board.participations[1], stage_id: "screen", coverage: board.coverage, delivery: { state: "fulfilled", delivered: 1, target: 1 } } }));
  await act(async () => first({ ok: true, data: { ...board.participations[0], stage_id: "screen", coverage: board.coverage, delivery: board.delivery } }));
  expect(result.current.board?.delivery.state).toBe("fulfilled"); expect(result.current.stale).toBe(true);
  expect(vi.mocked(notifyActionResult).mock.calls.filter(([value]) => value.title === "Entrega cumplida")).toHaveLength(1);
  expect(moveParticipationAction).toHaveBeenCalledTimes(2);
});
it.each(["discard", "recover", "substate"] as const)("%s adopts the delivery write response without another status read for unchanged delivery", async kind => {
  const board = boardFixture(); board.stages[0].kind = "in_process";
  if (kind === "substate") { board.substates = [{ id: "tech", name: "Técnica" }]; board.participations[0].substate_id = "tech"; }
  if (kind === "recover") board.participations[0] = { ...board.participations[0], stage_id: "exit", discard: { reason: { group: "recruiter", key: "profile_mismatch" }, previous_stage_id: "new", recovery_stage_id: "new", discarded_at: "2026-10-16T12:00:00Z" } };
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: board });
  const action = kind === "discard" ? discardParticipationAction : kind === "recover" ? recoverParticipationAction : setParticipationSubstateAction;
  vi.mocked(action).mockResolvedValue({ ok: true, data: { ...board.participations[0], coverage: board.coverage, delivery: board.delivery } });
  const { result } = renderHook(() => useMovementBoard("vacancy")); await waitFor(() => expect(result.current.board).not.toBeNull());
  act(() => { if (kind === "substate") { result.current.setSubstate("person", null); result.current.confirmSubstate(); } else result.current.requestDisposition("person", kind); });
  if (kind !== "substate") act(() => result.current.confirmDisposition(kind === "discard" ? { reason: { group: "recruiter", key: "profile_mismatch" } } : undefined));
  await waitFor(() => expect(result.current.pending.size).toBe(0));
  expect(result.current.board?.delivery).toEqual(board.delivery); expect(loadDeliveryStatusAction).toHaveBeenCalledTimes(1);
  expect(action).toHaveBeenCalledTimes(1);
});
it.each([false, true])("applies delivery from write, reads details once and emits honest fulfillment toast (read failure=%s)", async fail => {
  const board = boardFixture(); const item = board.participations[0];
  vi.mocked(moveParticipationAction).mockResolvedValue({ ok: true, data: { ...item, stage_id: "screen", coverage: board.coverage, delivery: { state: "fulfilled", delivered: 1, target: 1 } } });
  vi.mocked(loadDeliveryStatusAction).mockResolvedValueOnce({ ok: true, status: pending }).mockResolvedValue(fail ? { ok: false, reason: "no_response", reference: {} } : { ok: true, status: fulfilled });
  const { result } = renderHook(() => useMovementBoard("vacancy")); await waitFor(() => expect(result.current.board).not.toBeNull());
  act(() => { result.current.requestMove(item.id, "screen"); result.current.confirmMove(); });
  await waitFor(() => expect(result.current.board?.delivery.state).toBe("fulfilled"));
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ title: "Entrega cumplida", description: fail ? "Se alcanzó el objetivo de entrega." : "1 de 1 candidatos llegaron a «Screening OK» · a tiempo (2 días hábiles antes)" })));
  expect(loadDeliveryStatusAction).toHaveBeenCalledTimes(2); expect(moveParticipationAction).toHaveBeenCalledTimes(1);
});
