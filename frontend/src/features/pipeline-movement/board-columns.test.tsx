import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { BoardColumns } from "./board-columns";
import { boardFixture } from "./board-fixture";
import type { Board } from "./model";
import type { LateActions } from "./departure";

afterEach(cleanup);
const leftAt = "2026-11-17T18:00:00Z";
const late: LateActions = { creditOf: () => undefined, fallenOf: () => ({ id: "credit-1", participationId: "person", leftAt, status: "blocked", replacedBy: null }), fallenKnown: true, lateLocked: false, onLeave: () => {}, confirming: null };
function boardWith(group: "candidate" | "recruiter", leftPlacementStage: boolean): Board {
  const board = boardFixture();
  board.lifecycle = { ...board.lifecycle, kind: "original", close_reason: "filled", publication: "closed", process: "finished" } as Board["lifecycle"];
  board.participations[0] = { ...board.participations[0], stage_id: "exit", moved_at: leftAt, discard: { reason: { group, key: group === "candidate" ? "no_longer_interested" : "profile_mismatch" } as never, previous_stage_id: leftPlacementStage ? "hire" : "screen", recovery_stage_id: "screen", discarded_at: leftAt } };
  return board;
}
const render_ = (board: Board) => render(<BoardColumns board={board} pending={new Set()} locked={false} notices={{}} onMove={() => {}} onDetail={() => {}} onDisposition={() => {}} late={late} />);
const card = (board: Board) => document.getElementById(`candidate-card-${board.participations[0].id}`) as HTMLElement;

// axe color-contrast: the muted #6b6480 on the 5% review tint over the Descartados column is 4.49:1 (needs 4.5).
it("darkens the muted meta text on a «No se sostuvo» card so the review tint keeps 4.5:1", () => {
  const board = boardWith("candidate", true);
  render_(board);
  const node = card(board);
  expect(node).toHaveClass("bg-status-review/5");
  expect(node.className).toContain("[--muted-foreground:color-mix(in_oklab,var(--foreground)_80%,var(--card))]");
});
it("keeps the stock muted token on an ordinary discarded card", () => {
  const board = boardWith("recruiter", false);
  render_(board);
  expect(card(board)).not.toHaveClass("bg-status-review/5");
  expect(card(board).className).not.toContain("--muted-foreground");
});
