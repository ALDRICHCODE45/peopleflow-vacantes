import type { Board, Participation, Move } from "./model";
/** Order comes from the board, never from a hardcoded stage-kind sequence. */
export function allowedMoveTargets(board: Board, item: Participation): Board["stages"] {
  const current = board.stages.findIndex(stage => stage.id === item.stage_id);
  return current < 0 ? [] : board.stages.filter((_, index) => index < current || index === current + 1);
}
export function leavesPlacement(board: Board, item: Participation, target: string): boolean {
  return board.stages.some(stage => stage.id === item.stage_id && stage.kind === "placement")
    && allowedMoveTargets(board, item).some(stage => stage.id === target);
}
/** Confirmed moves replace, never append duplicates; milestone/coverage remain server-owned. */
export function applyMoveToBoard(board: Board, move: Move): Board {
  const { coverage, ...item } = move;
  const order = new Map([...board.stages, board.exit].map((stage, index) => [stage.id, index]));
  const participations = [...board.participations.filter(previous => previous.id !== item.id), item].sort((a, b) =>
    (order.get(a.stage_id) ?? Infinity) - (order.get(b.stage_id) ?? Infinity)
    || Date.parse(b.moved_at) - Date.parse(a.moved_at) || a.id.localeCompare(b.id));
  const counts = new Map<string, number>();
  for (const participation of participations) counts.set(participation.stage_id, (counts.get(participation.stage_id) ?? 0) + 1);
  return { ...board, participations, coverage, stages: board.stages.map(stage => ({ ...stage, count: counts.get(stage.id) ?? 0 })), exit: { ...board.exit, count: counts.get(board.exit.id) ?? 0 } };
}
