import { GitBranch, Users, type LucideIcon } from "lucide-react";
import type { Board, Participation } from "./model";
import type { FilterDimension } from "./filters";
import { discardCatalog } from "./discard-text";
import { substateDimension } from "./substates";
import { filterDataDimensions } from "./profile-filter-dimensions";

export type BoardFilterDimension<Item> = FilterDimension<Item> & {
  presentation?: {
    section: { key: string; label: string; icon: LucideIcon };
    label: string;
    placeholder: string;
    helper: string;
    singular: string;
    plural: string;
  };
};
const process = { key: "process", label: "PROCESO DE SELECCIÓN", icon: GitBranch };
const discarded = { key: "discarded", label: "CANDIDATOS DESCARTADOS", icon: Users };

/** Adding a filter requires only a declaration; UI and filtering share this catalog. */
export function boardFilterDimensions(board: Board): BoardFilterDimension<Participation>[] {
  return [{
    key: "column", label: "Columna",
    presentation: { section: process, label: "Etapa del pipeline", placeholder: "Todas las etapas", helper: "Elige una o varias etapas del proceso.", singular: "etapa", plural: "etapas" },
    options: [...board.stages, board.exit].map(stage => ({ value: stage.id, label: stage.name })),
    match: (item, selected) => selected.has(item.stage_id),
  }, ...(board.substates.length ? [{
    ...substateDimension(board),
    presentation: { section: process, label: "Subestado", placeholder: "Todos los subestados", helper: "Solo aplica a candidatos en «En proceso».", singular: "subestado", plural: "subestados" },
  }] : []), {
    key: "discard", label: "Motivo de descarte",
    presentation: { section: discarded, label: "Motivo de descarte", placeholder: "Todos los motivos", helper: "Agrupados por decisión de la empresa o del candidato.", singular: "motivo", plural: "motivos" },
    options: discardCatalog.flatMap(group => group.reasons.map(reason => ({ value: `${group.group}:${reason.key}`, label: reason.label, group: group.label }))),
    match: (item, selected) => !!item.discard && selected.has(`${item.discard.reason.group}:${item.discard.reason.key}`),
  }, ...filterDataDimensions(board)];
}
