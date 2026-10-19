import type { Board, Participation } from "./model";
import type { FilterDimension } from "./filters";
import { discardCatalog } from "./discard-text";
import { substateDimension } from "./substates";

/** Adding a filter requires only a declaration; UI and filtering share this catalog. */
export function boardFilterDimensions(board: Board): FilterDimension<Participation>[] {
  return [substateDimension(board), {
    key: "column", label: "Columna",
    options: [...board.stages, board.exit].map(stage => ({ value: stage.id, label: stage.name })),
    match: (item, selected) => selected.has(item.stage_id),
  }, {
    key: "discard", label: "Motivo de descarte",
    options: discardCatalog.flatMap(group => group.reasons.map(reason => ({ value: `${group.group}:${reason.key}`, label: reason.label, group: group.label }))),
    match: (item, selected) => !!item.discard && selected.has(`${item.discard.reason.group}:${item.discard.reason.key}`),
  }];
}
