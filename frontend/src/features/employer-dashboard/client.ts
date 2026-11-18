import "server-only";
import type { z } from "zod";
import { requestJson, type RequestJsonError } from "@/lib/api/server";
import {
  attentionSchema, errorEnvelopeSchema, originSchema, parseWindow, pipelineSchema, recentSchema, summarySchema, vacanciesSchema,
  type DashboardErrorEnvelope, type DashboardSectionName, type DashboardWindow,
} from "./model";
import type { DashboardListKind } from "./drilldown";
import {
  dashboardApplicationListSchema, dashboardCandidateListSchema, dashboardDeliveryListSchema, dashboardVacancyListSchema, type DashboardDetailPage,
} from "./detail/model";

/** Contract §3: one fixed route per section; a section name never becomes part of a path unless it is one of these. */
const SECTIONS = {
  summary: summarySchema, attention: attentionSchema, pipeline: pipelineSchema, vacancies: vacanciesSchema, recent: recentSchema, origin: originSchema,
} satisfies Record<DashboardSectionName, z.ZodTypeAny>;
type SectionData = { [K in DashboardSectionName]: z.infer<(typeof SECTIONS)[K]> };

export type DashboardClientFailure = {
  ok: false;
  error: { kind: RequestJsonError["kind"] | "missing_token" | "invalid_request"; retryable: boolean; status?: number };
  envelope?: DashboardErrorEnvelope;
};

let envModule: Promise<typeof import("@/lib/env/server")> | undefined;
const loadServerEnv = async () => (await (envModule ??= import("@/lib/env/server"))).serverEnv;

/** Contract §5: one fixed list route per kind (`/dashboard/lists/…`, since `/dashboard/vacancies` is the §3.4 section). */
const LISTS = {
  candidates: dashboardCandidateListSchema, deliveries: dashboardDeliveryListSchema, vacancies: dashboardVacancyListSchema, applications: dashboardApplicationListSchema,
} satisfies Record<DashboardListKind, z.ZodTypeAny>;
export const DASHBOARD_LIST_LIMIT = 50;

/** Authenticated GET of one dashboard section (`?window=7|30|90`), decoded strictly; never retried automatically. */
export async function getDashboardSection<K extends DashboardSectionName>(token: string, section: K, window: DashboardWindow): Promise<{ ok: true; data: SectionData[K] } | DashboardClientFailure> {
  if (typeof token !== "string" || !token.trim()) return { ok: false, error: { kind: "missing_token", retryable: false } };
  if (!Object.hasOwn(SECTIONS, section)) return { ok: false, error: { kind: "invalid_request", retryable: false } };
  // SAFETY: SECTIONS maps each name K to the schema whose output is SectionData[K]; TS cannot correlate the indexed union.
  const schema = SECTIONS[section] as unknown as z.ZodType<SectionData[K], z.ZodTypeDef, unknown>;
  const serverEnv = await loadServerEnv();
  const url = new URL(`/v2/me/company/dashboard/${section}?${new URLSearchParams({ window: String(parseWindow(window)) })}`, serverEnv.apiBaseUrl);
  const result = await requestJson(url.toString(), {
    method: "GET", headers: { authorization: `Bearer ${token.trim()}` }, redirect: "error", expectedStatus: 200,
    timeoutMs: serverEnv.apiTimeoutMs, maxErrorBodyBytes: 8192,
    decoder: value => schema.parse(value), errorDecoder: value => errorEnvelopeSchema.parse(value),
  });
  return result.ok ? { ok: true, data: result.data } : { ...result, error: { ...result.error, retryable: false } };
}

/**
 * §5: one page of a dashboard list. `kind` picks a fixed route (never a path built from input), the query is the page's
 * validated one with its window, and the cursor is opaque (bound by the API to the filters, window and scope).
 */
export async function listDashboard(token: string, kind: DashboardListKind, query: URLSearchParams, cursor?: string): Promise<{ ok: true; data: DashboardDetailPage } | DashboardClientFailure> {
  if (typeof token !== "string" || !token.trim()) return { ok: false, error: { kind: "missing_token", retryable: false } };
  if (!Object.hasOwn(LISTS, kind)) return { ok: false, error: { kind: "invalid_request", retryable: false } };
  const params = new URLSearchParams(query);
  params.set("limit", String(DASHBOARD_LIST_LIMIT));
  if (cursor) params.set("cursor", cursor);
  const schema = LISTS[kind] as z.ZodTypeAny;
  const serverEnv = await loadServerEnv();
  const result = await requestJson(new URL(`/v2/me/company/dashboard/lists/${kind}?${params}`, serverEnv.apiBaseUrl).toString(), {
    method: "GET", headers: { authorization: `Bearer ${token.trim()}` }, redirect: "error", expectedStatus: 200,
    timeoutMs: serverEnv.apiTimeoutMs, maxErrorBodyBytes: 8192,
    decoder: value => schema.parse(value), errorDecoder: value => errorEnvelopeSchema.parse(value),
  });
  // SAFETY: LISTS maps each kind to the schema of its page, so the decoded page belongs to `kind`.
  return result.ok ? { ok: true, data: { kind, page: result.data } as DashboardDetailPage } : { ...result, error: { ...result.error, retryable: false } };
}
