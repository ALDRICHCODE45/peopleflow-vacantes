import "server-only";
import type { z } from "zod";
import { requestJson, type RequestJsonError } from "@/lib/api/server";
import { acceptedSchema, createdInvitationSchema, errorEnvelopeSchema, pendingListSchema, type Accepted, type CreatedInvitation, type PendingInvitation } from "./model";

const OWNER_PATH = "/v2/me/company/stakeholder-invitations";
const ACCEPT_PATH = "/v2/me/stakeholder-invitations/accept";

/** Only the status and the backend code cross into the actions; the backend text never does. */
export type InvitationClientFailure = { ok: false; error: RequestJsonError; code?: string };
export type InvitationClientResult<T> = { ok: true; data: T } | InvitationClientFailure;

async function call<T>(token: string, path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, method: "GET" | "POST", expectedStatus: number, body?: unknown): Promise<InvitationClientResult<T>> {
  const { serverEnv } = await import("@/lib/env/server");
  // Audit headers ride on every authenticated API call through the server fetch wrapper (lib/audit/install).
  const result = await requestJson(new URL(path, serverEnv.apiBaseUrl).toString(), {
    method, ...(body === undefined ? {} : { body }),
    headers: { authorization: `Bearer ${token.trim()}` }, redirect: "error", expectedStatus,
    timeoutMs: serverEnv.apiTimeoutMs, maxErrorBodyBytes: 8192,
    decoder: value => schema.parse(value), errorDecoder: value => errorEnvelopeSchema.parse(value),
  });
  return result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error, ...(result.envelope ? { code: result.envelope.code } : {}) };
}

export const createInvitation = (token: string): Promise<InvitationClientResult<CreatedInvitation>> => call(token, OWNER_PATH, createdInvitationSchema, "POST", 201);
export const listInvitations = async (token: string): Promise<InvitationClientResult<PendingInvitation[]>> => {
  const result = await call(token, OWNER_PATH, pendingListSchema, "GET", 200);
  return result.ok ? { ok: true, data: result.data.items } : result;
};
/** The token travels only in the JSON body, never in a URL the API or a proxy could log. */
export const acceptInvitation = (token: string, invitationToken: string): Promise<InvitationClientResult<Accepted>> =>
  call(token, ACCEPT_PATH, acceptedSchema, "POST", 200, { token: invitationToken });

/** DELETE answers 204 with no body, which the JSON transport cannot decode; revoking is idempotent on the API. */
export async function revokeInvitation(token: string, id: string): Promise<InvitationClientResult<null>> {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { serverEnv } = await import("@/lib/env/server");
    timer = setTimeout(() => { timedOut = true; controller.abort(); }, serverEnv.apiTimeoutMs);
    const base = new URL(serverEnv.apiBaseUrl);
    const url = new URL(`${OWNER_PATH}/${encodeURIComponent(id)}`, base);
    if (url.origin !== base.origin || !["https:", "http:"].includes(url.protocol)) return { ok: false, error: { kind: "invalid_response", retryable: false } };
    const response = await fetch(url, { method: "DELETE", headers: { authorization: `Bearer ${token.trim()}` }, cache: "no-store", redirect: "error", signal: controller.signal });
    let code: string | undefined;
    if (!response.ok) {
      const parsed = errorEnvelopeSchema.safeParse(await response.json().catch(() => null));
      if (parsed.success) code = parsed.data.code;
    } else void response.body?.cancel().catch(() => {});
    if (response.status === 204) return { ok: true, data: null };
    if (response.ok) return { ok: false, error: { kind: "invalid_response", retryable: false } };
    return { ok: false, error: { kind: "status", status: response.status, retryable: response.status === 429 || response.status >= 500 }, ...(code ? { code } : {}) };
  } catch {
    return { ok: false, error: timedOut ? { kind: "timeout", retryable: true } : { kind: "network", retryable: true } };
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
