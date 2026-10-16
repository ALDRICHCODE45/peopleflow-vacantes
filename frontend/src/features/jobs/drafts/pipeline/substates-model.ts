import { normalizeStageName, stageNameError, stageNameKey, type MoveDirection, type StageNameError } from "./editor-model";

export type SubstatesCatalog = {
  version: string;
  substates: { id: string; name: string }[];
  limits: { maxSubstates: number; nameMaxLength: number };
  suggestions: string[];
};
export type SubstateEntry = { key: string; id: string | null; name: string };
export type SubstatesEditorState = {
  entries: SubstateEntry[];
  limits: SubstatesCatalog["limits"];
  suggestions: string[];
  baseline: SubstatesCatalog;
  nextKey: number;
};
export type SubstateError = StageNameError | "duplicate" | "too_many_substates";
export type SubstatesPutBody = { substates: { id?: string; name: string }[] };

export function fromCatalog(catalog: SubstatesCatalog): SubstatesEditorState {
  return {
    entries: catalog.substates.map(entry => ({ ...entry, key: entry.id })),
    limits: { ...catalog.limits }, suggestions: [...catalog.suggestions], nextKey: 1,
    baseline: { ...catalog, substates: catalog.substates.map(entry => ({ ...entry })), limits: { ...catalog.limits }, suggestions: [...catalog.suggestions] },
  };
}
export function rename(state: SubstatesEditorState, key: string, name: string): SubstatesEditorState {
  const entry = state.entries.find(entry => entry.key === key);
  return !entry || entry.name === name ? state : { ...state, entries: state.entries.map(entry => entry.key === key ? { ...entry, name } : entry) };
}
export function canMoveTo(state: SubstatesEditorState, key: string, target: number): boolean {
  const index = state.entries.findIndex(entry => entry.key === key);
  return index >= 0 && Number.isInteger(target) && target >= 0 && target < state.entries.length && index !== target;
}
export function moveTo(state: SubstatesEditorState, key: string, target: number): SubstatesEditorState {
  if (!canMoveTo(state, key, target)) return state;
  const entries = [...state.entries];
  const [entry] = entries.splice(entries.findIndex(entry => entry.key === key), 1);
  entries.splice(target, 0, entry);
  return { ...state, entries };
}
export function canMove(state: SubstatesEditorState, key: string, direction: MoveDirection): boolean {
  return canMoveTo(state, key, state.entries.findIndex(entry => entry.key === key) + (direction === "up" ? -1 : 1));
}
export function move(state: SubstatesEditorState, key: string, direction: MoveDirection): SubstatesEditorState {
  return moveTo(state, key, state.entries.findIndex(entry => entry.key === key) + (direction === "up" ? -1 : 1));
}
export function canAdd(state: SubstatesEditorState): boolean { return state.entries.length < state.limits.maxSubstates; }
export function add(state: SubstatesEditorState, name = ""): SubstatesEditorState {
  if (!canAdd(state)) return state;
  let counter = state.nextKey;
  while (state.entries.some(entry => entry.key === `local:substate:${counter}`)) counter++;
  return { ...state, entries: [...state.entries, { key: `local:substate:${counter}`, id: null, name }], nextKey: counter + 1 };
}
export function remove(state: SubstatesEditorState, key: string): SubstatesEditorState {
  return state.entries.some(entry => entry.key === key) ? { ...state, entries: state.entries.filter(entry => entry.key !== key) } : state;
}
export function validate(state: SubstatesEditorState): { ok: boolean; errors: Record<string, SubstateError> } {
  const errors: Record<string, SubstateError> = {};
  const groups = new Map<string, string[]>();
  for (const entry of state.entries) {
    const error = stageNameError(entry.name, { ...state.limits, maxCustomStages: 0 });
    if (error) errors[entry.key] = error;
    if (error === "required") continue;
    const key = stageNameKey(normalizeStageName(entry.name));
    groups.set(key, [...(groups.get(key) ?? []), entry.key]);
  }
  for (const group of groups.values()) if (group.length > 1) for (const key of group) errors[key] = "duplicate";
  if (state.entries.length > state.limits.maxSubstates) errors.$catalog = "too_many_substates";
  return { ok: Object.keys(errors).length === 0, errors };
}
export function toPutBody(state: SubstatesEditorState): SubstatesPutBody {
  return { substates: state.entries.map(({ id, name }) => id === null ? { name: normalizeStageName(name) } : { id, name: normalizeStageName(name) }) };
}
export function isDirty(state: SubstatesEditorState): boolean {
  return JSON.stringify(toPutBody(state)) !== JSON.stringify(toPutBody(fromCatalog(state.baseline)));
}
/** Successful responses follow request order, including newly assigned ids. */
export function adoptSaved(state: SubstatesEditorState, catalog: SubstatesCatalog): SubstatesEditorState {
  const saved = fromCatalog(catalog);
  return { ...saved, entries: saved.entries.map((entry, index) => ({ ...entry, key: state.entries[index]?.key ?? entry.key })), nextKey: state.nextKey };
}
export function reconcileUncertainSave(state: SubstatesEditorState, fetched: SubstatesCatalog): "saved" | "not_saved" | "conflict" {
  const attempted = toPutBody(state).substates;
  const matches = attempted.length === fetched.substates.length && attempted.every((entry, index) => {
    const received = fetched.substates[index];
    return entry.name === normalizeStageName(received.name) && (entry.id === undefined || entry.id === received.id);
  });
  if (matches) return "saved";
  return fetched.version === state.baseline.version ? "not_saved" : "conflict";
}
export function availableSuggestions(state: SubstatesEditorState): string[] {
  const present = new Set(state.entries.map(entry => stageNameKey(normalizeStageName(entry.name))));
  return state.suggestions.filter(name => !present.has(stageNameKey(normalizeStageName(name))));
}
