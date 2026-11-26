import "server-only";
import { z } from "zod";
import { requestJson, type RequestJsonError } from "@/lib/api/server";
import {
  errorEnvelopeSchema, facetsSchema, isKnownNotificationType, markResultSchema, NOTIFICATION_STATES, NOTIFICATION_TYPES,
  notificationPageSchema, unreadCountSchema,
  type FilterIssue, type MarkAllInput, type MarkResult, type MarkTarget, type NotificationErrorEnvelope, type NotificationFacets,
  type NotificationPage, type NotificationScope, type NotificationState, type NotificationType, type UnmarkTarget, type UnreadCount,
} from "./model";

/** Fixed base path per scope (L14); anything outside the enum is refused before a request. Default: company. */
const PATHS: Readonly<Record<NotificationScope, string>> = Object.freeze({
  company: "/v2/me/company/notifications",
  candidate: "/v2/me/notifications",
});
const basePath = (scope: unknown = "company"): string | null =>
  typeof scope === "string" && Object.hasOwn(PATHS, scope) ? PATHS[scope as NotificationScope] : null;
type Scoped = { scope?: NotificationScope };
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;
export const MAX_JOB_IDS = 20;
export const MAX_TYPES = NOTIFICATION_TYPES.length;
export const MAX_GROUP_KEYS = 100;
export const MAX_IDS = 200;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
/** D11 group keys: `n:<notification uuid>` or `<grouped prefix>:<job uuid>:<YYYY-MM-DD>` (backend `canonicalGroupKey`). */
const SINGLE_KEY = /^n:([^:]{36})$/;
const GROUPED_KEY = /^(?:applications|psychometrics|psychometrics_pending):([^:]{36}):(\d{4}-\d{2}-\d{2})$/;
const timestampSchema = z.string().datetime({ offset: true });

let envModule: Promise<typeof import("@/lib/env/server")> | undefined;
const loadServerEnv = async () => (await (envModule ??= import("@/lib/env/server"))).serverEnv;

export type NotificationQuery = {
  state?: NotificationState;
  types?: readonly NotificationType[];
  jobIds?: readonly string[];
  cursor?: string;
  limit?: number;
};
export type NotificationClientFailure = {
  ok: false;
  error: { kind: RequestJsonError["kind"] | "missing_token" | "invalid_request" | "invalid_body"; retryable: boolean; status?: number };
  envelope?: NotificationErrorEnvelope;
  /** Local body issues (`invalid_body`), named and coded as the backend's 400 `validation_error` would. */
  fields?: FilterIssue[];
};
type ClientResult<T> = Promise<{ ok: true; data: T } | NotificationClientFailure>;
const noToken: NotificationClientFailure = { ok: false, error: { kind: "missing_token", retryable: false } };
const invalidRequest: NotificationClientFailure = { ok: false, error: { kind: "invalid_request", retryable: false } };
const invalidBody = (fields: FilterIssue[]): NotificationClientFailure => ({ ok: false, error: { kind: "invalid_body", retryable: false }, fields });
const hasToken = (token: unknown): token is string => typeof token === "string" && !!token.trim();

async function call<T>(
  path: string, token: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  { query, body }: { query?: URLSearchParams; body?: object } = {},
): ClientResult<T> {
  if (!hasToken(token)) return noToken;
  const serverEnv = await loadServerEnv();
  const result = await requestJson(new URL(`${path}${query?.size ? `?${query}` : ""}`, serverEnv.apiBaseUrl).toString(), {
    ...(body ? { method: "POST", body } : {}),
    headers: { authorization: `Bearer ${token.trim()}` }, redirect: "error", expectedStatus: 200,
    timeoutMs: serverEnv.apiTimeoutMs, maxErrorBodyBytes: 8192,
    decoder: value => schema.parse(value), errorDecoder: value => errorEnvelopeSchema.parse(value),
  });
  return result.ok ? result : { ...result, error: { ...result.error, retryable: false } };
}

const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");
const isUuid = (value: string) => UUID_PATTERN.test(value) && value !== NIL_UUID;
const isDay = (value: string) => { const day = new Date(`${value}T00:00:00Z`); return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value; };
const isGroupKey = (value: string) => {
  const single = SINGLE_KEY.exec(value);
  if (single) return isUuid(single[1]);
  const grouped = GROUPED_KEY.exec(value);
  return !!grouped && isUuid(grouped[1]) && isDay(grouped[2]);
};
const isTimestamp = (value: unknown): value is string => timestampSchema.safeParse(value).success;

/** Only the contract's query travels: anything else is refused before a request is made. */
function toQuery(input: NotificationQuery): URLSearchParams | null {
  const limit = input.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return null;
  if (input.state !== undefined && !(NOTIFICATION_STATES as readonly string[]).includes(input.state)) return null;
  if (input.types !== undefined && (!isStringList(input.types) || !input.types.every(isKnownNotificationType) || new Set(input.types).size !== input.types.length)) return null;
  if (input.jobIds !== undefined && (!isStringList(input.jobIds) || input.jobIds.length > MAX_JOB_IDS || !input.jobIds.every(id => UUID_PATTERN.test(id)) || new Set(input.jobIds).size !== input.jobIds.length)) return null;
  if (input.cursor !== undefined && (typeof input.cursor !== "string" || !input.cursor)) return null;
  const params = new URLSearchParams();
  if (input.state !== undefined) params.set("state", input.state);
  if (input.types?.length) params.set("types", input.types.join(","));
  if (input.jobIds?.length) params.set("job_ids", input.jobIds.join(","));
  if (input.cursor !== undefined) params.set("cursor", input.cursor);
  params.set("limit", String(limit));
  return params;
}

/** Backend `parseList` order: not a list or a bad value → invalid; empty → empty (unless omitted); over the limit → too_many. */
function listIssue(value: unknown, limit: number, valid: (item: string) => boolean): FilterIssue["code"] | undefined {
  if (!isStringList(value)) return "invalid";
  if (value.length === 0) return "empty";
  if (value.length > limit) return "too_many";
  return value.every(valid) ? undefined : "invalid";
}
const sorted = (issues: FilterIssue[]) => issues.sort((a, b) => a.field.localeCompare(b.field));

/** Read/unread body: exactly one of `group_keys`, `ids` or (unread only) `marked_at`; refused locally like the backend would. */
function toMarkBody(target: unknown, unread: boolean): { body: object } | { fields: FilterIssue[] } {
  if (typeof target !== "object" || target === null || Array.isArray(target)) return { fields: [{ field: "body", code: "required" }] };
  const entries = Object.entries(target).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return { fields: [{ field: "body", code: "required" }] };
  if (entries.length > 1 || !["groupKeys", "ids", "markedAt"].includes(entries[0][0])) return { fields: [{ field: "body", code: "invalid" }] };
  const [key, value] = entries[0];
  if (key === "markedAt") {
    if (!unread) return { fields: [{ field: "marked_at", code: "not_allowed" }] };
    return isTimestamp(value) ? { body: { marked_at: value } } : { fields: [{ field: "marked_at", code: "invalid" }] };
  }
  const [field, limit, valid] = key === "groupKeys" ? ["group_keys", MAX_GROUP_KEYS, isGroupKey] as const : ["ids", MAX_IDS, isUuid] as const;
  const code = listIssue(value, limit, valid);
  return code ? { fields: [{ field, code }] } : { body: { [field]: value } };
}

/** Read-all body: every key optional; an empty list is omitted (never sent), `{}` marks everything up to now. */
function toMarkAllBody(input: unknown): { body: object } | { fields: FilterIssue[] } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { fields: [{ field: "body", code: "invalid" }] };
  const { types, jobIds, before, ...rest } = input as Record<string, unknown>;
  if (Object.values(rest).some(value => value !== undefined)) return { fields: [{ field: "body", code: "invalid" }] };
  const body: Record<string, unknown> = {};
  const issues: FilterIssue[] = [];
  const list = (value: unknown, field: string, limit: number, valid: (item: string) => boolean) => {
    if (value === undefined || (Array.isArray(value) && value.length === 0)) return;
    const code = listIssue(value, limit, valid);
    if (code) issues.push({ field, code }); else body[field] = value;
  };
  list(types, "types", MAX_TYPES, isKnownNotificationType);
  list(jobIds, "job_ids", MAX_JOB_IDS, isUuid);
  if (before !== undefined) { if (isTimestamp(before)) body.before = before; else issues.push({ field: "before", code: "invalid" }); }
  return issues.length ? { fields: sorted(issues) } : { body };
}

export async function listNotifications(input: NotificationQuery & Scoped & { token: string }): ClientResult<NotificationPage> {
  if (!hasToken(input.token)) return noToken;
  const path = basePath(input.scope);
  const query = toQuery(input);
  return path && query ? call(path, input.token, notificationPageSchema, { query }) : invalidRequest;
}

export const getUnreadCount = (token: string, scope: NotificationScope = "company"): ClientResult<UnreadCount> => {
  const path = basePath(scope);
  return path ? call(`${path}/unread-count`, token, unreadCountSchema) : Promise.resolve(hasToken(token) ? invalidRequest : noToken);
};

async function mark(scope: unknown, action: string, token: string, built: { body: object } | { fields: FilterIssue[] }): ClientResult<MarkResult> {
  if (!hasToken(token)) return noToken;
  const path = basePath(scope);
  if (!path) return invalidRequest;
  return "fields" in built ? invalidBody(built.fields) : call(`${path}/${action}`, token, markResultSchema, { body: built.body });
}

/** `POST …/read` with `{group_keys}` (1–100) or `{ids}` (1–200). */
export const markRead = (input: Scoped & { token: string; target: MarkTarget }): ClientResult<MarkResult> =>
  mark(input.scope, "read", input.token, toMarkBody(input.target, false));

/** `POST …/unread` with `{group_keys}`, `{ids}` or `{marked_at}` (exact undo of an earlier mark). */
export const markUnread = (input: Scoped & { token: string; target: UnmarkTarget }): ClientResult<MarkResult> =>
  mark(input.scope, "unread", input.token, toMarkBody(input.target, true));

/** `POST …/read-all` with optional `types`, `job_ids`, `before`. */
export const markAllRead = (input: MarkAllInput & Scoped & { token: string }): ClientResult<MarkResult> => {
  const { token, scope, ...filters } = input;
  return mark(scope, "read-all", token, toMarkAllBody(filters));
};

/** `GET …/facets?state=unread|all`; the backend ignores every other filter. */
export async function getFacets(input: Scoped & { token: string; state: NotificationState }): ClientResult<NotificationFacets> {
  if (!hasToken(input.token)) return noToken;
  const path = basePath(input.scope);
  if (!path || !(NOTIFICATION_STATES as readonly string[]).includes(input.state)) return invalidRequest;
  return call(`${path}/facets`, input.token, facetsSchema, { query: new URLSearchParams({ state: input.state }) });
}
