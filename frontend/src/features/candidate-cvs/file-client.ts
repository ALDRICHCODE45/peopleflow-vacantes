import "server-only";
import { boundedJson } from "./bounded-body";
import { CONTENT_TYPES, cvSchema, errorEnvelopeSchema, type Cv, type CvLimits } from "./model";
import type { ClientResult } from "./client";
import type { ClientFailure } from "./failure";

async function backendError(response: Response, signal: AbortSignal): Promise<ClientFailure> {
  let envelope;
  try { envelope = errorEnvelopeSchema.parse(await boundedJson(response, 1024, signal)); } catch { /* No raw response is exposed. */ }
  return { ok: false, error: { kind: "status", status: response.status }, ...(envelope ? { envelope } : {}) };
}
/** Credentialed non-JSON transport stays server-only; redirects and inherited headers are forbidden. */
async function withBackend<T>(path: string, token: string, init: RequestInit, consume: (response: Response, signal: AbortSignal) => Promise<ClientResult<T>>): Promise<ClientResult<T>> {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { serverEnv } = await import("@/lib/env/server");
    timer = setTimeout(() => { timedOut = true; controller.abort(); }, serverEnv.apiTimeoutMs);
    const headers = new Headers({ authorization: `Bearer ${token}` });
    const response = await fetch(new URL(path, serverEnv.apiBaseUrl).toString(), { ...init, headers, cache: "no-store", redirect: "error", signal: controller.signal });
    if (!response.ok) return await backendError(response, controller.signal);
    return await consume(response, controller.signal);
  } catch {
    return { ok: false, error: { kind: timedOut ? "timeout" : "network" } };
  } finally { if (timer) clearTimeout(timer); }
}
export function deleteFile(token: string, id: string): Promise<ClientResult<null>> {
  return withBackend(`/v2/me/cvs/${id}`, token, { method: "DELETE" }, async response => {
    void response.body?.cancel().catch(() => {});
    return response.status === 204 ? { ok: true, data: null } : { ok: false, error: { kind: "invalid_response" } };
  });
}
export function uploadFile(token: string, body: FormData, limits: CvLimits): Promise<ClientResult<Cv>> {
  return withBackend("/v2/me/cvs", token, { method: "POST", body }, async (response, signal) => {
    if (response.status !== 201) { void response.body?.cancel().catch(() => {}); return { ok: false, error: { kind: "invalid_response" } }; }
    try {
      const cv = cvSchema.parse(await boundedJson(response, 4096, signal));
      if (cv.size > limits.max_bytes || !limits.content_types.includes(cv.content_type)) throw new Error("Invalid CV");
      return { ok: true, data: cv };
    } catch { return { ok: false, error: { kind: signal.aborted ? "timeout" : "invalid_response" } }; }
  });
}
export type Download = { body: ReadableStream<Uint8Array>; contentType: string; disposition: string };
export function downloadFile(token: string, id: string): Promise<ClientResult<Download>> {
  return withBackend(`/v2/me/cvs/${id}/file`, token, { method: "GET" }, async response => {
    const contentType = response.headers.get("content-type");
    const disposition = response.headers.get("content-disposition");
    if (response.status !== 200 || !response.body || !(CONTENT_TYPES as readonly (string | null)[]).includes(contentType) || !disposition || !/^attachment(?:;|$)/i.test(disposition) || /[\r\n]/.test(disposition)) {
      void response.body?.cancel().catch(() => {});
      return { ok: false, error: { kind: "invalid_response" } };
    }
    return { ok: true, data: { body: response.body, contentType: contentType!, disposition } };
  });
}
