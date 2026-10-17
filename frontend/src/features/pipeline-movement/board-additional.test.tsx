// Real-primitive integration checks. Menu positioning and drag geometry remain
// browser boundaries; these tests deliberately do not open a menu portal.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MovementBoard } from "./board";
import { loadBoardAction, loadHistoryAction, loadParticipationAction, moveParticipationAction } from "./actions";
import { boardFixture, detailFixture, historyFixture, vacancyId } from "./board-fixture";
import type { Board, Result } from "./model";
vi.mock("./actions", () => ({ loadBoardAction: vi.fn(), loadHistoryAction: vi.fn(), loadParticipationAction: vi.fn(), moveParticipationAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: boardFixture() });
  vi.mocked(loadParticipationAction).mockResolvedValue({ ok: true, data: detailFixture() });
  vi.mocked(loadHistoryAction).mockResolvedValue({ ok: true, data: historyFixture() });
});
afterEach(cleanup);
it("real drag handle is independent of detail and menu; drop restrictions do not disable detail semantically", async () => {
  render(<MovementBoard vacancyId={vacancyId} />);
  const open = await screen.findByRole("button", { name: "Ver detalle de Ana Pérez" });
  expect(screen.getByRole("button", { name: "Arrastrar Ana Pérez" })).toHaveAttribute("aria-roledescription", "Tarjeta de candidato");
  expect(screen.getByRole("button", { name: "Mover a… Ana Pérez" })).toHaveAttribute("aria-haspopup", "menu");
  expect(screen.getByRole("region", { name: "Entrada: 1 candidatos" })).not.toHaveAttribute("aria-disabled");
  expect(open.closest("button")?.parentElement?.closest("button")).toBeNull();
  fireEvent.click(screen.getByText("CV Ana.pdf"));
  expect(await screen.findByRole("dialog", { name: "Ana Pérez" })).toBeVisible();
  expect(moveParticipationAction).not.toHaveBeenCalled();
});
it("ignores old-vacancy board reads after the route changes", async () => {
  let resolve!: (value: Result<Board>) => void;
  vi.mocked(loadBoardAction).mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  const { rerender } = render(<MovementBoard vacancyId={vacancyId} />);
  const next = boardFixture(); next.stages[0].name = "Otra entrada";
  vi.mocked(loadBoardAction).mockResolvedValueOnce({ ok: true, data: next });
  rerender(<MovementBoard vacancyId="other-vacancy" />);
  await screen.findByRole("heading", { name: "Otra entrada" });
  await act(async () => resolve({ ok: true, data: boardFixture() }));
  expect(screen.queryByRole("heading", { name: "Entrada" })).not.toBeInTheDocument();
});
