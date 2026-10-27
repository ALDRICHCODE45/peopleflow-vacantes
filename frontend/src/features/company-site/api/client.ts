import "server-only";
import { z } from "zod";
import { requestJson } from "@/lib/api/server";
import { siteDraftSchema } from "../model";
import { availabilitySchema, decodeFailure, errorSchema, siteStateSchema, type AvailabilityResult, type Failure, type SiteResult } from "./model";

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
  return "status" in result.error ? decodeFailure(result.error.status, result.envelope) : { kind: "unrecognized" };
}
async function siteRequest(token: string, suffix: string, method = "GET", body?: unknown, ifMatch?: string): Promise<SiteResult> {
  const result = await request(token, suffix, siteStateSchema, method, body, ifMatch);
  if (result.kind !== "success") return result;
  if (!validTag(result.etag) || result.etag !== `"${result.data.draft_version}"`) return { kind: "unrecognized" };
  return { ...result, etag: result.etag };
}
export function getSite(token: string): Promise<SiteResult> { return siteRequest(token, ""); }
export async function putDraft(token: string, input: SaveInput): Promise<SiteResult> {
  const body = siteDraftSchema.safeParse(input?.body);
  if (!body.success || !validTag(input?.ifMatch)) return { kind: "invalid_request" };
  return siteRequest(token, "/draft", "PUT", body.data, input.ifMatch);
}
export async function publishSite(token: string, ifMatch: string): Promise<SiteResult> {
  if (!validTag(ifMatch)) return { kind: "invalid_request" };
  return siteRequest(token, "/publish", "POST", undefined, ifMatch);
}
export function unpublishSite(token: string): Promise<SiteResult> { return siteRequest(token, "/unpublish", "POST"); }
export function slugAvailability(token: string, slug: string): Promise<AvailabilityResult> {
  return request(token, `/slug-availability?${new URLSearchParams({ slug })}`, availabilitySchema);
}
