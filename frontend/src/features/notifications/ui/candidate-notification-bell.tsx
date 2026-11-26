"use client";
import { useIdentity } from "@/features/identity/identity-session";
import { NotificationBell } from "./notification-bell";

/**
 * Candidate header bell (T3.6, design 04): only for a signed-in candidate account. Visitors, pending accounts and the
 * loading frame get nothing, so no request is made for them; a refused read (403 `account_required` / `wrong_role`)
 * still degrades to an empty inbox with polling stopped.
 */
export function CandidateNotificationBell() {
  const { status, result } = useIdentity();
  if (status === "loading" || status === "unauthenticated" || !result?.ok || result.data.role !== "candidate") return null;
  return <NotificationBell scope="candidate" />;
}
