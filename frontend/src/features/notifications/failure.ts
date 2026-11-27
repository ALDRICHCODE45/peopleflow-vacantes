import {
  PREFERENCE_FIELD_PATTERN, PREFERENCE_TYPE_PATTERN, VALIDATION_CODES, VALIDATION_FIELDS, type FilterIssue, type NotificationFailure,
} from "./model";

type ClientFailure = {
  error: { kind: string; status?: number };
  envelope?: { code: string; fields?: FilterIssue[]; data?: { types: unknown[] } };
  fields?: FilterIssue[];
  /** Local `preference_locked`: the types of the entries that target a locked pair. */
  lockedTypes?: string[];
  /** 429 only: the backend's Retry-After, already checked by the client. */
  retryAfter?: string;
};
const SAFE_CODES = new Set([
  "unauthenticated", "forbidden", "company_inactive", "invalid_filter", "invalid_cursor", "validation_error",
  "invalid_request", "payload_too_large", "internal_error",
  // Candidate routes (L14): no candidate account / a company user on the candidate gate; both 403 → forbidden.
  "account_required", "wrong_role",
  // Preferences PUT (L21): an entry on a mandatory type; 422 with `data.types`.
  "notification_preference_locked",
  // Email unsubscribe (L23): any invalid, expired, tampered or mandatory link (422); the limiter (429).
  "unsubscribe_link_invalid", "rate_limited",
]);
const isValidationIssue = ({ field, code }: FilterIssue) =>
  ((VALIDATION_FIELDS as readonly string[]).includes(field) || PREFERENCE_FIELD_PATTERN.test(field)) && (VALIDATION_CODES as readonly string[]).includes(code);
/** Type names only (snake_case enums), deduplicated; anything else in `data.types` is dropped. */
const typeNames = (values: readonly unknown[] = []) =>
  [...new Set(values.filter((value): value is string => typeof value === "string" && PREFERENCE_TYPE_PATTERN.test(value)))];

/** Only an allowlisted code and the status cross the boundary; the backend message never does. */
export function toNotificationFailure({ error, envelope, fields, lockedTypes, retryAfter }: ClientFailure): NotificationFailure {
  const status = error.status;
  const code = envelope && SAFE_CODES.has(envelope.code) ? envelope.code : undefined;
  const reference = { ...(status !== undefined ? { status } : {}), ...(code ? { code } : {}) };
  const fail = (reason: NotificationFailure["reason"], extra: Partial<NotificationFailure> = {}): NotificationFailure => ({ ok: false, reason, reference, ...extra });
  if (error.kind === "missing_token" || status === 401) return fail("unauthenticated");
  if (status === 403) return fail("forbidden");
  // A query or body refused locally is the same answer the backend would give.
  if (error.kind === "invalid_request") return fail("invalid_filter");
  if (error.kind === "invalid_body") return fail("validation_error", fields?.length ? { fields } : {});
  // A locked pair found locally is the same answer the backend's 422 would give.
  if (error.kind === "preference_locked") return fail("preference_locked", { lockedTypes: typeNames(lockedTypes) });
  if (status === 422 && code === "notification_preference_locked") return fail("preference_locked", { lockedTypes: typeNames(envelope?.data?.types) });
  // A malformed unsubscribe token found locally is the same answer the backend's 422 would give.
  if (error.kind === "invalid_link" || (status === 422 && code === "unsubscribe_link_invalid")) return fail("unsubscribe_link_invalid");
  if (status === 429) return fail("rate_limited", retryAfter ? { retryAfter } : {});
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
