"use client";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { parseFilters, serializeFilters, type MetricsFilters } from "./url-state";

const CHANGED = "company-metrics-url-change";
function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener); window.addEventListener(CHANGED, listener);
  return () => { window.removeEventListener("popstate", listener); window.removeEventListener(CHANGED, listener); };
}

/** Period and filters live in the URL, so a view is shareable and the back button restores it. */
export function useMetricsUrl() {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => "");
  const filters = useMemo(() => parseFilters(new URLSearchParams(search)), [search]);
  const key = serializeFilters(filters).toString();
  const update = useCallback((next: MetricsFilters) => {
    const query = serializeFilters(next).toString();
    window.history.pushState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    window.dispatchEvent(new Event(CHANGED));
  }, []);
  return { filters, key, update };
}
