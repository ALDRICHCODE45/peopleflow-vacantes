"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnPinningState, ColumnVisibilityState, Updater } from "@tanstack/react-table";
import { z } from "zod";

export type TableDefaults = {
  order: string[]; pinning: ColumnPinningState; visibility: ColumnVisibilityState;
  nonHideable?: string[]; fixedPinning?: ColumnPinningState;
};
const schema = z.object({
  v: z.literal(1), order: z.array(z.string()),
  pinning: z.object({ start: z.array(z.string()), end: z.array(z.string()) }),
  visibility: z.record(z.string(), z.boolean()),
});
export type TablePreferences = z.infer<typeof schema>;

function reconcile(value: TablePreferences, defaults: TableDefaults): TablePreferences {
  const current = new Set(defaults.order);
  const known = (ids: string[]) => [...new Set(ids)].filter(id => current.has(id));
  const order = known([...value.order, ...defaults.order]);
  const fixedStart = known(defaults.fixedPinning?.start ?? []);
  const fixedEnd = known(defaults.fixedPinning?.end ?? []).filter(id => !fixedStart.includes(id));
  const fixed = new Set([...fixedStart, ...fixedEnd]);
  const start = [...fixedStart, ...known(value.pinning.start).filter(id => !fixed.has(id))];
  const end = [...known(value.pinning.end).filter(id => !fixed.has(id) && !start.includes(id)), ...fixedEnd];
  const visibility = Object.fromEntries(Object.entries({ ...defaults.visibility, ...value.visibility }).filter(([id]) => current.has(id) && !defaults.nonHideable?.includes(id)));
  return { v: 1, order, pinning: { start, end }, visibility };
}
function readPreferences(key: string, defaults: TableDefaults): TablePreferences {
  const fallback = reconcile({ v: 1, ...defaults, pinning: { start: defaults.pinning.start ?? [], end: defaults.pinning.end ?? [] } }, defaults);
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      const parsed = schema.safeParse(JSON.parse(stored));
      if (parsed.success) return reconcile(parsed.data, defaults);
    }
  } catch { /* Storage may be unavailable or contain malformed JSON. */ }
  return fallback;
}
const apply = <T,>(updater: Updater<T>, previous: T): T => typeof updater === "function" ? (updater as (value: T) => T)(previous) : updater;

/** Hydrate after mount to keep the server and first client render identical. Stores layout only, never row data. */
export function useTablePreferences(id: string, defaults: TableDefaults) {
  const signature = JSON.stringify(defaults);
  const stableDefaults = useMemo(() => {
    try { return JSON.parse(signature) as TableDefaults; } catch { return defaults; }
    // The serialized layout, rather than object identity, controls reconciliation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  const key = `pf.table.${id}`;
  const identity = `${key}:${signature}`;
  const [state, setState] = useState<{ identity: string; ready: boolean; preferences: TablePreferences }>(() => ({
    identity, ready: false, preferences: reconcile({ v: 1, ...stableDefaults }, stableDefaults),
  }));
  useEffect(() => {
    setState({ identity, ready: true, preferences: readPreferences(key, stableDefaults) });
  }, [identity, key, stableDefaults]);
  useEffect(() => {
    if (!state.ready || state.identity !== identity) return;
    try { localStorage.setItem(key, JSON.stringify(state.preferences)); } catch { /* Quota/privacy errors must not disable the table. */ }
  }, [identity, key, state]);
  const setOrder = useCallback((value: Updater<string[]>) => setState(previous => ({ ...previous, preferences: { ...previous.preferences, order: apply(value, previous.preferences.order) } })), []);
  const setPinning = useCallback((value: Updater<ColumnPinningState>) => setState(previous => ({ ...previous, preferences: { ...previous.preferences, pinning: apply(value, previous.preferences.pinning) } })), []);
  const setVisibility = useCallback((value: Updater<ColumnVisibilityState>) => setState(previous => ({ ...previous, preferences: { ...previous.preferences, visibility: apply(value, previous.preferences.visibility) } })), []);
  const reset = useCallback(() => setState({ identity, ready: true, preferences: reconcile({ v: 1, ...stableDefaults, pinning: { start: stableDefaults.pinning.start ?? [], end: stableDefaults.pinning.end ?? [] } }, stableDefaults) }), [identity, stableDefaults]);
  return { preferences: state.preferences, setOrder, setPinning, setVisibility, reset };
}
