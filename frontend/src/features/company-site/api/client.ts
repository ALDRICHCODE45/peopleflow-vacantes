import "server-only";
import { z } from "zod";
import { requestJson } from "@/lib/api/server";
import { siteDraftSchema } from "../model";
import { companyProfileSchema, type CompanyProfileResult } from "./company-profile";
import { availabilitySchema, decodeFailure, errorSchema, siteStateSchema, type AvailabilityResult, type Failure, type SiteResult } from "./model";

import { draftFieldErrors } from "./validation";

/** Fixed reason codes only: never include request data, tokens or decoder errors. */
function diagnostic<T extends Failure>(failure: T): T {
  if (failure.kind === "unrecognized" || failure.kind === "invalid_request" || (failure.kind === "error" && failure.code === "invalid_request")) {
    console.warn("company_site_request_failed", failure.kind === "error" ? failure.code : failure.kind);
  }
  return failure;
}

export type SaveInput = { body: unknown; ifMatch: string };
const path = "/v2/me/company/site";
const validTag = (tag: unknown): tag is string => typeof tag === "string" && /^"[1-9]\d*"$/.test(tag);
async function request<T>(token: string, suffix: string, schema: z.ZodType<T>, method = "GET", body?: unknown, ifMatch?: string): Promise<{ kind: "success"; data: T; etag?: string } | Failure> {
  if (!token?.trim()) return { kind: "unauthenticated" };
  const { serverEnv } = await import("@/lib/env/server");
  const result = await requestJson(new URL(path + suffix, serverEnv.apiBaseUrl).toString(), {
    method, ...(body === undefined ? {} : { body }),
    headers: { authorization: `Bearer ${token.trim()}`, ...(ifMatch === undefined ? {} : { "if-match": ifMatch }) },
    redirect: "error", expectedStatus: 200, timeoutMs: serverEnv.apiTimeoutMs,
    captureResponseHeaders: ["etag"], decoder: value => schema.parse(value), errorDecoder: value => errorSchema.parse(value), maxErrorBodyBytes: 65536,
  });
  if (result.ok) return { kind: "success", data: result.data, etag: result.headers?.etag };
  if (result.error.kind === "network" || result.error.kind === "timeout") return { kind: "uncertain" };
  return diagnostic("status" in result.error ? decodeFailure(result.error.status, result.envelope) : { kind: "unrecognized" });
}
async function siteRequest(token: string, suffix: string, method = "GET", body?: unknown, ifMatch?: string): Promise<SiteResult> {
  const result = await request(token, suffix, siteStateSchema, method, body, ifMatch);
  if (result.kind !== "success") return result;
  if (!validTag(result.etag) || result.etag !== `"${result.data.draft_version}"`) return diagnostic({ kind: "unrecognized" });
  return { ...result, etag: result.etag };
}
/** Anonymous profile read, selected only by server-verified session membership. */
export async function getCompanyProfile(companyId: string): Promise<CompanyProfileResult> {
  if (!z.string().uuid().safeParse(companyId).success) return { ok: false };
  try {
    const { serverEnv } = await import("@/lib/env/server");
    const result = await requestJson(new URL(`/companies/${companyId}`, serverEnv.apiBaseUrl).toString(), {
      expectedStatus: 200, redirect: "error", timeoutMs: serverEnv.apiTimeoutMs,
      decoder: value => companyProfileSchema.parse(value),
    });
    if (!result.ok || result.data.id !== companyId) return { ok: false };
    return { ok: true, company: result.data };
  } catch { return { ok: false }; }
}
export function getSite(token: string): Promise<SiteResult> { return siteRequest(token, ""); }
export async function putDraft(token: string, input: SaveInput): Promise<SiteResult> {
  const body = siteDraftSchema.safeParse(input?.body);
  if (!body.success) return { kind: "invalid", fields: draftFieldErrors(body.error.issues) };
  if (!validTag(input?.ifMatch)) return diagnostic({ kind: "invalid_request" });
  return siteRequest(token, "/draft", "PUT", body.data, input.ifMatch);
}
export async function publishSite(token: string, ifMatch: string): Promise<SiteResult> {
  if (!validTag(ifMatch)) return diagnostic({ kind: "invalid_request" });
  return siteRequest(token, "/publish", "POST", undefined, ifMatch);
}
export function unpublishSite(token: string): Promise<SiteResult> { return siteRequest(token, "/unpublish", "POST"); }
export function slugAvailability(token: string, slug: string): Promise<AvailabilityResult> {
  return request(token, `/slug-availability?${new URLSearchParams({ slug })}`, availabilitySchema);
}
