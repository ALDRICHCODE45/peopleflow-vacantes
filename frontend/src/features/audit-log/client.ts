import "server-only";
import type { z } from "zod";
import { boundedJson } from "@/features/candidate-cvs/bounded-body";
import { deadlineStream } from "@/features/org-candidates/detail/deadline-stream";
import { requestJson, type RequestJsonError } from "@/lib/api/server";
import {
  actorsSchema, auditEventPageSchema, auditTypesSchema, auditVacanciesSchema, errorEnvelopeSchema, parseExportBody,
  type AuditErrorEnvelope, type AuditEventPage,
} from "./model";
import { serializeFilters, type AuditExportBody, type AuditQuery } from "./url-state";

const PATH = "/v2/me/company/audit-events";
export const DEFAULT_LIMIT = 50;
/** The export count runs before the first byte, so headers answer fast; the file itself may stream for a while. */
const EXPORT_STREAM_TIMEOUT_MS = 120_000;
const CSV_CONTENT_TYPE = /^text\/csv(?:\s*;|$)/i;
const ATTACHMENT = /^attachment(?:\s*;|$)/i;

// One import for the three catalogs read in parallel; env validation also runs once.
let envModule: Promise<typeof import("@/lib/env/server")> | undefined;
const loadServerEnv = async () => (await (envModule ??= import("@/lib/env/server"))).serverEnv;

export type AuditClientFailure = {
  ok: false;
  error: { kind: RequestJsonError["kind"] | "missing_token" | "invalid_request"; retryable: boolean; status?: number };
  envelope?: AuditErrorEnvelope;
};
const noToken: AuditClientFailure = { ok: false, error: { kind: "missing_token", retryable: false } };
const invalidRequest: AuditClientFailure = { ok: false, error: { kind: "invalid_request", retryable: false } };

async function get<T>(path: string, token: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, query?: URLSearchParams) {
  if (typeof token !== "string" || !token.trim()) return noToken;
  const serverEnv = await loadServerEnv();
  const result = await requestJson(new URL(`${path}${query?.size ? `?${query}` : ""}`, serverEnv.apiBaseUrl).toString(), {
    headers: { authorization: `Bearer ${token.trim()}` }, redirect: "error", expectedStatus: 200,
    timeoutMs: serverEnv.apiTimeoutMs, maxErrorBodyBytes: 8192,
    decoder: value => schema.parse(value), errorDecoder: value => errorEnvelopeSchema.parse(value),
  });
  return result.ok ? result : { ...result, error: { ...result.error, retryable: false } };
}

export async function listAuditEvents(input: AuditQuery & { token: string }): Promise<{ ok: true; data: AuditEventPage } | AuditClientFailure> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (input.cursor !== undefined && typeof input.cursor !== "string")) return typeof input.token === "string" && input.token.trim() ? invalidRequest : noToken;
  const params = serializeFilters(input.filters ?? {});
  params.set("limit", String(limit));
  if (input.cursor !== undefined) params.set("cursor", input.cursor);
  return get(PATH, input.token, auditEventPageSchema, params);
}
export const getAuditTypes = (token: string) => get(`${PATH}/types`, token, auditTypesSchema);
export const getAuditActors = (token: string) => get(`${PATH}/actors`, token, actorsSchema);
export const getAuditVacancies = (token: string) => get(`${PATH}/vacancies`, token, auditVacanciesSchema);

export type AuditCsv = { body: ReadableStream<Uint8Array>; contentType: string; disposition: string };

/** POST …/export: a 200 is a CSV attachment streamed to the caller; every error is decided before the first byte. */
export async function exportAuditCsv(token: string, body: AuditExportBody): Promise<{ ok: true; data: AuditCsv } | AuditClientFailure> {
  if (typeof token !== "string" || !token.trim()) return noToken;
  const parsed = parseExportBody(body);
  if (!parsed.ok) return invalidRequest;
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (ms: number) => { timer = setTimeout(() => { timedOut = true; controller.abort(); }, ms); };
  try {
    const serverEnv = await loadServerEnv();
    arm(serverEnv.apiTimeoutMs);
    const base = new URL(serverEnv.apiBaseUrl);
    const url = new URL(`${PATH}/export`, base);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== base.origin || url.username || url.password) return invalidRequest;
    const response = await fetch(url, {
      method: "POST", cache: "no-store", redirect: "error", signal: controller.signal, body: JSON.stringify(parsed.data),
      headers: { authorization: `Bearer ${token.trim()}`, "content-type": "application/json", accept: "text/csv" },
    });
    if (!response.ok) {
      let envelope: AuditErrorEnvelope | undefined;
      try { envelope = errorEnvelopeSchema.parse(await boundedJson(response, 8192, controller.signal)); } catch { /* Never expose upstream text. */ }
      return { ok: false, error: { kind: "status", retryable: response.status === 429 || response.status >= 500, status: response.status }, ...(envelope ? { envelope } : {}) };
    }
    const contentType = response.headers.get("content-type");
    const disposition = response.headers.get("content-disposition");
    if (response.status !== 200 || !response.body || !contentType || !CSV_CONTENT_TYPE.test(contentType) || !disposition || !ATTACHMENT.test(disposition) || /[\r\n]/.test(disposition)) {
      void response.body?.cancel().catch(() => {});
      return { ok: false, error: { kind: "invalid_response", retryable: false } };
    }
    clearTimeout(timer);
    arm(EXPORT_STREAM_TIMEOUT_MS);
    const deadline = timer;
    const stream = deadlineStream(response.body, controller.signal, () => clearTimeout(deadline));
    timer = undefined; // The stream now owns deadline cleanup.
    return { ok: true, data: { body: stream, contentType, disposition } };
  } catch { return { ok: false, error: { kind: timedOut ? "timeout" : "network", retryable: true } }; }
  finally { if (timer) clearTimeout(timer); }
}
