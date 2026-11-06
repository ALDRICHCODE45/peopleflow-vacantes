"use server";

const SESSION_EVENT_TIMEOUT_MS = 2000;

/**
 * Records «Cerró sesión» for the caller; nothing to record without a session.
 * Server modules load inside the call so importing a sign-out button never
 * validates server configuration.
 */
export async function endSessionAction(): Promise<void> {
  try {
    const [{ getActionAccessToken }, { serverEnv }, { recordSessionEvent }] = await Promise.all([
      import("@/lib/auth/action-session"), import("@/lib/env/server"), import("./session"),
    ]);
    const token = await getActionAccessToken();
    if (!token) return;
    await recordSessionEvent("end", token, { fetchImpl: fetch, apiBaseUrl: serverEnv.apiBaseUrl, timeoutMs: SESSION_EVENT_TIMEOUT_MS });
  } catch {
    // Best effort: the sign-out continues.
  }
}
