import "server-only";
import type { NotificationFailure } from "./model";

/*
 * Server log lines of the email unsubscribe (R4). No logger exists in `lib/`, so this follows the console convention of
 * the other BFF clients with a fixed prefix. A line carries where it happened, the failure reason and the HTTP status:
 * never the token, a body, a header, the client IP or the proxy secret.
 */
export const UNSUBSCRIBE_LOG_PREFIX = "[notifications/unsubscribe]";

export type UnsubscribeLogSite = "one_click" | "landing_read" | "landing_confirm";

/** A failure the user sees as «unavailable» / «Reintentar» (5xx, network, timeout, a contract break). */
export function logUnsubscribeFailure(site: UnsubscribeLogSite, failure: NotificationFailure) {
  console.error(`${UNSUBSCRIBE_LOG_PREFIX} ${site} failed`, { reason: failure.reason, status: failure.reference.status ?? null });
}

let forwardingWarned = false;
/** Once per process, outside development and tests: without the proxy secret the backend sees the BFF address for everyone. */
export function warnForwardingDisabled() {
  const env = process.env.NODE_ENV;
  if (forwardingWarned || env === "development" || env === "test") return;
  forwardingWarned = true;
  console.warn(`${UNSUBSCRIBE_LOG_PREFIX} proxy forwarding disabled: AUDIT_PROXY_SECRET is not set, so no client IP reaches the backend limiter`);
}
