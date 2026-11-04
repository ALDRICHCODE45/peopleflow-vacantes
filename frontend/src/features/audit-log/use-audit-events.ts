"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { listAuditEventsAction, loadAuditOptionsAction } from "./actions";
import type { AuditEvent, AuditFailure, AuditListResult, AuditOptions } from "./model";
import { parseUrlState, serializeFilters, serializeUrlState, type AuditFilters } from "./url-state";

const CHANGED = "audit-log-url-change";
function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener); window.addEventListener(CHANGED, listener);
  return () => { window.removeEventListener("popstate", listener); window.removeEventListener(CHANGED, listener); };
}
const noResponse: AuditFailure = { ok: false, reason: "no_response", reference: {} };

type Loaded = { items: AuditEvent[]; total: number; nextCursor: string | null };

/** Filters live in the URL; the cursor is page state, so a reload always starts from the newest events. */
export function useAuditEvents() {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => "");
  const filters = useMemo(() => parseUrlState(new URLSearchParams(search)).filters, [search]);
  const key = serializeFilters(filters).toString();
  const filtersRef = useRef(filters); filtersRef.current = filters;
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const loadedRef = useRef(loaded); loadedRef.current = loaded;
  const [failure, setFailure] = useState<AuditFailure | null>(null);
  const [moreFailure, setMoreFailure] = useState<AuditFailure | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    const mine = ++generation.current;
    setLoaded(null); setFailure(null); setMoreFailure(null); setLoadingMore(false);
    void (async () => {
      let result: AuditListResult;
      try { result = await listAuditEventsAction({ filters: filtersRef.current }); } catch { result = noResponse; }
      if (mine !== generation.current) return;
      if (result.ok) setLoaded({ items: result.data.items, total: result.data.total, nextCursor: result.data.next_cursor });
      else setFailure(result);
    })();
    return () => { generation.current += 1; };
  }, [key, attempt]);

  const update = useCallback((next: AuditFilters) => {
    const query = serializeUrlState({ filters: next }).toString();
    window.history.pushState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    window.dispatchEvent(new Event(CHANGED));
    setNotice(null);
  }, []);

  const loadMore = useCallback(async () => {
    const current = loadedRef.current;
    if (!current?.nextCursor || loadingMore) return;
    const mine = generation.current;
    setLoadingMore(true); setMoreFailure(null);
    let result: AuditListResult;
    try { result = await listAuditEventsAction({ filters: filtersRef.current, cursor: current.nextCursor }); } catch { result = noResponse; }
    if (mine !== generation.current) return;
    setLoadingMore(false);
    if (result.ok) {
      const seen = new Set(current.items.map(item => item.id));
      setLoaded({ items: [...current.items, ...result.data.items.filter(item => !seen.has(item.id))], total: result.data.total, nextCursor: result.data.next_cursor });
    } else if (result.reason === "invalid_cursor") {
      setNotice("La lista se actualizó. Volvimos a la primera página.");
      setAttempt(value => value + 1);
    } else setMoreFailure(result);
  }, [loadingMore]);

  return { filters, loaded, failure, moreFailure, loadingMore, notice, update, loadMore, retry: () => setAttempt(value => value + 1) };
}

/** Catalogs for the filters: types, actors (former members included) and vacancies (deleted ones included). */
export function useAuditOptions() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ status: "loading" } | { status: "error" } | { status: "ready"; options: AuditOptions }>({ status: "loading" });
  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    void (async () => {
      let result: Awaited<ReturnType<typeof loadAuditOptionsAction>>;
      try { result = await loadAuditOptionsAction(); } catch { result = noResponse; }
      if (!current) return;
      setState(result.ok ? { status: "ready", options: { types: result.types, actors: result.actors, vacancies: result.vacancies } } : { status: "error" });
    })();
    return () => { current = false; };
  }, [attempt]);
  return { ...state, retry: () => setAttempt(value => value + 1) };
}
