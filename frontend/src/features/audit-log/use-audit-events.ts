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

/** Same choices as the dashboard table; 50 stays the default the list always read. */
export const PAGE_SIZES = [10, 20, 30, 40, 50] as const;
export const DEFAULT_PAGE_SIZE = 50;

/** `cursors` holds the cursor of every visited page after the first, so «previous» pops and «first» empties it. */
type Loaded = { items: AuditEvent[]; total: number; nextCursor: string | null; cursors: string[] };

/** Filters live in the URL; the cursor stack and the page size are page state, so a reload starts from the newest events. */
export function useAuditEvents() {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => "");
  const filters = useMemo(() => parseUrlState(new URLSearchParams(search)).filters, [search]);
  const key = serializeFilters(filters).toString();
  const filtersRef = useRef(filters); filtersRef.current = filters;
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<AuditFailure | null>(null);
  const [pageFailure, setPageFailure] = useState<{ failure: AuditFailure; cursors: string[] } | null>(null);
  const [paging, setPaging] = useState(false);
  const pagingRef = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);

  // A new filter set, page size or retry always starts again from page 1.
  useEffect(() => {
    const mine = ++generation.current;
    pagingRef.current = false;
    setLoaded(null); setFailure(null); setPageFailure(null); setPaging(false);
    void (async () => {
      let result: AuditListResult;
      try { result = await listAuditEventsAction({ filters: filtersRef.current, limit: pageSize }); } catch { result = noResponse; }
      if (mine !== generation.current) return;
      if (result.ok) setLoaded({ items: result.data.items, total: result.data.total, nextCursor: result.data.next_cursor, cursors: [] });
      else setFailure(result);
    })();
    return () => { generation.current += 1; };
  }, [key, pageSize, attempt]);

  const update = useCallback((next: AuditFilters) => {
    const query = serializeUrlState({ filters: next }).toString();
    window.history.pushState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    window.dispatchEvent(new Event(CHANGED));
    setNotice(null);
  }, []);

  /** Reads the page at the top of `cursors`; the current page stays visible until it answers. */
  const goTo = useCallback(async (cursors: string[]) => {
    if (pagingRef.current) return;
    const mine = generation.current;
    pagingRef.current = true;
    setPaging(true); setPageFailure(null); setNotice(null);
    const cursor = cursors.at(-1);
    let result: AuditListResult;
    try { result = await listAuditEventsAction({ filters: filtersRef.current, limit: pageSize, ...(cursor === undefined ? {} : { cursor }) }); } catch { result = noResponse; }
    if (mine !== generation.current) return;
    pagingRef.current = false;
    setPaging(false);
    if (result.ok) setLoaded({ items: result.data.items, total: result.data.total, nextCursor: result.data.next_cursor, cursors });
    else if (result.reason === "invalid_cursor") {
      setNotice("La lista se actualizó. Volvimos a la primera página.");
      setAttempt(value => value + 1);
    } else setPageFailure({ failure: result, cursors });
  }, [pageSize]);

  const cursors = loaded?.cursors ?? [];
  const nextCursor = loaded?.nextCursor ?? null;
  return {
    filters, loaded, failure, notice, update, paging, pageSize,
    page: cursors.length + 1,
    pageCount: Math.max(1, Math.ceil((loaded?.total ?? 0) / pageSize)),
    pageFailure: pageFailure?.failure ?? null,
    first: () => void goTo([]),
    previous: () => void goTo(cursors.slice(0, -1)),
    next: () => { if (nextCursor) void goTo([...cursors, nextCursor]); },
    retryPage: () => { if (pageFailure) void goTo(pageFailure.cursors); },
    changePageSize: (size: number) => { setNotice(null); setPageSize(size); },
    retry: () => setAttempt(value => value + 1),
  };
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
