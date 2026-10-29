import { expect, it } from "vitest";
import { allowedMoveTargets, isBackwardMove, leavesPlacement, applyMoveToBoard } from "./helpers";
import { boardSchema, moveSchema } from "./model";
import { board as rawBoard, moved as rawMove, item, id } from "./test-fixtures";
const board = boardSchema.parse(rawBoard), moved = moveSchema.parse(rawMove);
it("allows exactly the next stage forward, all earlier stages backward, not same or exit", () => {
  expect(allowedMoveTargets(board, item).map(stage => stage.id)).toEqual([id(2)]);
  expect(allowedMoveTargets(board, { ...item, stage_id: id(4) }).map(stage => stage.id)).toEqual([id(1), id(2), id(3), id(5)]);
  expect(allowedMoveTargets(board, { ...item, stage_id: id(5) }).map(stage => stage.id)).toEqual([id(1), id(2), id(3), id(4)]);
  expect(allowedMoveTargets(board, { ...item, stage_id: id(6) })).toEqual([]);
});
it("tells backward moves (earlier stages) from the forward one by board order", () => {
  const at4 = { ...item, stage_id: id(4) };
  expect(allowedMoveTargets(board, at4).map(stage => isBackwardMove(board, at4, stage.id))).toEqual([true, true, true, false]);
  expect(isBackwardMove(board, item, id(2))).toBe(false);
});
it("requires a Placement exit confirmation only when leaving Placement for an allowed target", () => {
  expect(leavesPlacement(board, { ...item, stage_id: id(5) }, id(1))).toBe(true);
  expect(leavesPlacement(board, item, id(2))).toBe(false);
  expect(leavesPlacement(board, { ...item, stage_id: id(5) }, id(5))).toBe(false);
  expect(leavesPlacement(board, { ...item, stage_id: id(5) }, id(6))).toBe(false);
});
it("immutably replaces the moved item, recomputes all counts, orders by stage/time/id and takes server coverage", () => {
  const other = { ...item, id: id(9), stage_id: id(2), moved_at: "2026-10-16T13:00:00Z" };
  const before = { ...board, participations: [item, other] };
  const after = applyMoveToBoard(before, moved);
  expect(after.participations).toEqual([{ ...item, stage_id: moved.stage_id, moved_at: moved.moved_at, version: moved.version, etag: moved.etag }, other]);
  expect(after.stages.map(stage => stage.count)).toEqual([0, 2, 0, 0, 0]); expect(after.exit.count).toBe(0);
  expect(after.coverage).toEqual(moved.coverage); expect(before.participations[0]).toEqual(item); expect(board.stages[0].count).toBe(1);
  expect(applyMoveToBoard(after, moved)).toEqual(after);
});
