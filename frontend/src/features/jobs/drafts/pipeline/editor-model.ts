import { collapseUnicodeWhiteSpace, trimUnicodeWhiteSpace } from "../text";

export const STAGE_KIND_LABELS = {
  new: "Nuevos",
  screening: "Screening",
  screening_ok: "Screening OK",
  in_process: "En proceso",
  placement: "Placement",
  custom: "Columna propia",
  discarded: "Descartados",
} as const;

export type StageKind = keyof typeof STAGE_KIND_LABELS;
export type ProgressionKind = Exclude<StageKind, "discarded">;
export type PipelineLimits = { maxCustomStages: number; nameMaxLength: number };

/** Local wire types: this pure module does not depend on the server-only client. */
export type EditorPipeline = {
  version: string;
  stages: { id: string; kind: ProgressionKind; name: string }[];
  exit: { id: string; kind: "discarded"; name: string };
  limits: PipelineLimits;
};

export type PipelinePutBody = {
  stages: { id?: string; name: string }[];
  exit: { id: string; name: string };
};

export type EditorStage = {
  key: string;
  id: string | null;
  kind: ProgressionKind;
  name: string;
};
export type EditorExit = { key: string; id: string; kind: "discarded"; name: string };
export type PipelineEditorState = {
  stages: EditorStage[];
  exit: EditorExit;
  limits: PipelineLimits;
  baseline: EditorPipeline;
  /** State-local counter: deterministic, no randomness/global state, no key reuse after removal. */
  nextCustomKey: number;
};

export type StageNameError = "required" | "too_long" | "control_character";
export type EditorError = StageNameError | "duplicate" | "invalid_structure" | "too_many_custom_stages";
export type MoveDirection = "up" | "down";

export function normalizeStageName(raw: string): string {
  return trimUnicodeWhiteSpace(collapseUnicodeWhiteSpace(raw.normalize("NFC")));
}

/** Approximation of Go cases.Fold agreed in L3; the server remains authoritative. */
export function stageNameKey(normalized: string): string {
  return normalized.toUpperCase().toLowerCase().normalize("NFC");
}

export function stageNameError(raw: string, limits: PipelineLimits): StageNameError | null {
  const name = normalizeStageName(raw);
  if (name === "") return "required";
  if (Array.from(name).length > limits.nameMaxLength) return "too_long";
  // Unicode Cc is precisely C0 + DEL + C1. White_Space controls have already
  // been collapsed to ASCII space, so only forbidden controls remain here.
  for (const character of name) {
    const point = character.codePointAt(0)!;
    if (point <= 0x1f || (point >= 0x7f && point <= 0x9f)) return "control_character";
  }
  return null;
}

export function editorFromPipeline(pipeline: EditorPipeline): PipelineEditorState {
  return {
    stages: pipeline.stages.map((stage) => ({ ...stage, key: stage.id })),
    exit: { ...pipeline.exit, key: pipeline.exit.id },
    limits: { ...pipeline.limits },
    baseline: {
      version: pipeline.version,
      stages: pipeline.stages.map((stage) => ({ ...stage })),
      exit: { ...pipeline.exit },
      limits: { ...pipeline.limits },
    },
    nextCustomKey: 1,
  };
}

export function renameStage(state: PipelineEditorState, key: string, name: string): PipelineEditorState {
  if (state.exit.key === key) {
    return state.exit.name === name ? state : { ...state, exit: { ...state.exit, name } };
  }
  const stage = state.stages.find((entry) => entry.key === key);
  if (!stage || stage.name === name) return state;
  return { ...state, stages: state.stages.map((entry) => entry.key === key ? { ...entry, name } : entry) };
}

export function canMove(state: PipelineEditorState, key: string, direction: MoveDirection): boolean {
  const index = state.stages.findIndex((entry) => entry.key === key);
  const stage = state.stages[index];
  if (!stage || stage.kind === "new" || stage.kind === "placement") return false;
  const neighbor = state.stages[index + (direction === "up" ? -1 : 1)];
  return !!neighbor && neighbor.kind !== "new" && neighbor.kind !== "placement";
}

export function moveStage(state: PipelineEditorState, key: string, direction: MoveDirection): PipelineEditorState {
  if (!canMove(state, key, direction)) return state;
  const index = state.stages.findIndex((entry) => entry.key === key);
  const target = index + (direction === "up" ? -1 : 1);
  const stages = [...state.stages];
  [stages[index], stages[target]] = [stages[target], stages[index]];
  return { ...state, stages };
}

export function canAddCustomStage(state: PipelineEditorState): boolean {
  return state.stages.filter((entry) => entry.kind === "custom").length < state.limits.maxCustomStages;
}

export function addCustomStage(state: PipelineEditorState, name = ""): PipelineEditorState {
  if (!canAddCustomStage(state)) return state;
  const placement = state.stages.findIndex((entry) => entry.kind === "placement");
  if (placement < 0) return state;
  const usedKeys = new Set([...state.stages.map((entry) => entry.key), state.exit.key]);
  let counter = state.nextCustomKey;
  while (usedKeys.has(`local:custom:${counter}`)) counter += 1;
  const entry: EditorStage = { key: `local:custom:${counter}`, id: null, kind: "custom", name };
  return {
    ...state,
    stages: [...state.stages.slice(0, placement), entry, ...state.stages.slice(placement)],
    nextCustomKey: counter + 1,
  };
}

export function canRemoveStage(state: PipelineEditorState, key: string): boolean {
  return state.stages.some((entry) => entry.key === key && entry.kind === "custom");
}

export function removeCustomStage(state: PipelineEditorState, key: string): PipelineEditorState {
  if (!canRemoveStage(state, key)) return state;
  return { ...state, stages: state.stages.filter((entry) => entry.key !== key) };
}

const BUILT_IN_KINDS = ["new", "screening", "screening_ok", "in_process", "placement"] as const;

/** $structure is reserved for configuration-wide errors; all other keys are entry keys.
 * Duplicate groups mark every participant and take precedence over the other name errors,
 * except "required": empty names never form a duplicate group.
 */
export function validateEditor(state: PipelineEditorState): { ok: boolean; errors: Record<string, EditorError> } {
  const errors: Record<string, EditorError> = {};
  const entries = [...state.stages, state.exit];
  const groups = new Map<string, string[]>();
  for (const entry of entries) {
    const error = stageNameError(entry.name, state.limits);
    if (error) errors[entry.key] = error;
    // An empty name is "required", never a duplicate of another empty name.
    if (error === "required") continue;
    const nameKey = stageNameKey(normalizeStageName(entry.name));
    const group = groups.get(nameKey) ?? [];
    group.push(entry.key);
    groups.set(nameKey, group);
  }
  for (const group of groups.values()) {
    if (group.length > 1) {
      for (const key of group) errors[key] = "duplicate";
    }
  }
  const invalidStructure = state.stages[0]?.kind !== "new"
    || state.stages[state.stages.length - 1]?.kind !== "placement"
    || state.exit.kind !== "discarded"
    || BUILT_IN_KINDS.some((kind) => state.stages.filter((entry) => entry.kind === kind).length !== 1)
    || state.stages.some((entry) => entry.kind !== "custom" && !BUILT_IN_KINDS.some((kind) => kind === entry.kind))
    || new Set(entries.map((entry) => entry.key)).size !== entries.length;
  if (invalidStructure) errors.$structure = "invalid_structure";
  else if (state.stages.filter((entry) => entry.kind === "custom").length > state.limits.maxCustomStages) {
    errors.$structure = "too_many_custom_stages";
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

export function toPutBody(state: PipelineEditorState): PipelinePutBody {
  return {
    stages: state.stages.map(({ id, name }) => id === null
      ? { name: normalizeStageName(name) }
      : { id, name: normalizeStageName(name) }),
    exit: { id: state.exit.id, name: normalizeStageName(state.exit.name) },
  };
}

export function isEditorDirty(state: PipelineEditorState): boolean {
  const baseline = editorFromPipeline(state.baseline);
  return JSON.stringify(toPutBody(state)) !== JSON.stringify(toPutBody(baseline));
}

/** A successful response is in request order, including newly assigned custom ids. */
export function adoptSavedPipeline(state: PipelineEditorState, response: EditorPipeline): PipelineEditorState {
  const saved = editorFromPipeline(response);
  return {
    ...saved,
    stages: saved.stages.map((entry, index) => ({ ...entry, key: state.stages[index]?.key ?? entry.key })),
    exit: { ...saved.exit, key: state.exit.key },
    nextCustomKey: state.nextCustomKey,
  };
}

export type CriticalRename = {
  key: string;
  kind: "in_process" | "placement" | "discarded";
  previousName: string;
  nextName: string;
};

export function criticalRenames(state: PipelineEditorState): CriticalRename[] {
  const previous = [...state.baseline.stages, state.baseline.exit];
  const renames: CriticalRename[] = [];
  for (const entry of [...state.stages, state.exit]) {
    if (entry.kind !== "in_process" && entry.kind !== "placement" && entry.kind !== "discarded") continue;
    const baseline = previous.find((saved) => saved.id === entry.id);
    if (!baseline) continue;
    const previousName = normalizeStageName(baseline.name);
    const nextName = normalizeStageName(entry.name);
    if (previousName !== nextName) renames.push({ key: entry.key, kind: entry.kind, previousName, nextName });
  }
  return renames;
}
