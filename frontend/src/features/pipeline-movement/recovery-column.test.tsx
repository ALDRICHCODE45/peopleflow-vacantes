import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ComponentProps, ReactNode } from "react";
import { DispositionDialog } from "./disposition-dialog";
import { boardFixture } from "./board-fixture";
import { useMovementBoard } from "./use-movement-board";
import { loadBoardAction, recoverParticipationAction } from "./actions";
vi.mock("./actions", () => ({ loadBoardAction: vi.fn(), recoverParticipationAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/actions", () => ({ loadDraftPipelineAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/delivery-actions", () => ({ loadDeliveryStatusAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
// Like board.test.tsx, replace Select's jsdom portal/focus boundary only.
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  type Value = { value: string | null; items: { value: string; label: string }[]; change: (value: string) => void };
  const Context = React.createContext<Value>({ value: null, items: [], change: () => {} });
  return {
    Select: ({ value, items, onValueChange, children }: Value & { onValueChange: Value["change"]; children: ReactNode }) => <Context.Provider value={{ value, items, change: onValueChange }}>{children}</Context.Provider>,
    SelectTrigger: ({ children, ...props }: ComponentProps<"button">) => <button role="combobox" aria-expanded="true" aria-controls="recovery-options" {...props}>{children}</button>,
    SelectValue: () => { const context = React.useContext(Context); return context.items.find(item => item.value === context.value)?.label; },
    SelectContent: ({ children }: { children: ReactNode }) => <div role="listbox" id="recovery-options">{children}</div>,
    SelectGroup: ({ children }: { children: ReactNode }) => <div role="group">{children}</div>,
    SelectItem: ({ value, children }: { value: string; children: ReactNode }) => { const context = React.useContext(Context); return <button role="option" aria-selected={context.value === value} onClick={() => context.change(value)}>{children}</button>; },
  };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function fixture(removed = true) {
  const board = boardFixture();
  board.retired_stages = removed ? [{ id: "retired", kind: "custom", name: "Prueba técnica" }] : [];
  board.participations[0] = { ...board.participations[0], stage_id: "exit", discard: { reason: { group: "candidate", key: "unresponsive" }, previous_stage_id: removed ? "retired" : "screen", recovery_stage_id: "screen", discarded_at: board.participations[0].moved_at } };
  return board;
}
it("offers the suggested recovery and only earlier current stages inside confirmation details", async () => {
  const board = fixture(); const confirm = vi.fn();
  render(<DispositionDialog disposition={{ kind: "recover", item: board.participations[0], placementConfirmation: false }} board={board} pending={false} stale={false} reading={false} onClose={vi.fn()} onConfirm={confirm} finalFocus={() => null} />);
  const dialog = screen.getByRole("alertdialog");
  expect(dialog).toHaveTextContent("Su columna anterior, «Prueba técnica», ya no existe.");
  const select = within(dialog).getByRole("combobox", { name: "Columna de regreso" });
  expect(select.closest('[data-slot="confirm-action-details"]')).not.toBeNull();
  expect(select).toHaveTextContent("Revisión (sugerida)");
  fireEvent.click(select);
  expect((await screen.findAllByRole("option")).map(option => option.textContent)).toEqual(["Entrada", "Revisión (sugerida)"]);
  fireEvent.click(screen.getByRole("option", { name: "Entrada" }));
  await waitFor(() => expect(select).toHaveTextContent("Entrada"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Recuperar" }));
  expect(confirm).toHaveBeenCalledWith({ to_stage_id: "new" });
});
it("refreshes recovery_stage_required and waits for another explicit confirmation with the refreshed ETag", async () => {
  vi.mocked(loadBoardAction).mockResolvedValueOnce({ ok: true, data: fixture(false) }).mockResolvedValue({ ok: true, data: { ...fixture(), participations: [{ ...fixture().participations[0], etag: '"fresh"' }] } });
  vi.mocked(recoverParticipationAction).mockResolvedValue({ ok: false, reason: "recovery_stage_required", reference: { status: 409 } });
  const { result } = renderHook(() => useMovementBoard("vacancy"));
  await waitFor(() => expect(result.current.reading).toBe(false));
  act(() => result.current.requestDisposition("person", "recover"));
  await act(async () => result.current.confirmDisposition());
  expect(loadBoardAction).toHaveBeenCalledTimes(2);
  expect(result.current.disposition?.item.discard?.previous_stage_id).toBe("retired");
  expect(recoverParticipationAction).toHaveBeenCalledTimes(1);
  await act(async () => result.current.confirmDisposition({ to_stage_id: "new" }));
  expect(recoverParticipationAction).toHaveBeenLastCalledWith({ vacancyId: "vacancy", participationId: "person", etag: '"fresh"', body: { to_stage_id: "new" } });
});
