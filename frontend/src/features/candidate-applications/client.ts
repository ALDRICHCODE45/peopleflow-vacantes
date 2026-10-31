import "server-only";
import { requestJson } from "@/lib/api/server";
import { usableToken } from "@/features/candidate-cvs/client";
import { boundedJson } from "@/features/candidate-cvs/bounded-body";
import { applicationBodySchema, applicationsSchema, errorSchema, messageReadBodySchema, querySchema, screeningSchema, submittedSchema, uuidSchema, type ApplicationsPage, type ApplicationsQuery, type Screening, type Submitted } from "./model";
import type { ClientFailure } from "./failure";
export type ClientResult<T> = { ok: true; data: T } | ClientFailure;
const invalid = (): ClientFailure => ({ ok: false, error: { kind: "invalid_request" } });
export async function loadScreening(id: unknown): Promise<ClientResult<Screening>> {
  if (!uuidSchema.safeParse(id).success) return invalid();
  const { serverEnv } = await import("@/lib/env/server");
  return requestJson(new URL(`/v2/jobs/${id}/screening`, serverEnv.apiBaseUrl).toString(), { method: "GET", expectedStatus: 200, timeoutMs: serverEnv.apiTimeoutMs, decoder: value => screeningSchema.parse(value), errorDecoder: value => errorSchema.parse(value), maxErrorBodyBytes: 4096 });
}
export async function submitApplication({ token, id, key, body }: { token: string; id: unknown; key: unknown; body: unknown }): Promise<ClientResult<Submitted>> {
  if (!usableToken(token)) return { ok: false, error: { kind: "missing_token" } };
  const parsed = applicationBodySchema.safeParse(body);
  if (!uuidSchema.safeParse(id).success || !uuidSchema.safeParse(key).success || !parsed.success) return invalid();
  const { serverEnv } = await import("@/lib/env/server");
  return requestJson(new URL(`/v2/jobs/${id}/applications`, serverEnv.apiBaseUrl).toString(), {
    method: "POST", expectedStatus: 201, body: parsed.data, redirect: "error", headers: { authorization: `Bearer ${token}`, "idempotency-key": key as string }, timeoutMs: serverEnv.apiTimeoutMs,
    decoder: value => { const data = submittedSchema.parse(value); if (data.vacancy_id.toLowerCase() !== (id as string).toLowerCase()) throw new Error("Unexpected vacancy"); return data; },
    errorDecoder: value => errorSchema.parse(value), maxErrorBodyBytes: 65536,
  });
}
export async function loadApplications({ token, query = {} }: { token: string; query?: ApplicationsQuery }): Promise<ClientResult<ApplicationsPage>> {
  if (!usableToken(token)) return { ok: false, error: { kind: "missing_token" } };
  const parsed = querySchema.safeParse(query);
  if (!parsed.success) return invalid();
  const { serverEnv } = await import("@/lib/env/server");
  const url = new URL("/v2/me/applications", serverEnv.apiBaseUrl);
  for (const [name, value] of Object.entries(parsed.data)) if (value !== undefined) url.searchParams.set(name, String(value));
  return requestJson(url.toString(), { method: "GET", expectedStatus: 200, redirect: "error", headers: { authorization: `Bearer ${token}` }, timeoutMs: serverEnv.apiTimeoutMs, decoder: value => applicationsSchema.parse(value), errorDecoder: value => errorSchema.parse(value), maxErrorBodyBytes: 4096 });
}
/** 204 has no JSON body, so this bypasses requestJson; redirects and caching are refused like the other credentialed calls. */
export async function markMessageRead({ token, id, body }: { token: string; id: unknown; body: unknown }): Promise<ClientResult<null>> {
  if (!usableToken(token)) return { ok: false, error: { kind: "missing_token" } };
  const parsed = messageReadBodySchema.safeParse(body);
  if (!uuidSchema.safeParse(id).success || !parsed.success) return invalid();
  const { serverEnv } = await import("@/lib/env/server");
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, serverEnv.apiTimeoutMs);
  try {
    const response = await fetch(new URL(`/v2/me/applications/${id}/message-read`, serverEnv.apiBaseUrl).toString(), {
      method: "PUT", cache: "no-store", redirect: "error", signal: controller.signal,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(parsed.data),
    });
    if (response.status === 204) { void response.body?.cancel().catch(() => {}); return { ok: true, data: null }; }
    if (response.ok) { void response.body?.cancel().catch(() => {}); return { ok: false, error: { kind: "invalid_response" } }; }
    let envelope;
    try { envelope = errorSchema.parse(await boundedJson(response, 4096, controller.signal)); } catch { /* No raw response is exposed. */ }
    return { ok: false, error: { kind: "status", status: response.status }, ...(envelope ? { envelope } : {}) };
  } catch {
    return { ok: false, error: { kind: timedOut ? "timeout" : "network" } };
  } finally { clearTimeout(timer); }
}
