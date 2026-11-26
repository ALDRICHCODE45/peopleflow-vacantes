"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { listNotificationsAction } from "../actions";
import type { NotificationGroup, NotificationListResult, NotificationState } from "../model";

export type InboxPages = {
  /** Pinned deadline items; only the first page carries them (L12). */
  attention: NotificationGroup[];
  attentionTotal: number;
  items: NotificationGroup[];
  nextCursor: string | null;
  unread: number;
};
export type InboxView =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; pages: InboxPages; more: "idle" | "loading" | "error" };

type Entry = { key: string; pages: InboxPages | null; more: "idle" | "loading" | "error" };
const noResponse: NotificationListResult = { ok: false, reason: "no_response", reference: {} };
const emptyPages: InboxPages = { attention: [], attentionTotal: 0, items: [], nextCursor: null, unread: 0 };

async function read(query: Parameters<typeof listNotificationsAction>[0]): Promise<NotificationListResult> {
  try { return await listNotificationsAction(query); } catch { return noResponse; }
}

/**
 * Grouped inbox for one tab: first page on mount (and on every `state` change or retry), then cursor pages appended.
 * A cursor the API no longer accepts (`invalid_cursor`) reloads from the first page. Every successful page reports its
 * `unread_count` so the bell stays in step. A `forbidden` read (a user with no company yet, on the invitation and
 * account frames that share the company header) is an empty inbox, not an error: there is nothing to retry.
 */
export function useInboxPages(state: NotificationState, onUnreadCount: (unread: number) => void) {
  const [attempt, setAttempt] = useState(0);
  const [entry, setEntry] = useState<Entry | null>(null);
  const key = `${state}#${attempt}`;
  const latest = useRef({ key, entry, onUnreadCount });
  useEffect(() => { latest.current = { key, entry, onUnreadCount }; });

  useEffect(() => {
    let current = true;
    void read({ state }).then(result => {
      if (!current) return;
      if (!result.ok) { setEntry({ key, pages: result.reason === "forbidden" ? emptyPages : null, more: "idle" }); return; }
      latest.current.onUnreadCount(result.data.unread_count);
      setEntry({
        key, more: "idle",
        pages: {
          attention: result.data.attention ?? [], attentionTotal: result.data.attention_total ?? 0,
          items: result.data.items, nextCursor: result.data.next_cursor, unread: result.data.unread_count,
        },
      });
    });
    return () => { current = false; };
  }, [state, key]);

  const retry = useCallback(() => setAttempt(value => value + 1), []);

  const loadMore = useCallback(async () => {
    const at = latest.current.entry;
    if (!at?.pages?.nextCursor || at.more === "loading" || at.key !== latest.current.key) return;
    const owner = at.key;
    const sameOwner = (fn: (e: Entry) => Entry) => setEntry(e => e?.key === owner ? fn(e) : e);
    sameOwner(e => ({ ...e, more: "loading" }));
    const result = await read({ state, cursor: at.pages.nextCursor });
    if (latest.current.key !== owner) return;
    if (!result.ok) {
      if (result.reason === "invalid_cursor") retry();
      else sameOwner(e => ({ ...e, more: "error" }));
      return;
    }
    latest.current.onUnreadCount(result.data.unread_count);
    sameOwner(e => {
      if (!e.pages) return e;
      const seen = new Set(e.pages.items.map(item => item.group_key));
      return {
        ...e, more: "idle",
        pages: {
          ...e.pages,
          items: [...e.pages.items, ...result.data.items.filter(item => !seen.has(item.group_key))],
          nextCursor: result.data.next_cursor, unread: result.data.unread_count,
        },
      };
    });
  }, [state, retry]);

  const current = entry?.key === key ? entry : null;
  const view: InboxView = current === null ? { status: "loading" }
    : current.pages === null ? { status: "error" }
    : { status: "ready", pages: current.pages, more: current.more };
  return { view, retry, loadMore };
}
