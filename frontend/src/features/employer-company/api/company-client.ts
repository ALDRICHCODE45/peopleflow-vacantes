import "server-only";
import { z } from "zod";
import { requestJson } from "@/lib/api/server";
import type { RequestJsonError } from "@/lib/api/server";

const companySchema = z.object({
  id: z.string(), name: z.string(), rfc: z.string(), industry_id: z.string(),
  status: z.enum(["active", "pending_verification", "suspended"]),
});
const industriesSchema = z.array(z.object({ id: z.string(), label_es: z.string(), label_en: z.string(), sort_order: z.number().int() }));
const membershipSchema = z.object({ company_id: z.string(), role: z.enum(["owner", "recruiter"]), company: companySchema });
const errorSchema = z.object({ error: z.string(), code: z.string() });
export type Company = z.infer<typeof companySchema>;
export type Industry = z.infer<typeof industriesSchema>[number];
export type Membership = z.infer<typeof membershipSchema>;
type WithoutRetry<T> = T extends RequestJsonError ? Omit<T, "retryable"> & { retryable: false } : never;
export type CompanyFailure = { ok: false; error: WithoutRetry<RequestJsonError> | { kind: "missing_token"; retryable: false }; envelope?: z.infer<typeof errorSchema> };
export type CompanyResult<T> = { ok: true; data: T } | CompanyFailure;

async function call<T>(path: string, schema: z.ZodType<T>, token?: string, body?: unknown, method: "GET" | "POST" = "GET"): Promise<CompanyResult<T>> {
  const { serverEnv } = await import("@/lib/env/server");
  const result = await requestJson(new URL(path, serverEnv.apiBaseUrl).toString(), {
    method, body,
    headers: token === undefined ? undefined : { authorization: `Bearer ${token.trim()}` },
    expectedStatus: method === "POST" ? 201 : 200,
    redirect: "error", maxErrorBodyBytes: 8192, timeoutMs: serverEnv.apiTimeoutMs,
    decoder: value => schema.parse(value), errorDecoder: value => errorSchema.parse(value),
  });
  if (result.ok) return { ok: true, data: result.data };
  return { ...result, error: { ...result.error, retryable: false } };
}
const missing: CompanyFailure = { ok: false, error: { kind: "missing_token", retryable: false } };
export async function listIndustries(): Promise<CompanyResult<Industry[]>> { return call("/industries", industriesSchema); }
export async function getMyCompany({ token }: { token: string }): Promise<CompanyResult<Membership>> {
  if (typeof token !== "string" || !token.trim()) return missing;
  return call("/me/company", membershipSchema, token);
}
export async function createCompany({ token, body }: { token: string; body: unknown }): Promise<CompanyResult<Company>> {
  if (typeof token !== "string" || !token.trim()) return missing;
  return call("/companies", companySchema, token, body, "POST");
}
