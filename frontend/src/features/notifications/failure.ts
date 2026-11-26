import { VALIDATION_CODES, VALIDATION_FIELDS, type FilterIssue, type NotificationFailure } from "./model";

type ClientFailure = {
  error: { kind: string; status?: number };
  envelope?: { code: string; fields?: FilterIssue[] };
  fields?: FilterIssue[];
};
const SAFE_CODES = new Set([
  "unauthenticated", "forbidden", "company_inactive", "invalid_filter", "invalid_cursor", "validation_error",
  "invalid_request", "payload_too_large", "internal_error",
]);
const isValidationIssue = ({ field, code }: FilterIssue) =>
  (VALIDATION_FIELDS as readonly string[]).includes(field) && (VALIDATION_CODES as readonly string[]).includes(code);

/** Only an allowlisted code and the status cross the boundary; the backend message never does. */
export function toNotificationFailure({ error, envelope, fields }: ClientFailure): NotificationFailure {
  const status = error.status;
  const code = envelope && SAFE_CODES.has(envelope.code) ? envelope.code : undefined;
  const reference = { ...(status !== undefined ? { status } : {}), ...(code ? { code } : {}) };
  const fail = (reason: NotificationFailure["reason"], extra: Partial<NotificationFailure> = {}): NotificationFailure => ({ ok: false, reason, reference, ...extra });
  if (error.kind === "missing_token" || status === 401) return fail("unauthenticated");
  if (status === 403) return fail("forbidden");
  // A query or body refused locally is the same answer the backend would give.
  if (error.kind === "invalid_request") return fail("invalid_filter");
  if (error.kind === "invalid_body") return fail("validation_error", fields?.length ? { fields } : {});
  if (status === 400 && code === "invalid_filter") return fail("invalid_filter", envelope?.fields ? { fields: envelope.fields } : {});
  if (status === 400 && code === "invalid_cursor") return fail("invalid_cursor");
  if (status === 400 && code === "validation_error") {
    const issues = envelope?.fields?.filter(isValidationIssue) ?? [];
    return fail("validation_error", issues.length ? { fields: issues.map(({ field, code }) => ({ field, code })) } : {});
  }
  if (status !== undefined && status >= 500 && status < 600) return fail("server_error");
  if (error.kind === "network" || error.kind === "timeout") return fail("no_response");
  // 413 payload_too_large and 400 invalid_request cannot follow a locally validated body: a contract break.
  return fail("unrecognized_response");
}
