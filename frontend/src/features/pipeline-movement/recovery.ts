import type { Board, Participation } from "./model";

export function recoverySelection(board: Board, item: Participation, required = false) {
  const discard = item.discard;
  const needsSelection = !!discard && (required || discard.previous_stage_id !== discard.recovery_stage_id || board.retired_stages.some(stage => stage.id === discard.previous_stage_id));
  const index = board.stages.findIndex(stage => stage.id === discard?.recovery_stage_id);
  return { required: needsSelection, stages: index < 0 ? [] : board.stages.slice(0, index + 1), defaultId: discard?.recovery_stage_id ?? null };
}
