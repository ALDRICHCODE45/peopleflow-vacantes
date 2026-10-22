import "server-only";
import { requestJson, type RequestJsonError } from "@/lib/api/server";
import { memberIdSchema, membersSchema, type CompanyMember } from "./members-model";
import type { TeamMemberRole } from "./model";

export type TeamClientFailure = { ok: false; error: RequestJsonError };
export type TeamClientResult<T> = { ok: true; data: T } | TeamClientFailure;
export async function listTeamMembers(token: string): Promise<TeamClientResult<CompanyMember[]>> {
  const { serverEnv } = await import("@/lib/env/server");
  const result = await requestJson(new URL("/me/company/members", serverEnv.apiBaseUrl).toString(), {
    headers: { authorization: `Bearer ${token.trim()}` }, redirect: "error", expectedStatus: 200,
    timeoutMs: serverEnv.apiTimeoutMs, decoder: value => membersSchema.parse(value).members,
  });
  return result;
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
    void response.body?.cancel().catch(() => {});
    if (response.status === (role === undefined ? 204 : 200)) return { ok: true, data: null };
    return { ok: false, error: response.ok ? { kind: "invalid_response", retryable: false } : { kind: "status", status: response.status, retryable: false } };
  } catch {
    return { ok: false, error: { kind: timedOut ? "timeout" : "network", retryable: true } };
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
