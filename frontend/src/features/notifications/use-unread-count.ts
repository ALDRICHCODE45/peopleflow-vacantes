"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getUnreadCountAction } from "./actions";
import type { UnreadCountResult } from "./model";

export const POLL_INTERVAL_MS = 30_000;
const noResponse: UnreadCountResult = { ok: false, reason: "no_response", reference: {} };
const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

/**
 * Bell counter (unread groups). Reads on mount, every 30 s while the tab is visible, and right away when the tab
 * becomes visible or the window gets focus. A failed read keeps the last value; a lost session stops polling.
 */
export function useUnreadCount() {
  const [unread, setUnread] = useState<number | null>(null);
  const generation = useRef(0);
  const stopped = useRef(false);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (stopped.current) return;
    const mine = ++generation.current;
    let result: UnreadCountResult;
    try { result = await getUnreadCountAction(); } catch { result = noResponse; }
    if (mine !== generation.current || !mounted.current) return;
    if (result.ok) setUnread(result.data.unread_count);
    else if (result.reason === "unauthenticated" || result.reason === "forbidden") stopped.current = true;
  }, []);

  /** A fresher count from the inbox wins over any read still in flight. */
  const set = useCallback((value: number) => { generation.current += 1; setUnread(value); }, []);

  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => { if (timer !== undefined) clearInterval(timer); timer = undefined; };
    const start = () => {
      stop();
      if (stopped.current) return;
      timer = setInterval(() => { if (stopped.current) stop(); else if (visible()) void refresh(); }, POLL_INTERVAL_MS);
    };
    const onVisibility = () => {
      if (!visible()) { stop(); return; }
      void refresh();
      start();
    };
    const onFocus = () => { if (visible()) void refresh(); };

    void refresh();
    if (visible()) start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      mounted.current = false;
      generation.current += 1;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  return { unread, set, refresh };
}
