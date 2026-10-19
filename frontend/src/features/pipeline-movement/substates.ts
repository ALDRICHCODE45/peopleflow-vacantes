import type { Board, Participation } from "./model";
import type { FilterDimension } from "./filters";

export function substateDimension(board: Board): FilterDimension<Participation> {
  return { key: "substate", label: "Subestado", options: substateOptions(board),
    match: (item, selected) => isInProcess(board, item) && selected.has(item.substate_id ?? NO_SUBSTATE) };
}

// UUIDs cannot collide with the local control's null sentinel.
export const NO_SUBSTATE = "none";
export function substateOptions(board: Pick<Board, "substates">) {
  return [...board.substates.map(substate => ({ value: substate.id, label: substate.name })), { value: NO_SUBSTATE, label: "Sin subestado" }];
}
export function isInProcess(board: Board, item: Participation): boolean {
  return !item.discard && board.stages.some(stage => stage.id === item.stage_id && stage.kind === "in_process");
}
export function substateName(board: Board, id: string | null): string {
  return id === null ? "Sin subestado" : board.substates.find(substate => substate.id === id)?.name ?? "Subestado no disponible";
}
