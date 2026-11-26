"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MarkResultResult, NotificationGroup } from "../model";
import { useNotificationActions } from "./scope";
import type { InboxFilters } from "./use-inbox-pages";

/** Polite line above the list: a failure, or the read-all result with its «Deshacer». */
export type MarkStatus = { kind: "message"; text: string } | { kind: "undo"; affected: number; markedAt: string } | null;

const noResponse: MarkResultResult = { ok: false, reason: "no_response", reference: {} };
async function send(run: () => Promise<MarkResultResult>): Promise<MarkResultResult> {
  try { return await run(); } catch { return noResponse; }
}

type Options = {
  filters: InboxFilters;
  /** `loadedAt` of the first page on screen. */
  loadedAt: string | null;
  onUnreadCount: (unread: number) => void;
  markLocal: (groupKey: string, unread: number) => void;
  reload: () => void;
};

/**
 * Writes of the inbox (T3.5): «Marcar como leída» per group (the row stays listed as read until the sheet closes),
 * mark-on-open (fire and forget: navigation never waits on it), «Marcar todo como leído» over the active filters up
 * to when the first page was loaded, and «Deshacer» of exactly that batch (`marked_at`). Every success pushes the
 * returned `unread_count` into the bell.
 */
export function useInboxMarks({ filters, loadedAt, onUnreadCount, markLocal, reload }: Options) {
  const { markRead: markReadAction, markUnread: markUnreadAction, markAllRead: markAllReadAction } = useNotificationActions();
  const [status, setStatus] = useState<MarkStatus>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const markGroup = useCallback(async (group: NotificationGroup) => {
    const result = await send(() => markReadAction({ groupKeys: [group.group_key] }));
    if (result.ok) onUnreadCount(result.data.unread_count);
    if (!mounted.current) return;
    if (!result.ok) { setStatus({ kind: "message", text: "No se pudo marcar como leída." }); return; }
    markLocal(group.group_key, result.data.unread_count);
    setStatus(null);
  }, [onUnreadCount, markLocal, markReadAction]);

  const openGroup = useCallback((group: NotificationGroup) => {
    if (!group.read) void markGroup(group);
  }, [markGroup]);

  const markAll = useCallback(async () => {
    setBusy(true);
    const input = {
      ...(filters.types.length ? { types: filters.types } : {}),
      ...(filters.jobIds.length ? { jobIds: filters.jobIds } : {}),
      ...(loadedAt ? { before: loadedAt } : {}),
    };
    const result = await send(() => markAllReadAction(input));
    if (!mounted.current) return;
    setBusy(false);
    if (!result.ok) { setStatus({ kind: "message", text: "No se pudo marcar todo como leído." }); return; }
    onUnreadCount(result.data.unread_count);
    setStatus({ kind: "undo", affected: result.data.affected_notifications, markedAt: result.data.marked_at });
    reload();
  }, [filters, loadedAt, onUnreadCount, reload, markAllReadAction]);

  const undo = useCallback(async () => {
    if (status?.kind !== "undo") return;
    setBusy(true);
    const result = await send(() => markUnreadAction({ markedAt: status.markedAt }));
    if (!mounted.current) return;
    setBusy(false);
    if (!result.ok) { setStatus({ kind: "message", text: "No se pudo deshacer." }); return; }
    onUnreadCount(result.data.unread_count);
    setStatus(null);
    reload();
  }, [status, onUnreadCount, reload, markUnreadAction]);

  const clearStatus = useCallback(() => setStatus(null), []);
  return { status, busy, markGroup, openGroup, markAll, undo, clearStatus };
}
