"use client";
import { useCallback, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";

export const CANDIDATE_PARAM = "candidato";
const changed = "pf-board-candidate-change";

function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener); window.addEventListener(changed, listener);
  return () => { window.removeEventListener("popstate", listener); window.removeEventListener(changed, listener); };
}

/**
 * The participation a link asks the board to open (`?candidato=<participation_id>`, e.g. from a notification), or `null`.
 * Reactive: Next's search params follow client-side navigations (the bell is on the pipeline too) without a remount;
 * without the app router's context the URL itself is the store (back/forward and `clear`).
 * `clear` drops the param from the URL with `replaceState`, preserving the other parameters.
 */
export function useCandidateParam(): [string | null, () => void] {
  const nextParams = useSearchParams();
  // Server snapshot is empty: the first render must match the server markup.
  const locationSearch = useSyncExternalStore(subscribe, () => window.location.search, () => "");
  const requested = (nextParams ?? new URLSearchParams(locationSearch)).get(CANDIDATE_PARAM)?.trim() || null;
  const clear = useCallback(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(CANDIDATE_PARAM)) return;
    url.searchParams.delete(CANDIDATE_PARAM);
    // `null` state, not `window.history.state`: Next's patched `replaceState` would otherwise skip syncing its router.
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    window.dispatchEvent(new Event(changed));
  }, []);
  return [requested, clear];
}
