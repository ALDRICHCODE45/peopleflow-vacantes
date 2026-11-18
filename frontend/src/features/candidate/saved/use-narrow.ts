"use client";
import { useSyncExternalStore } from "react";

/**
 * Below Tailwind `xl` the content column (beside the sidebar) is under the artboard's 860 px preview breakpoint: the
 * selected row expands in place instead of the sticky preview. Same matchMedia approach as the applications inbox.
 */
const QUERY = "(max-width: 1279px)";
const media = () => typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(QUERY) : null;
function subscribe(onChange: () => void) {
  const list = media();
  list?.addEventListener?.("change", onChange);
  return () => list?.removeEventListener?.("change", onChange);
}
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, () => media()?.matches ?? false, () => false);
}
