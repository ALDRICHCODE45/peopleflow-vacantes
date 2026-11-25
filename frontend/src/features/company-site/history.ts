/** Pure undo/redo history of document snapshots with typing coalescence. */
export const HISTORY_LIMIT = 100;
/** Edits with the same key keep merging while each arrives within this pause. */
export const COALESCE_MS = 1000;

/** What an undo/redo step touched, so the editor can show it again. */
export type HistoryFocus = { kind: "block"; id: string } | { kind: "brand" } | { kind: "settings" };
export type HistoryStep<T> = { value: T; selection: string | null; focus: HistoryFocus | null };
export type History<T> = {
  readonly past: readonly HistoryStep<T>[];
  readonly future: readonly HistoryStep<T>[];
  /** Open coalescing group: the last recorded key and when it last changed. */
  readonly group: { key: string; at: number } | null;
  readonly limit: number;
};
type Current<T> = Omit<HistoryStep<T>, "focus">;
type Same<T> = (a: T, b: T) => boolean;

export function createHistory<T>(limit = HISTORY_LIMIT): History<T> {
  return { past: [], future: [], group: null, limit };
}
/** Record the state before an edit. A null key never coalesces. */
export function recordStep<T>(history: History<T>, before: HistoryStep<T>, key: string | null, now: number): History<T> {
  const group = history.group;
  const coalesce = key !== null && group !== null && group.key === key && now - group.at < COALESCE_MS && history.past.length > 0;
  return {
    ...history,
    past: coalesce ? history.past : [...history.past, before].slice(-history.limit),
    future: [],
    group: key === null ? null : { key, at: now },
  };
}
/** Close the open coalescing group (blur, explicit boundary). */
export function breakStep<T>(history: History<T>): History<T> {
  return history.group ? { ...history, group: null } : history;
}
function travel<T>(from: readonly HistoryStep<T>[], to: readonly HistoryStep<T>[], current: Current<T>, same?: Same<T>) {
  let stack = from;
  // Steps identical to the current value (e.g. canonicalized by a save) are not visible changes.
  while (same && stack.length && same(stack[stack.length - 1].value, current.value)) stack = stack.slice(0, -1);
  const step = stack[stack.length - 1];
  if (!step) return null;
  return { from: stack.slice(0, -1), to: [...to, { ...current, focus: step.focus }], step };
}
export function undoStep<T>(history: History<T>, current: Current<T>, same?: Same<T>): { history: History<T>; step: HistoryStep<T> } | null {
  const moved = travel(history.past, history.future, current, same);
  return moved && { history: { ...history, past: moved.from, future: moved.to, group: null }, step: moved.step };
}
export function redoStep<T>(history: History<T>, current: Current<T>, same?: Same<T>): { history: History<T>; step: HistoryStep<T> } | null {
  const moved = travel(history.future, history.past, current, same);
  return moved && { history: { ...history, future: moved.from, past: moved.to.slice(-history.limit), group: null }, step: moved.step };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
/**
 * The dotted path of the single leaf that differs between two JSON values, or
 * null when they are equal, several leaves differ, or the shape changed.
 */
export function diffPath(a: unknown, b: unknown): string | null {
  if (Object.is(a, b)) return null;
  if (!isRecord(a) || !isRecord(b)) return isRecord(a) || isRecord(b) ? null : "";
  if (Array.isArray(a) !== Array.isArray(b)) return null;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length || keys.some(key => !(key in b))) return null;
  const changed = keys.filter(key => JSON.stringify(a[key]) !== JSON.stringify(b[key]));
  if (changed.length !== 1) return null;
  const inner = diffPath(a[changed[0]], b[changed[0]]);
  return inner === null ? null : inner === "" ? changed[0] : `${changed[0]}.${inner}`;
}
