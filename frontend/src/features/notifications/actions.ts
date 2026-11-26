"use server";

import { getActionAccessToken } from "@/lib/auth/action-session";
import {
  getFacets, getPreferences, getUnreadCount, listNotifications, markAllRead, markRead, markUnread, updatePreferences,
  type NotificationClientFailure, type NotificationQuery,
} from "./client";
import { toNotificationFailure } from "./failure";
import type {
  FacetsResult, MarkAllInput, MarkResultResult, MarkTarget, NotificationFailure, NotificationListResult, NotificationPreferences,
  NotificationState, PreferenceEntry, PreferencesResult, UnmarkTarget, UnreadCountResult,
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

/*
 * Two fixed sets of server actions, one per scope, instead of one set with a `scope` argument: a server action is a
 * public endpoint, so the scope is decided here on the server and never read from the browser's arguments. Each action
 * spreads the caller's input first and sets its own `scope` last, so a smuggled `scope` (or any path-like key) cannot
 * redirect a request; the client maps the scope to a fixed path.
 */

/** Grouped company inbox; the API gate (owner/recruiter/stakeholder) decides who reads it. */
export async function listNotificationsAction(input: NotificationQuery = {}): Promise<NotificationListResult> {
  return withToken(token => listNotifications({ ...input, token, scope: "company" }));
}

/** Bell counter: unread groups and unread notifications. */
export async function getUnreadCountAction(): Promise<UnreadCountResult> {
  return withToken(token => getUnreadCount(token, "company"));
}

/** Marks groups (`groupKeys`, 1–100) or notifications (`ids`, 1–200) read; keep `marked_at` for «Deshacer». */
export async function markReadAction(target: MarkTarget): Promise<MarkResultResult> {
  return withToken(token => markRead({ token, target, scope: "company" }));
}

/** Marks groups or notifications unread, or undoes exactly one earlier mark with `{ markedAt }`. */
export async function markUnreadAction(target: UnmarkTarget): Promise<MarkResultResult> {
  return withToken(token => markUnread({ token, target, scope: "company" }));
}

/** Marks everything matching the filters read, up to `before` (default: now on the server); empty filters are omitted. */
export async function markAllReadAction(input: MarkAllInput = {}): Promise<MarkResultResult> {
  return withToken(token => markAllRead({ ...input, token, scope: "company" }));
}

/** Filter popover counts per type and per job, over unread (default) or all groups. */
export async function getFacetsAction(state: NotificationState = "unread"): Promise<FacetsResult> {
  return withToken(token => getFacets({ token, state, scope: "company" }));
}

/*
 * Candidate inbox (T3.6, L14) on `/v2/me/notifications`, behind the /v2/me/applications gate: same shapes, items carry
 * `company` (or null), attention and sample are always empty. No candidate account → 403 `account_required` (a company
 * user gets `wrong_role`) → `forbidden`. Marking `candidate_message_received` read does not mark the message itself read
 * (contract Q4): that stays `PUT /v2/me/applications/{id}/message-read`, independent of these actions.
 */

export async function listCandidateNotificationsAction(input: NotificationQuery = {}): Promise<NotificationListResult> {
  return withToken(token => listNotifications({ ...input, token, scope: "candidate" }));
}

export async function getCandidateUnreadCountAction(): Promise<UnreadCountResult> {
  return withToken(token => getUnreadCount(token, "candidate"));
}

export async function markCandidateReadAction(target: MarkTarget): Promise<MarkResultResult> {
  return withToken(token => markRead({ token, target, scope: "candidate" }));
}

export async function markCandidateUnreadAction(target: UnmarkTarget): Promise<MarkResultResult> {
  return withToken(token => markUnread({ token, target, scope: "candidate" }));
}

export async function markAllCandidateReadAction(input: MarkAllInput = {}): Promise<MarkResultResult> {
  return withToken(token => markAllRead({ ...input, token, scope: "candidate" }));
}

export async function getCandidateFacetsAction(state: NotificationState = "unread"): Promise<FacetsResult> {
  return withToken(token => getFacets({ token, state, scope: "candidate" }));
}

/*
 * Personal preferences (T4.2, contract notifications-v2 E2 / L21), one fixed pair per scope like the inbox: members on
 * `/v2/me/company/notifications/preferences` (member gate; stakeholders get the catalog but the UI hides the page, Q7),
 * candidates on `/v2/me/notifications/preferences`. `catalog` is the GET answer the entries were built from, so an entry
 * on a `mandatory_locked` pair is refused here as `preference_locked` without a request.
 */

export async function getPreferencesAction(): Promise<PreferencesResult> {
  return withToken(token => getPreferences({ token, scope: "company" }));
}

export async function updatePreferencesAction(entries: readonly PreferenceEntry[], catalog?: NotificationPreferences): Promise<PreferencesResult> {
  return withToken(token => updatePreferences({ token, entries, catalog, scope: "company" }));
}

export async function getCandidatePreferencesAction(): Promise<PreferencesResult> {
  return withToken(token => getPreferences({ token, scope: "candidate" }));
}

export async function updateCandidatePreferencesAction(entries: readonly PreferenceEntry[], catalog?: NotificationPreferences): Promise<PreferencesResult> {
  return withToken(token => updatePreferences({ token, entries, catalog, scope: "candidate" }));
}
