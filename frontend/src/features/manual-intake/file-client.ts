import "server-only";

/**
 * Server-only adapter for the manual-intake multipart POST. The only outbound authority is
 * server configuration, never request headers; the vacancy id has already passed the route's
 * UUID allowlist. Same fetch guards as the CV file adapters.
 */
export async function forwardManualIntake(token: string, vacancyId: string, key: string, body: FormData, signal: AbortSignal): Promise<Response> {
  const { serverEnv } = await import("@/lib/env/server");
  const authority = new URL(serverEnv.apiBaseUrl);
  const endpoint = new URL(`/v2/me/company/job-drafts/${vacancyId}/pipeline/candidates/manual`, authority);
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.origin !== authority.origin || endpoint.username || endpoint.password) throw new Error("invalid manual-intake endpoint");
  return fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${token.trim()}`, "Idempotency-Key": key }, body, cache: "no-store", redirect: "error", signal });
}
