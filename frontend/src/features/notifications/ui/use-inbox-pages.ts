"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { NotificationGroup, NotificationListResult, NotificationState, NotificationType } from "../model";
import { useNotificationActions, useNotificationScope, type NotificationActions } from "./scope";

export type InboxPages = {
  /** Pinned deadline items; only the first page carries them (L12). */
  attention: NotificationGroup[];
  attentionTotal: number;
  items: NotificationGroup[];
  nextCursor: string | null;
  unread: number;
  /** When the first page was requested: the server view the user sees, `before` of «Marcar todo como leído». */
  loadedAt: string;
};
export type InboxView =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; pages: InboxPages; more: "idle" | "loading" | "error" };
export type InboxFilters = { types: readonly NotificationType[]; jobIds: readonly string[] };

type Entry = { key: string; attempt: number; pages: InboxPages | null; more: "idle" | "loading" | "error" };
const noResponse: NotificationListResult = { ok: false, reason: "no_response", reference: {} };

async function read(list: NotificationActions["list"], query: Parameters<NotificationActions["list"]>[0]): Promise<NotificationListResult> {
  try { return await list(query); } catch { return noResponse; }
}

/** List query; empty filters are left out, never sent. */
function queryOf(state: NotificationState, filters: InboxFilters, cursor?: string) {
  return {
    state,
    ...(filters.types.length ? { types: [...filters.types] } : {}),
    ...(filters.jobIds.length ? { jobIds: [...filters.jobIds] } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

/**
 * Grouped inbox for one tab and filter set: first page on mount (and on every tab or filter change, retry or reload),
 * then cursor pages appended. A cursor the API no longer accepts (`invalid_cursor`) reloads from the first page. Every
 * successful page reports its `unread_count` so the bell stays in step. A `forbidden` read (a user with no company yet,
 * on the invitation and account frames that share the company header) is an empty inbox, not an error. `reload` keeps
 * the current list on screen until the fresh first page arrives; `markLocal` shows a group as read in place. The
 * candidate scope never pins attention (L14: always empty there), whatever the page says.
 */
export function useInboxPages(state: NotificationState, filters: InboxFilters, onUnreadCount: (unread: number) => void) {
  const { list } = useNotificationActions();
  const pinsAttention = useNotificationScope() === "company";
  const [attempt, setAttempt] = useState(0);
  const [entry, setEntry] = useState<Entry | null>(null);
  const key = JSON.stringify([state, filters.types, filters.jobIds]);
  const latest = useRef({ key, entry, filters, onUnreadCount });
  useEffect(() => { latest.current = { key, entry, filters, onUnreadCount }; });

  useEffect(() => {
    let current = true;
    const loadedAt = new Date().toISOString();
    void read(list, queryOf(state, latest.current.filters)).then(result => {
      if (!current) return;
      if (!result.ok) {
        const pages = result.reason === "forbidden"
          ? { attention: [], attentionTotal: 0, items: [], nextCursor: null, unread: 0, loadedAt } : null;
        setEntry({ key, attempt, pages, more: "idle" });
        return;
      }
      latest.current.onUnreadCount(result.data.unread_count);
      // read-all's `before` uses the server clock: the newest activity the user was shown (browser time only when empty).
      const shown = [...(result.data.attention ?? []), ...result.data.items]
        .reduce<string | undefined>((max, group) => (!max || Date.parse(group.latest_at) > Date.parse(max) ? group.latest_at : max), undefined);
      setEntry({
        key, attempt, more: "idle",
        pages: {
          attention: pinsAttention ? result.data.attention ?? [] : [], attentionTotal: pinsAttention ? result.data.attention_total ?? 0 : 0,
          items: result.data.items, nextCursor: result.data.next_cursor, unread: result.data.unread_count,
          loadedAt: shown ?? loadedAt,
        },
      });
    });
    return () => { current = false; };
  }, [state, key, attempt, list, pinsAttention]);

  const retry = useCallback(() => setAttempt(value => value + 1), []);

  const loadMore = useCallback(async () => {
    const at = latest.current.entry;
    if (!at?.pages?.nextCursor || at.more === "loading" || at.key !== latest.current.key) return;
    const owner = at.key;
    const sameOwner = (fn: (e: Entry) => Entry) => setEntry(e => e?.key === owner ? fn(e) : e);
    sameOwner(e => ({ ...e, more: "loading" }));
    const result = await read(list, queryOf(state, latest.current.filters, at.pages.nextCursor));
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
  }, [state, retry, list]);

  /** Shows `groupKey` as read where it is (it stays listed until the sheet closes) and takes the fresh count. */
  const markLocal = useCallback((groupKey: string, unread: number) => {
    const asRead = (group: NotificationGroup) => group.group_key === groupKey ? { ...group, read: true, unread_count: 0 } : group;
    setEntry(e => e?.pages ? { ...e, pages: { ...e.pages, attention: e.pages.attention.map(asRead), items: e.pages.items.map(asRead), unread } } : e);
  }, []);

  const current = entry?.key === key ? entry : null;
  const view: InboxView = current === null || (current.pages === null && current.attempt !== attempt) ? { status: "loading" }
    : current.pages === null ? { status: "error" }
    : { status: "ready", pages: current.pages, more: current.more };
  return { view, retry, reload: retry, loadMore, markLocal };
}
