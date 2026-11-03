import "server-only";
import { requestJson, type RequestJsonError } from "@/lib/api/server";
import { memberIdSchema, membersSchema, type CompanyMember } from "./members-model";
import type { TeamMemberRole } from "./model";
import { offboardPreviewSchema, offboardResultSchema, offboardBodySchema, offboardEnvelopeSchema, type OffboardPreview } from "./offboard-client";

/** Only allowlisted contract codes and decoded vacancy rows cross the action boundary. */
export type TeamClientFailure = { ok: false; error: RequestJsonError; code?: string; vacancies?: OffboardPreview["vacancies"] };
export type TeamClientResult<T> = { ok: true; data: T } | TeamClientFailure;
export async function listTeamMembers(token: string): Promise<TeamClientResult<CompanyMember[]>> {
  const { serverEnv } = await import("@/lib/env/server");
  const result = await requestJson(new URL("/me/company/members", serverEnv.apiBaseUrl).toString(), {
    headers: { authorization: `Bearer ${token.trim()}` }, redirect: "error", expectedStatus: 200,
    timeoutMs: serverEnv.apiTimeoutMs, decoder: value => membersSchema.parse(value).members,
  });
  return result;
}

/** Member offboarding uses membership IDs, no team ETag, and never automatically retries. */
export async function requestOffboard(token: string, id: string, write?: { body: unknown; key: string }) {
  const invalid = { ok: false as const, error: { kind: "status" as const, status: 400, retryable: false } };
  if (!memberIdSchema.safeParse(id).success || (write && (!memberIdSchema.safeParse(write.key).success || !offboardBodySchema.safeParse(write.body).success))) return invalid;
  const { serverEnv } = await import("@/lib/env/server");
  const result = await requestJson(new URL(`/me/company/members/${id}/${write ? "offboard" : "offboard-preview"}`, serverEnv.apiBaseUrl).toString(), {
    method: write ? "POST" : "GET", headers: { authorization: `Bearer ${token.trim()}`, ...(write ? { "idempotency-key": write.key } : {}) },
    ...(write ? { body: offboardBodySchema.parse(write.body) } : {}),
    redirect: "error", expectedStatus: 200, timeoutMs: serverEnv.apiTimeoutMs, maxErrorBodyBytes: 65536,
    decoder: value => write ? offboardResultSchema.parse(value) : offboardPreviewSchema.parse(value), errorDecoder: value => offboardEnvelopeSchema.parse(value),
  });
  if (result.ok) return result;
  return { ...result, code: result.envelope?.code, ...(result.envelope?.data ? { vacancies: result.envelope.data.vacancies } : {}) };
}

/** These writes return no UI data: only the subsequent strict GET replaces the list.
 * Like the CV file client, DELETE handles 204 without the JSON-only transport. */
export async function mutateTeamMember(token: string, id: string, role?: TeamMemberRole): Promise<TeamClientResult<null>> {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { serverEnv } = await import("@/lib/env/server");
    timer = setTimeout(() => { timedOut = true; controller.abort(); }, serverEnv.apiTimeoutMs);
    const memberId = memberIdSchema.parse(id);
    const base = new URL(serverEnv.apiBaseUrl);
    const url = new URL(`/me/company/members/${encodeURIComponent(memberId)}`, base);
    // Only the configured backend origin is allowed; ids can never supply a host or path.
    if (url.origin !== base.origin || !["https:", "http:"].includes(url.protocol))
      return { ok: false, error: { kind: "invalid_response", retryable: false } };
    const response = await fetch(url, {
      method: role === undefined ? "DELETE" : "PATCH",
      headers: { authorization: `Bearer ${token.trim()}`, ...(role ? { "content-type": "application/json" } : {}) },
      ...(role ? { body: JSON.stringify({ role }) } : {}),
      cache: "no-store", redirect: "error", signal: controller.signal,
    });
    if (response.status === 409) {
      const body: unknown = await response.json().catch(() => null);
      // Preserve the existing last-owner/role decoder; only DELETE consumes offboard rows.
      const code = body && typeof body === "object" && typeof (body as { code?: unknown }).code === "string" ? (body as { code: string }).code : undefined;
      const parsed = role === undefined && code === "member_is_responsible" ? offboardEnvelopeSchema.safeParse(body) : null;
      return { ok: false, error: { kind: "status", status: 409, retryable: false }, ...(code ? { code } : {}), ...(parsed?.success && parsed.data.data ? { vacancies: parsed.data.data.vacancies } : {}) };
    }
    void response.body?.cancel().catch(() => {});
    if (response.status === (role === undefined ? 204 : 200)) return { ok: true, data: null };
    return { ok: false, error: response.ok ? { kind: "invalid_response", retryable: false } : { kind: "status", status: response.status, retryable: false } };
  } catch {
    return { ok: false, error: { kind: timedOut ? "timeout" : "network", retryable: true } };
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
