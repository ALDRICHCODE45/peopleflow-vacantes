import "server-only";
import type { z } from "zod";
import { requestJson, type RequestJsonError } from "@/lib/api/server";
import {
  companyAccessSchema, deliveriesSchema, errorEnvelopeSchema, placementsSchema, reassignmentPageSchema, recruiterDetailSchema,
  recruiterPageSchema, summarySchema, UUID_PATTERN, vacancyPageSchema, type MetricsErrorEnvelope,
} from "./model";

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
export const listRecruiters = (token: string, query: URLSearchParams, cursor?: string) => get(`${PATH}/recruiters`, token, recruiterPageSchema, paged(query, RECRUITER_LIMIT, cursor));
export const listVacancies = (token: string, query: URLSearchParams, cursor?: string) => get(`${PATH}/vacancies`, token, vacancyPageSchema, paged(query, LIST_LIMIT, cursor));
export const listReassignments = (token: string, query: URLSearchParams, cursor?: string) => get(`${PATH}/reassignments`, token, reassignmentPageSchema, paged(query, LIST_LIMIT, cursor));

/** Path ids are user and draft ids; anything else never becomes part of an API path. */
export async function getRecruiter(token: string, userId: string, query: URLSearchParams) {
  if (!UUID_PATTERN.test(userId)) return invalidRequest;
  return get(`${PATH}/recruiters/${userId}`, token, recruiterDetailSchema, query);
}
/** §3.5: each successful read writes one `MetricsDetailViewed` row in the read's transaction; a failure carries no names. */
export async function getDeliveries(token: string, draftId: string) {
  if (!UUID_PATTERN.test(draftId)) return invalidRequest;
  return get(`${PATH}/vacancies/${draftId}/deliveries`, token, deliveriesSchema);
}
export async function getPlacements(token: string, draftId: string) {
  if (!UUID_PATTERN.test(draftId)) return invalidRequest;
  return get(`${PATH}/vacancies/${draftId}/placements`, token, placementsSchema);
}
