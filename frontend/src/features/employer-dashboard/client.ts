import "server-only";
import type { z } from "zod";
import { requestJson, type RequestJsonError } from "@/lib/api/server";
import {
  attentionSchema, errorEnvelopeSchema, originSchema, parseWindow, pipelineSchema, recentSchema, summarySchema, vacanciesSchema,
  type DashboardErrorEnvelope, type DashboardSectionName, type DashboardWindow,
} from "./model";

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
