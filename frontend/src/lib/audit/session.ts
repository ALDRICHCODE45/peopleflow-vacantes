/**
 * Session audit calls (docs/contracts/audit-log-v1.md §3). They go through the
 * server fetch, so audit forwarding adds the browser IP and user agent. A failure
 * of any kind is swallowed: recording a session must never block signing in or out.
 */
export type SessionEventDeps = { fetchImpl: typeof fetch; apiBaseUrl: string; timeoutMs: number };

export async function recordSessionEvent(kind: "start" | "end", accessToken: string, deps: SessionEventDeps): Promise<void> {
  const token = accessToken.trim();
  if (!token) return;
  try {
    await deps.fetchImpl(new URL(`/v2/me/session/${kind}`, deps.apiBaseUrl).toString(), {
      method: "POST", headers: { authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(deps.timeoutMs),
    });
  } catch {
    // Best effort by contract; the user's sign-in or sign-out continues.
  }
}
