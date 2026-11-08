"use client";
import { useCallback, useSyncExternalStore } from "react";
import { parseWindow, type DashboardWindow } from "./model";

const CHANGED = "employer-dashboard-url-change";
function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener); window.addEventListener(CHANGED, listener);
  return () => { window.removeEventListener("popstate", listener); window.removeEventListener(CHANGED, listener); };
}

/** The period lives in the URL (`?window=7|30|90`, 30 when absent), so a view is shareable and Back restores it. */
export function useDashboardWindow() {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => "");
  const value = parseWindow(new URLSearchParams(search).get("window"));
  const update = useCallback((next: DashboardWindow) => {
    const params = new URLSearchParams(window.location.search);
    params.set("window", String(next));
    window.history.pushState(null, "", `${window.location.pathname}?${params}${window.location.hash}`);
    window.dispatchEvent(new Event(CHANGED));
  }, []);
  return { window: value, update };
}
