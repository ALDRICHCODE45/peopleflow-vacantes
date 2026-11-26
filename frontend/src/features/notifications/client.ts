import "server-only";
import type { z } from "zod";
import { requestJson, type RequestJsonError } from "@/lib/api/server";
import {
  errorEnvelopeSchema, isKnownNotificationType, NOTIFICATION_STATES, notificationPageSchema, unreadCountSchema,
  type NotificationErrorEnvelope, type NotificationPage, type NotificationState, type NotificationType, type UnreadCount,
} from "./model";

const PATH = "/v2/me/company/notifications";
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;
export const MAX_JOB_IDS = 20;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  error: { kind: RequestJsonError["kind"] | "missing_token" | "invalid_request"; retryable: boolean; status?: number };
  envelope?: NotificationErrorEnvelope;
};
const noToken: NotificationClientFailure = { ok: false, error: { kind: "missing_token", retryable: false } };
const invalidRequest: NotificationClientFailure = { ok: false, error: { kind: "invalid_request", retryable: false } };
const hasToken = (token: unknown): token is string => typeof token === "string" && !!token.trim();

async function get<T>(path: string, token: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, query?: URLSearchParams) {
  if (!hasToken(token)) return noToken;
  const serverEnv = await loadServerEnv();
  const result = await requestJson(new URL(`${path}${query?.size ? `?${query}` : ""}`, serverEnv.apiBaseUrl).toString(), {
    headers: { authorization: `Bearer ${token.trim()}` }, redirect: "error", expectedStatus: 200,
    timeoutMs: serverEnv.apiTimeoutMs, maxErrorBodyBytes: 8192,
    decoder: value => schema.parse(value), errorDecoder: value => errorEnvelopeSchema.parse(value),
  });
  return result.ok ? result : { ...result, error: { ...result.error, retryable: false } };
}

const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");

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

export async function listNotifications(input: NotificationQuery & { token: string }): Promise<{ ok: true; data: NotificationPage } | NotificationClientFailure> {
  if (!hasToken(input.token)) return noToken;
  const query = toQuery(input);
  return query ? get(PATH, input.token, notificationPageSchema, query) : invalidRequest;
}

export const getUnreadCount = (token: string): Promise<{ ok: true; data: UnreadCount } | NotificationClientFailure> =>
  get(`${PATH}/unread-count`, token, unreadCountSchema);
