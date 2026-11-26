import type { NotificationFailure } from "./model";

type ClientFailure = {
  error: { kind: string; status?: number };
  envelope?: { code: string; fields?: { field: string; code: string }[] };
};
const SAFE_CODES = new Set(["unauthenticated", "forbidden", "company_inactive", "invalid_filter", "invalid_cursor", "internal_error"]);

/** Only an allowlisted code and the status cross the boundary; the backend message never does. */
export function toNotificationFailure({ error, envelope }: ClientFailure): NotificationFailure {
  const status = error.status;
  const code = envelope && SAFE_CODES.has(envelope.code) ? envelope.code : undefined;
  const reference = { ...(status !== undefined ? { status } : {}), ...(code ? { code } : {}) };
  const fail = (reason: NotificationFailure["reason"], extra: Partial<NotificationFailure> = {}): NotificationFailure => ({ ok: false, reason, reference, ...extra });
  if (error.kind === "missing_token" || status === 401) return fail("unauthenticated");
  if (status === 403) return fail("forbidden");
  // A query refused locally is the same answer the backend would give.
  if (error.kind === "invalid_request") return fail("invalid_filter");
  if (status === 400 && code === "invalid_filter") return fail("invalid_filter", envelope?.fields ? { fields: envelope.fields } : {});
  if (status === 400 && code === "invalid_cursor") return fail("invalid_cursor");
  if (status !== undefined && status >= 500 && status < 600) return fail("server_error");
  if (error.kind === "network" || error.kind === "timeout") return fail("no_response");
  return fail("unrecognized_response");
}
