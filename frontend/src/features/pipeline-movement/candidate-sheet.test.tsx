import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CandidateSheet } from "./candidate-sheet";
import { loadHistoryAction, loadParticipationAction } from "./actions";
import { boardFixture, detailFixture, historyFixture, vacancyId } from "./board-fixture";
import type { History, Result } from "./model";
vi.mock("./actions", () => ({ loadHistoryAction: vi.fn(), loadParticipationAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadParticipationAction).mockResolvedValue({ ok: true, data: detailFixture() });
  vi.mocked(loadHistoryAction).mockResolvedValue({ ok: true, data: historyFixture() });
});
afterEach(cleanup);
function SheetHarness() {
  const [open, setOpen] = useState(true);
  const board = boardFixture();
  return open ? <CandidateSheet vacancyId={vacancyId} item={board.participations[0]} board={board} onClose={() => setOpen(false)} /> : null;
}
it("sheet loading is independent, closes with a Spanish button, and ignores the late read", async () => {
  let resolve!: (value: Result<History>) => void;
  vi.mocked(loadHistoryAction).mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  render(<SheetHarness />);
  const sheet = await screen.findByRole("dialog", { name: "Ana Pérez" });
  expect(within(sheet).getByRole("status")).toHaveTextContent("Cargando detalle e historial");
  expect(sheet.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3);
  fireEvent.click(within(sheet).getByRole("button", { name: "Cerrar" }));
  await act(async () => resolve({ ok: true, data: historyFixture() }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("a rejected detail load offers retry; screening/history display no invented scores", async () => {
  vi.mocked(loadParticipationAction).mockRejectedValueOnce(new Error("offline"));
  render(<SheetHarness />);
  const sheet = await screen.findByRole("dialog", { name: "Ana Pérez" });
  fireEvent.click(await within(sheet).findByRole("button", { name: "Reintentar" }));
  expect(await within(sheet).findByText("¿Disponibilidad?")).toBeVisible();
  expect(sheet).not.toHaveTextContent(/Compatibilidad|Puntuación|Correcta|Experiencia/);
  expect(loadParticipationAction).toHaveBeenCalledTimes(2);
});
