"use client";

import { useSyncExternalStore } from "react";

/** The dialogs' `max-sm` breakpoint: below it, replacement UI trades anchored popovers and header chips for sheets and wrapped rows. */
const COMPACT = "(max-width: 639px)";
const subscribe = (notify: () => void) => {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(COMPACT);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};
const snapshot = () => typeof window.matchMedia === "function" && window.matchMedia(COMPACT).matches;

/** `false` on the server and wherever `matchMedia` does not exist (the desktop composition), so those environments keep today's layout. */
export function useCompactViewport(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
