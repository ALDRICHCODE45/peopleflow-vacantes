import type { ProfileBody } from "../model";

export type Requirement = ProfileBody["competencies"][number];
export const textLength = (value: string | null | undefined) => Array.from(value?.trim() ?? "").length;

/** One set of requirements drives confirmation, row readiness and the save summary. */
export function requirementErrors(entry: Requirement, confirm: boolean) {
  const errors: Record<string, string> = {};
  if (entry.importance === "importance.no_relevante") return errors;
  if (!entry.desired_band) errors.desired_band = "Elige una banda deseada";
  if (entry.importance === "importance.clave" && ((confirm && !textLength(entry.task)) || textLength(entry.task) > 300)) errors.task = "Describe una tarea en 1 a 300 caracteres";
  if ((confirm && !textLength(entry.rationale)) || textLength(entry.rationale) > 1000) errors.rationale = "Justifica esta competencia en 1 a 1000 caracteres";
  return errors;
}
