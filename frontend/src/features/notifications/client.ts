import "server-only";
import { z } from "zod";
import { boundedJson } from "@/features/candidate-cvs/bounded-body";
import { requestJson, type RequestJsonError } from "@/lib/api/server";
import { auditForwardHeaders, parseAuditForwardEnv } from "@/lib/audit/forward";
import {
  errorEnvelopeSchema, facetsSchema, isKnownNotificationType, markResultSchema, MAX_PREFERENCE_ENTRIES, NOTIFICATION_CHANNELS,
  NOTIFICATION_STATES, NOTIFICATION_TYPES, notificationPageSchema, PREFERENCE_TYPE_PATTERN, preferencesSchema, unreadCountSchema,
  type FilterIssue, type MarkAllInput, type MarkResult, type MarkTarget, type NotificationErrorEnvelope, type NotificationFacets,
  type NotificationPage, type NotificationPreferences, type NotificationScope, type NotificationState, type NotificationType,
  type PreferenceEntry, type UnmarkTarget, type UnreadCount, type UnsubscribeState, unsubscribeStateSchema,
} from "./model";
import { warnForwardingDisabled } from "./unsubscribe-log";

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
  error: { kind: RequestJsonError["kind"] | "missing_token" | "invalid_request" | "invalid_body" | "preference_locked" | "invalid_link"; retryable: boolean; status?: number };
  envelope?: NotificationErrorEnvelope;
  /** Local body issues (`invalid_body`), named and coded as the backend's 400 `validation_error` would. */
  fields?: FilterIssue[];
  /** Local `preference_locked`: types of the entries that target a locked pair of the catalog they were built from. */
  lockedTypes?: string[];
  /** 429 only: a well-formed Retry-After (delta seconds or IMF-fixdate). */
  retryAfter?: string;
};
type ClientResult<T> = Promise<{ ok: true; data: T } | NotificationClientFailure>;
const noToken: NotificationClientFailure = { ok: false, error: { kind: "missing_token", retryable: false } };
const invalidRequest: NotificationClientFailure = { ok: false, error: { kind: "invalid_request", retryable: false } };
const invalidBody = (fields: FilterIssue[]): NotificationClientFailure => ({ ok: false, error: { kind: "invalid_body", retryable: false }, fields });
const hasToken = (token: unknown): token is string => typeof token === "string" && !!token.trim();

async function call<T>(
  path: string, token: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  { query, body, method = "POST" }: { query?: URLSearchParams; body?: object; method?: "POST" | "PUT" } = {},
): ClientResult<T> {
  if (!hasToken(token)) return noToken;
  const serverEnv = await loadServerEnv();
  const result = await requestJson(new URL(`${path}${query?.size ? `?${query}` : ""}`, serverEnv.apiBaseUrl).toString(), {
    ...(body ? { method, body } : {}),
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

/*
 * Personal preferences (contract notifications-v2, E2 / L21): `GET …/preferences` → the caller's full catalog;
 * `PUT …/preferences` with `{preferences: [{type, channel, enabled}]}` (1–28, atomic, idempotent) → the full catalog.
 */

/** PUT body checks in the backend's order and names; each entry is rebuilt from the three contract keys only. */
function toPreferencesBody(entries: unknown): { body: { preferences: PreferenceEntry[] } } | { fields: FilterIssue[] } {
  if (!Array.isArray(entries)) return { fields: [{ field: "preferences", code: "required" }] };
  if (entries.length === 0) return { fields: [{ field: "preferences", code: "empty" }] };
  if (entries.length > MAX_PREFERENCE_ENTRIES) return { fields: [{ field: "preferences", code: "too_many" }] };
  const issues: FilterIssue[] = [];
  const seen = new Set<string>();
  const preferences: PreferenceEntry[] = [];
  entries.forEach((entry: unknown, index) => {
    const at = `preferences[${index}]`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) { issues.push({ field: at, code: "invalid" }); return; }
    const { type, channel, enabled } = entry as Record<string, unknown>;
    const before = issues.length;
    if (type === undefined) issues.push({ field: `${at}.type`, code: "required" });
    else if (typeof type !== "string" || !PREFERENCE_TYPE_PATTERN.test(type)) issues.push({ field: `${at}.type`, code: "invalid" });
    if (channel === undefined) issues.push({ field: `${at}.channel`, code: "required" });
    else if (!(NOTIFICATION_CHANNELS as readonly unknown[]).includes(channel)) issues.push({ field: `${at}.channel`, code: "invalid" });
    if (enabled === undefined) issues.push({ field: `${at}.enabled`, code: "required" });
    else if (typeof enabled !== "boolean") issues.push({ field: `${at}.enabled`, code: "invalid" });
    if (issues.length > before) return;
    const pair = `${type}:${channel}`;
    if (seen.has(pair)) { issues.push({ field: at, code: "duplicate" }); return; }
    seen.add(pair);
    preferences.push({ type: type as string, channel: channel as PreferenceEntry["channel"], enabled: enabled as boolean });
  });
  return issues.length ? { fields: issues } : { body: { preferences } };
}

/** Types of the entries whose (type, channel) pair is `mandatory_locked` in the catalog they were built from. */
function lockedTypesOf(entries: readonly PreferenceEntry[], catalog: unknown): string[] {
  // The catalog comes back from the browser through a server action: decode it, and ignore it when it is not one.
  const decoded = catalog === undefined ? null : preferencesSchema.safeParse(catalog);
  if (!decoded?.success) return [];
  const { items } = decoded.data;
  const locked = entries.filter(entry => items.find(item => item.type === entry.type)?.channels[entry.channel].mandatory_locked);
  return [...new Set(locked.map(entry => entry.type))];
}

export async function getPreferences(input: Scoped & { token: string }): ClientResult<NotificationPreferences> {
  if (!hasToken(input.token)) return noToken;
  const path = basePath(input.scope);
  return path ? call(`${path}/preferences`, input.token, preferencesSchema) : invalidRequest;
}

/**
 * `PUT …/preferences`. `catalog` is the GET answer the entries were built from: an entry on a pair it marks
 * `mandatory_locked` is refused locally as `preference_locked` (the backend's 422) and nothing is sent.
 */
export async function updatePreferences(
  input: Scoped & { token: string; entries: readonly PreferenceEntry[]; catalog?: NotificationPreferences },
): ClientResult<NotificationPreferences> {
  if (!hasToken(input.token)) return noToken;
  const path = basePath(input.scope);
  if (!path) return invalidRequest;
  const built = toPreferencesBody(input.entries);
  if ("fields" in built) return invalidBody(built.fields);
  const locked = lockedTypesOf(built.body.preferences, input.catalog);
  if (locked.length) return { ok: false, error: { kind: "preference_locked", retryable: false }, lockedTypes: locked };
  return call(`${path}/preferences`, input.token, preferencesSchema, { body: built.body, method: "PUT" });
}

/*
 * Email unsubscribe (contract v2 E7 / L23). Anonymous: the token is the only credential, so no session, cookie or
 * Authorization ever travels. Like the rest of the BFF, the call carries the proxy secret and the client IP
 * (`lib/audit/forward.ts`), which the backend's per-IP limiter trusts; the fetch wrapper only decorates authenticated
 * calls, so they are added here from the incoming request. The shared JSON transport cannot send a raw body or read
 * Retry-After, hence the one direct fetch. The token never reaches a log, an error or a returned value.
 */
const UNSUBSCRIBE_PATH = "/v2/notifications/unsubscribe";
/** Backend body cap for the one-click POST (RFC 8058 `List-Unsubscribe=One-Click`). */
export const UNSUBSCRIBE_MAX_BODY_BYTES = 1024;
const UNSUBSCRIBE_TOKEN = /^[A-Za-z0-9_.-]{1,512}$/;
const RETRY_AFTER = /^(?:\d{1,10}|[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT)$/;
/** A plain media type with simple or quoted parameters (multipart boundaries included), at most 256 characters. */
const CONTENT_TYPE = /^(?=[\s\S]{1,256}$)[\w.+-]+\/[\w.+-]+(?:[ \t]*;[ \t]*[\w-]+=(?:"[^"\r\n]*"|[^\s;"]+))*$/;

/** Shape only (signed tokens are opaque): 1–512 characters of `[A-Za-z0-9_.-]`. */
export const isUnsubscribeTokenShape = (token: unknown): token is string => typeof token === "string" && UNSUBSCRIBE_TOKEN.test(token);

export type UnsubscribeInput = { token: unknown; incoming: Headers };
const invalidLink: NotificationClientFailure = { ok: false, error: { kind: "invalid_link", retryable: false } };
/** The backend's own answer to an oversized body, given locally without a request. */
const tooLarge: NotificationClientFailure = { ok: false, error: { kind: "status", retryable: false, status: 413 } };

type UnsubscribeInit = { method: "GET" } | { method: "POST"; body: Uint8Array; contentType?: string | null };
async function unsubscribeRequest(input: UnsubscribeInput, init: { method: "GET" }): ClientResult<UnsubscribeState>;
async function unsubscribeRequest(input: UnsubscribeInput, init: UnsubscribeInit): ClientResult<UnsubscribeState | null>;
async function unsubscribeRequest(input: UnsubscribeInput, init: UnsubscribeInit): ClientResult<UnsubscribeState | null> {
  if (!isUnsubscribeTokenShape(input.token)) return invalidLink;
  if (init.method === "POST" && init.body.byteLength > UNSUBSCRIBE_MAX_BODY_BYTES) return tooLarge;
  try {
    const serverEnv = await loadServerEnv();
    const origin = new URL(serverEnv.apiBaseUrl);
    const url = new URL(`${UNSUBSCRIBE_PATH}?${new URLSearchParams({ token: input.token })}`, origin);
    if (url.origin !== origin.origin || !["http:", "https:"].includes(url.protocol)) return invalidRequest;
    const forwarding = parseAuditForwardEnv(process.env);
    if (!forwarding) warnForwardingDisabled();
    const headers = new Headers({ accept: "application/json", ...(forwarding ? auditForwardHeaders({ ...forwarding, apiOrigin: origin.origin }, input.incoming) : {}) });
    if (init.method === "POST") headers.set("content-type", init.contentType && CONTENT_TYPE.test(init.contentType) ? init.contentType : "application/x-www-form-urlencoded");
    const signal = AbortSignal.timeout(serverEnv.apiTimeoutMs);
    const response = await fetch(url, {
      method: init.method, headers, ...(init.method === "POST" ? { body: init.body as BodyInit } : {}),
      cache: "no-store", redirect: "error", credentials: "omit", referrerPolicy: "no-referrer", signal,
    });
    const status = response.status;
    if (status === 200) {
      try { return { ok: true, data: unsubscribeStateSchema.parse(await boundedJson(response, 8192, signal)) }; }
      catch {
        // A POST 200 has already turned the email off: report it as done, only without the state (R4).
        if (init.method === "POST") { void response.body?.cancel().catch(() => {}); return { ok: true, data: null }; }
        return { ok: false, error: { kind: "invalid_response", retryable: false } };
      }
    }
    if (response.ok) { void response.body?.cancel().catch(() => {}); return { ok: false, error: { kind: "invalid_response", retryable: false } }; }
    let envelope: NotificationErrorEnvelope | undefined;
    try { envelope = errorEnvelopeSchema.parse(await boundedJson(response, 8192, signal)); } catch { /* The status stays authoritative. */ }
    const retryAfter = status === 429 ? response.headers.get("retry-after") : null;
    return {
      ok: false, error: { kind: "status", retryable: false, status },
      ...(envelope ? { envelope } : {}), ...(retryAfter && RETRY_AFTER.test(retryAfter) ? { retryAfter } : {}),
    };
  } catch (error) {
    return { ok: false, error: { kind: error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "network", retryable: false } };
  }
}

/** `GET …/unsubscribe?token=` — the link's current state; never changes anything. */
export const getUnsubscribe = (input: UnsubscribeInput): ClientResult<UnsubscribeState> => unsubscribeRequest(input, { method: "GET" });

/**
 * `POST …/unsubscribe?token=` with the raw body (≤ 1 KiB) — turns the email off; idempotent. Any 200 is success: the
 * state when it parses, otherwise `null` (the mutation is committed either way).
 */
export const postUnsubscribe = (input: UnsubscribeInput & { body: Uint8Array; contentType?: string | null }): ClientResult<UnsubscribeState | null> =>
  unsubscribeRequest(input, { method: "POST", body: input.body, contentType: input.contentType });
