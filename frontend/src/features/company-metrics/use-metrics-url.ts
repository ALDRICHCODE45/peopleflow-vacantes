"use client";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { parseFilters, serializeFilters, type MetricsFilters } from "./url-state";

const CHANGED = "company-metrics-url-change";
function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener); window.addEventListener(CHANGED, listener);
  return () => { window.removeEventListener("popstate", listener); window.removeEventListener(CHANGED, listener); };
}

/**
 * Period and filters live in the URL, so a view is shareable and the back button restores it. `keep` names other params of
 * the page (the recruiter table's `sort` and `hide`, a recruiter page's `origin`) that a filter change must not drop;
 * `write` replaces the whole query for the page's own state (push by default, `replace` for view changes).
 */
export function useMetricsUrl(keep: readonly string[] = []) {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => "");
  const filters = useMemo(() => parseFilters(new URLSearchParams(search)), [search]);
  const key = serializeFilters(filters).toString();
  const write = useCallback((params: URLSearchParams, mode: "push" | "replace" = "push") => {
    const query = params.toString();
    window.history[mode === "push" ? "pushState" : "replaceState"](null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    window.dispatchEvent(new Event(CHANGED));
  }, []);
  const kept = keep.join(",");
  const update = useCallback((next: MetricsFilters) => {
    const params = serializeFilters(next);
    const current = new URLSearchParams(window.location.search);
    for (const name of kept ? kept.split(",") : []) { const value = current.get(name); if (value !== null) params.set(name, value); }
    write(params);
  }, [kept, write]);
  return { filters, key, search, update, write };
}
