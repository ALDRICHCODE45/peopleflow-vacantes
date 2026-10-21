import "server-only";
import { requestJson } from "@/lib/api/server";
import { errorEnvelopeSchema, mapFailure, type GeoResult } from "@/features/geo/model";
import { languageCatalogSchema, type LanguageCatalog } from "./model";

// Like geo: guarded anonymous reads, with caching at the route/browser boundary.
export async function getLanguages(): Promise<GeoResult<LanguageCatalog>> {
  const { serverEnv } = await import("@/lib/env/server");
  const result = await requestJson(new URL("/v2/catalogs/languages", serverEnv.apiBaseUrl).toString(), {
    method: "GET", expectedStatus: 200, redirect: "error", timeoutMs: serverEnv.apiTimeoutMs,
    decoder: value => languageCatalogSchema.parse(value), errorDecoder: value => errorEnvelopeSchema.parse(value), maxErrorBodyBytes: 8192,
  });
  return result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error.kind === "invalid_response" ? "unrecognized_response" : mapFailure("status" in result.error ? result.error.status : undefined, result.envelope) };
}
