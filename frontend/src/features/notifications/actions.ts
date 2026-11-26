"use server";

import { getActionAccessToken } from "@/lib/auth/action-session";
import {
  getFacets, getUnreadCount, listNotifications, markAllRead, markRead, markUnread,
  type NotificationClientFailure, type NotificationQuery,
} from "./client";
import { toNotificationFailure } from "./failure";
import type {
  FacetsResult, MarkAllInput, MarkResultResult, MarkTarget, NotificationFailure, NotificationListResult, NotificationState,
  UnmarkTarget, UnreadCountResult,
} from "./model";

const unauthenticated: NotificationFailure = { ok: false, reason: "unauthenticated", reference: {} };
const noResponse: NotificationFailure = { ok: false, reason: "no_response", reference: {} };

/** Session token in, contract result out; no token → `unauthenticated` without a request. */
async function withToken<T>(run: (token: string) => Promise<{ ok: true; data: T } | NotificationClientFailure>): Promise<{ ok: true; data: T } | NotificationFailure> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return unauthenticated;
    const result = await run(token);
    return result.ok ? result : toNotificationFailure(result);
  } catch { return noResponse; }
}

/** Grouped company inbox; the API gate (owner/recruiter/stakeholder) decides who reads it. */
export async function listNotificationsAction(input: NotificationQuery = {}): Promise<NotificationListResult> {
  return withToken(token => listNotifications({ ...input, token }));
}

/** Bell counter: unread groups and unread notifications. */
export async function getUnreadCountAction(): Promise<UnreadCountResult> {
  return withToken(getUnreadCount);
}

/** Marks groups (`groupKeys`, 1–100) or notifications (`ids`, 1–200) read; keep `marked_at` for «Deshacer». */
export async function markReadAction(target: MarkTarget): Promise<MarkResultResult> {
  return withToken(token => markRead({ token, target }));
}

/** Marks groups or notifications unread, or undoes exactly one earlier mark with `{ markedAt }`. */
export async function markUnreadAction(target: UnmarkTarget): Promise<MarkResultResult> {
  return withToken(token => markUnread({ token, target }));
}

/** Marks everything matching the filters read, up to `before` (default: now on the server); empty filters are omitted. */
export async function markAllReadAction(input: MarkAllInput = {}): Promise<MarkResultResult> {
  return withToken(token => markAllRead({ ...input, token }));
}

/** Filter popover counts per type and per job, over unread (default) or all groups. */
export async function getFacetsAction(state: NotificationState = "unread"): Promise<FacetsResult> {
  return withToken(token => getFacets({ token, state }));
}
