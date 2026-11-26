"use server";

import { getActionAccessToken } from "@/lib/auth/action-session";
import { getUnreadCount, listNotifications, type NotificationQuery } from "./client";
import { toNotificationFailure } from "./failure";
import type { NotificationFailure, NotificationListResult, UnreadCountResult } from "./model";

const unauthenticated: NotificationFailure = { ok: false, reason: "unauthenticated", reference: {} };
const noResponse: NotificationFailure = { ok: false, reason: "no_response", reference: {} };

/** Grouped company inbox; the API gate (owner/recruiter/stakeholder) decides who reads it. */
export async function listNotificationsAction(input: NotificationQuery = {}): Promise<NotificationListResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return unauthenticated;
    const result = await listNotifications({ ...input, token });
    return result.ok ? result : toNotificationFailure(result);
  } catch { return noResponse; }
}

/** Bell counter: unread groups and unread notifications. */
export async function getUnreadCountAction(): Promise<UnreadCountResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return unauthenticated;
    const result = await getUnreadCount(token);
    return result.ok ? result : toNotificationFailure(result);
  } catch { return noResponse; }
}
