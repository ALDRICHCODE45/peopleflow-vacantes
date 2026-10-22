"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { listCandidatesAction } from "../actions";
import type { CandidateFailure, CandidatePage, CandidateResult } from "../model";
import { parseUrlState, serializeFilters, serializeUrlState, toListQuery, type UrlState } from "../url-state";
const changed = "org-candidates-url-change";
function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener); window.addEventListener(changed, listener);
  return () => { window.removeEventListener("popstate", listener); window.removeEventListener(changed, listener); };
}
export function useCandidates() {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => "");
  const state = useMemo(() => parseUrlState(new URLSearchParams(search)), [search]);
  const stateRef = useRef(state); stateRef.current = state;
  const filterKey = serializeFilters(state.filters).toString();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; cursor?: string; page: CandidatePage } | null>(null);
  const loadedRef = useRef(loaded); loadedRef.current = loaded;
  const [pending, setPending] = useState(true);
  const [failure, setFailure] = useState<CandidateFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);
  const update = useCallback((next: UrlState, replace = false) => {
    const query = serializeUrlState(next).toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    window.history[replace ? "replaceState" : "pushState"](null, "", url);
    window.dispatchEvent(new Event(changed));
  }, []);
  useEffect(() => {
    let current = true;
    const requestState = stateRef.current;
    setPending(true); setFailure(null);
    async function load() {
      let result: CandidateResult;
      try { result = await listCandidatesAction(toListQuery(requestState)); }
      catch { result = { ok: false, reason: "no_response", reference: {} }; }
      if (!current) return;
      if (!result.ok && result.reason === "invalid_cursor" && requestState.cursor) {
        setLoaded(null); setNotice("La lista se actualizó. Volvimos a la primera página.");
        update({ ...stateRef.current, cursor: undefined }, true); return;
      }
      if (!result.ok && result.reason === "invalid_filter" && result.fields?.some(issue => issue.field === "vacancy" && issue.code === "not_found") && requestState.filters.vacancy?.length) {
        setNotice("Esa vacante ya no está disponible");
        // L7 identifies the key, not the offending id: clear the vacancy key only.
        update({ ...stateRef.current, cursor: undefined, filters: { ...stateRef.current.filters, vacancy: undefined } }, true); return;
      }
      setPending(false);
      if (!result.ok) { setFailure(result); return; }
      const previous = loadedRef.current;
      const append = requestState.cursor && previous?.key === filterKey && previous.page.next_cursor === requestState.cursor;
      const items = append ? [...previous.page.items, ...result.data.items] : result.data.items;
      const seen = new Set<string>();
      setLoaded({ key: filterKey, cursor: requestState.cursor, page: { ...result.data, items: items.filter(item => {
        const identity = `${item.kind}:${item.id}`; if (seen.has(identity)) return false; seen.add(identity); return true;
      }) } });
    }
    void load(); return () => { current = false; };
  }, [filterKey, state.cursor, attempt, update]);
  const page = loaded?.key === filterKey ? loaded.page : null;
  return { state, update, page, pending: pending || (!failure && loaded?.key !== filterKey), failure, notice,
    retry: () => setAttempt(value => value + 1), clearNotice,
    loadMore: () => { if (!pending && page?.next_cursor) update({ ...stateRef.current, cursor: page.next_cursor }); },
  };
}
