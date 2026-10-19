import type { Board, Participation } from "./model";

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
/** OR within this dimension; callers AND it with any future board predicates. */
export function matchesSubstateFilter(board: Board, item: Participation, selected: readonly string[]): boolean {
  return selected.length === 0 || (isInProcess(board, item) && selected.includes(item.substate_id ?? NO_SUBSTATE));
}
export function toggleSubstateFilter(selected: readonly string[], id: string, checked: boolean): string[] {
  return checked ? [...new Set([...selected, id])] : selected.filter(value => value !== id);
}
