"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MetricsFailure, MetricsResult } from "./model";
import { serializeFilters, type MetricsFilters } from "./url-state";

const noResponse: MetricsFailure = { ok: false, reason: "no_response", reference: {} };
type Page<T> = { items: T[]; next_cursor: string | null };
export type PagedList<T> = ReturnType<typeof usePagedList<T>>;

/**
 * Cursor list of §3.4: new filters start again from the first page, «Cargar más» appends the next one and keeps
 * what is shown while it loads. A stale cursor restarts the list with a notice.
 */
export function usePagedList<T>(load: (input: { filters: MetricsFilters; cursor?: string }) => Promise<MetricsResult<Page<T>>>, filters: MetricsFilters) {
  const key = serializeFilters(filters).toString();
  const filtersRef = useRef(filters); filtersRef.current = filters;
  const loadRef = useRef(load); loadRef.current = load;
  const generation = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [items, setItems] = useState<T[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [failure, setFailure] = useState<MetricsFailure | null>(null);
  const [moreFailure, setMoreFailure] = useState<MetricsFailure | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const mine = ++generation.current;
    setItems(null); setFailure(null); setMoreFailure(null); setLoadingMore(false);
    void loadRef.current({ filters: filtersRef.current }).catch(() => noResponse).then(result => {
      if (mine !== generation.current) return;
      if (result.ok) { setItems(result.data.items); setCursor(result.data.next_cursor); } else setFailure(result);
    });
    return () => { generation.current += 1; };
  }, [key, attempt]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    const mine = generation.current;
    setLoadingMore(true); setMoreFailure(null); setNotice(null);
    const result = await loadRef.current({ filters: filtersRef.current, cursor }).catch(() => noResponse);
    if (mine !== generation.current) return;
    setLoadingMore(false);
    if (result.ok) { setItems(previous => [...(previous ?? []), ...result.data.items]); setCursor(result.data.next_cursor); }
    else if (result.reason === "invalid_cursor") { setNotice("La lista se actualizó. Volvimos a la primera página."); setAttempt(value => value + 1); }
    else setMoreFailure(result);
  }, [cursor, loadingMore]);

  return { items, failure, moreFailure, notice, loadingMore, hasMore: Boolean(cursor), loadMore, retry: () => setAttempt(value => value + 1) };
}
