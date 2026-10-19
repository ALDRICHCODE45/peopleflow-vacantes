import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CandidateSheet } from "./candidate-sheet";
import { loadHistoryAction } from "./actions";
import { boardFixture, detailFixture, historyFixture, vacancyId } from "./board-fixture";
vi.mock("./actions", () => ({ loadParticipationAction: vi.fn(async () => ({ ok: true, data: detailFixture() })), loadHistoryAction: vi.fn() }));
afterEach(cleanup);
it("renders not-applicable history with real current/retired names, actor/date and a muted distinct icon", async () => {
  const board = boardFixture();
  board.retired_stages = [{ id: "retired", kind: "custom", name: "Prueba técnica" }, { id: "screen", kind: "custom", name: "Nombre anterior" }];
  const actor = historyFixture().items[1].actor;
  const at = "2026-10-18T12:00:00Z";
  vi.mocked(loadHistoryAction).mockResolvedValue({ ok: true, data: { items: [
    ...["retired", "screen", "unknown"].map(stage_id => ({ kind: "not_applicable" as const, stage_id, actor, at })),
    { ...historyFixture().items[1], from_stage_id: "retired", to_stage_id: "screen", hire: false },
  ] } });
  render(<CandidateSheet vacancyId={vacancyId} item={board.participations[0]} board={board} onClose={vi.fn()} />);
  const tab = await screen.findByRole("tab", { name: "Historial 4" });
  await act(async () => { fireEvent.click(tab); });
  for (const name of ["Prueba técnica", "Revisión", "Columna eliminada"]) {
    const title = screen.getByText(`No aplica por cambio de proceso · ${name}`);
    const row = title.closest("li")!;
    expect(row).toHaveTextContent("Luis López · Reclutador");
    expect(row.querySelector("time")).toHaveAttribute("dateTime", at);
    expect(row.querySelector(".text-muted-foreground svg.lucide-circle-minus")).not.toBeNull();
    expect(within(row).queryByText("Contratación")).not.toBeInTheDocument();
  }
  expect(screen.getByText("Prueba técnica → Revisión")).toBeVisible();
  expect(screen.queryByText(/Nombre anterior/)).not.toBeInTheDocument();
});
