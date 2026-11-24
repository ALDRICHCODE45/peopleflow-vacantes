import { useSyncExternalStore } from "react";

/** Tailwind's `sm` is 40rem: below it the audit log is the phone layout (cards, bottom drawers). */
const PHONE = "(max-width: 639.98px)";

function subscribe(listener: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(PHONE);
  query.addEventListener?.("change", listener);
  return () => query.removeEventListener?.("change", listener);
}
const snapshot = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(PHONE).matches;

/** True below `sm`. The server and the first client render say «no» (desktop), then the phone layout takes over. */
export function usePhone(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
