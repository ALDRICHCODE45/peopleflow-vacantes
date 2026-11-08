import "server-only";
import type { z } from "zod";
import { boundedJson } from "@/features/candidate-cvs/bounded-body";
import { deadlineStream } from "@/features/org-candidates/detail/deadline-stream";
import { requestJson, type RequestJsonError } from "@/lib/api/server";
import {
  closuresSchema, complianceSchema, delaysSchema, originSchema, pipelineSchema, applicationListSchema, candidateListSchema,
  companyAccessSchema, deliveriesSchema, errorEnvelopeSchema, placementsSchema, reassignmentPageSchema, recruiterDetailSchema,
  recruiterPageSchema, summarySchema, UUID_PATTERN, vacancyPageSchema, type MetricsErrorEnvelope,
  deliveryListSchema, placementListSchema, reassignmentListSchema, vacancyListSchema, type DetailPage,
} from "./model";
import type { ListKind } from "./detail/query";
import type { Period } from "./period";

const PATH = "/v2/me/company/metrics";
export const LIST_LIMIT = 50;
export const RECRUITER_LIMIT = 100;

let envModule: Promise<typeof import("@/lib/env/server")> | undefined;
const loadServerEnv = async () => (await (envModule ??= import("@/lib/env/server"))).serverEnv;

export type MetricsClientFailure = {
  ok: false;
  error: { kind: RequestJsonError["kind"] | "missing_token" | "invalid_request"; retryable: boolean; status?: number };
  envelope?: MetricsErrorEnvelope;
};
const noToken: MetricsClientFailure = { ok: false, error: { kind: "missing_token", retryable: false } };
export const invalidRequest: MetricsClientFailure = { ok: false, error: { kind: "invalid_request", retryable: false } };

/**
 * Authenticated GET to the API. The Authorization header is what makes the server fetch wrapper add the audit
 * forwarding headers (`lib/audit/forward.ts`), so the audited detail records the person, not this server.
 */
async function get<T>(path: string, token: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, query?: URLSearchParams): Promise<{ ok: true; data: T } | MetricsClientFailure> {
  if (typeof token !== "string" || !token.trim()) return noToken;
  const serverEnv = await loadServerEnv();
  const result = await requestJson(new URL(`${path}${query?.size ? `?${query}` : ""}`, serverEnv.apiBaseUrl).toString(), {
    headers: { authorization: `Bearer ${token.trim()}` }, redirect: "error", expectedStatus: 200,
    timeoutMs: serverEnv.apiTimeoutMs, maxErrorBodyBytes: 8192,
    decoder: value => schema.parse(value), errorDecoder: value => errorEnvelopeSchema.parse(value),
  });
  return result.ok ? { ok: true, data: result.data } : { ...result, error: { ...result.error, retryable: false } };
}
const paged = (query: URLSearchParams, limit: number, cursor?: string) => {
  const params = new URLSearchParams(query);
  params.set("limit", String(limit));
  if (cursor) params.set("cursor", cursor);
  return params;
};

export const getCompanyAccess = (token: string) => get("/me/company", token, companyAccessSchema);
export const getSummary = (token: string, query: URLSearchParams) => get(`${PATH}/summary`, token, summarySchema, query);
/** v2 §4: the board sections, each its own route with the common filters, all served from one snapshot. */
export const getClosures = (token: string, query: URLSearchParams) => get(`${PATH}/closures`, token, closuresSchema, query);
export const getCompliance = (token: string, query: URLSearchParams) => get(`${PATH}/compliance`, token, complianceSchema, query);
export const getDelays = (token: string, query: URLSearchParams) => get(`${PATH}/delays`, token, delaysSchema, query);
export const getOrigin = (token: string, query: URLSearchParams) => get(`${PATH}/origin`, token, originSchema, query);
/** v2 §4.4: current state; the period is validated and echoed by the API, never applied. */
export const getPipeline = (token: string, query: URLSearchParams) => get(`${PATH}/pipeline`, token, pipelineSchema, query);
export const listRecruiters = (token: string, query: URLSearchParams, cursor?: string) => get(`${PATH}/recruiters`, token, recruiterPageSchema, paged(query, RECRUITER_LIMIT, cursor));
export const listVacancies = (token: string, query: URLSearchParams, cursor?: string) => get(`${PATH}/vacancies`, token, vacancyPageSchema, paged(query, LIST_LIMIT, cursor));
export const listReassignments = (token: string, query: URLSearchParams, cursor?: string) => get(`${PATH}/reassignments`, token, reassignmentPageSchema, paged(query, LIST_LIMIT, cursor));

/** Path ids are user and draft ids; anything else never becomes part of an API path. */
export async function getRecruiter(token: string, userId: string, query: URLSearchParams) {
  if (!UUID_PATTERN.test(userId)) return invalidRequest;
  return get(`${PATH}/recruiters/${userId}`, token, recruiterDetailSchema, query);
}
/**
 * §3.5: each successful read writes one `MetricsDetailViewed` row in the read's transaction; a failure carries no names.
 * §3.7.9: the detail is not narrowed by the period, but like every metrics route it requires `from` and `to`; it is
 * not paginated, so nothing else travels.
 */
const periodQuery = ({ from, to }: Period) => new URLSearchParams({ from, to });
export async function getDeliveries(token: string, draftId: string, period: Period) {
  if (!UUID_PATTERN.test(draftId)) return invalidRequest;
  return get(`${PATH}/vacancies/${draftId}/deliveries`, token, deliveriesSchema, periodQuery(period));
}
export async function getPlacements(token: string, draftId: string, period: Period) {
  if (!UUID_PATTERN.test(draftId)) return invalidRequest;
  return get(`${PATH}/vacancies/${draftId}/placements`, token, placementsSchema, periodQuery(period));
}

/**
 * v2 §5: one page of a detail list. `kind` picks a fixed route (never a path built from input) and the query is the
 * page's validated one; the cursor is opaque and bound by the API to the filters, sort and order.
 */
export async function listDetail(token: string, kind: ListKind, query: URLSearchParams, cursor?: string): Promise<{ ok: true; data: DetailPage } | MetricsClientFailure> {
  const params = paged(query, LIST_LIMIT, cursor);
  switch (kind) {
    case "deliveries": { const r = await get(`${PATH}/deliveries`, token, deliveryListSchema, params); return r.ok ? { ok: true, data: { kind, page: r.data } } : r; }
    case "vacancies": { const r = await get(`${PATH}/vacancies`, token, vacancyListSchema, params); return r.ok ? { ok: true, data: { kind, page: r.data } } : r; }
    case "placements": { const r = await get(`${PATH}/placements`, token, placementListSchema, params); return r.ok ? { ok: true, data: { kind, page: r.data } } : r; }
    case "reassignments": { const r = await get(`${PATH}/reassignments`, token, reassignmentListSchema, params); return r.ok ? { ok: true, data: { kind, page: r.data } } : r; }
    case "candidates": { const r = await get(`${PATH}/candidates`, token, candidateListSchema, params); return r.ok ? { ok: true, data: { kind, page: r.data } } : r; }
    case "applications": { const r = await get(`${PATH}/applications`, token, applicationListSchema, params); return r.ok ? { ok: true, data: { kind, page: r.data } } : r; }
    default: return invalidRequest;
  }
}

/** The count runs before the first byte, so headers answer fast; the file itself may stream for a while. */
const EXPORT_STREAM_TIMEOUT_MS = 120_000;
const CSV_CONTENT_TYPE = /^text\/csv(?:\s*;|$)/i;
const ATTACHMENT = /^attachment(?:\s*;|$)/i;
export type MetricsCsv = { body: ReadableStream<Uint8Array>; contentType: string; disposition: string };
/**
 * v2 §8 `GET …/{kind}/export`: the list's filters, sort and order, no cursor or limit. Every error is decided before the
 * first byte (placements and candidates write their audit row first), so a 200 is the CSV, streamed without buffering.
 */
export async function exportDetail(token: string, kind: ListKind, query: URLSearchParams): Promise<{ ok: true; data: MetricsCsv } | MetricsClientFailure> {
  if (typeof token !== "string" || !token.trim()) return noToken;
  const path = ({
    deliveries: "deliveries", vacancies: "vacancies", placements: "placements", reassignments: "reassignments", candidates: "candidates", applications: "applications",
  } as Record<string, string>)[kind];
  if (!path) return invalidRequest;
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (ms: number) => { timer = setTimeout(() => { timedOut = true; controller.abort(); }, ms); };
  try {
    const serverEnv = await loadServerEnv();
    arm(serverEnv.apiTimeoutMs);
    const base = new URL(serverEnv.apiBaseUrl);
    const url = new URL(`${PATH}/${path}/export${query.size ? `?${query}` : ""}`, base);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== base.origin || url.username || url.password) return invalidRequest;
    const response = await fetch(url, { method: "GET", cache: "no-store", redirect: "error", signal: controller.signal, headers: { authorization: `Bearer ${token.trim()}`, accept: "text/csv" } });
    if (!response.ok) {
      let envelope: MetricsErrorEnvelope | undefined;
      try { envelope = errorEnvelopeSchema.parse(await boundedJson(response, 8192, controller.signal)); } catch { /* Never expose upstream text. */ }
      return { ok: false, error: { kind: "status", retryable: false, status: response.status }, ...(envelope ? { envelope } : {}) };
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
  } catch { return { ok: false, error: { kind: timedOut ? "timeout" : "network", retryable: false } }; }
  finally { if (timer) clearTimeout(timer); }
}
