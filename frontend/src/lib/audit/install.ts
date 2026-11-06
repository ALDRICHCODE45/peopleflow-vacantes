import "server-only";

import { parseAuditForwardEnv, withAuditForwarding } from "./forward";

/**
 * Installs audit forwarding on the Node server's global fetch, once. Without
 * AUDIT_PROXY_SECRET it does nothing and the API records its own peer address
 * (`ip_source = peer`, shown as «IP no verificada»).
 */
export async function installAuditForwarding(): Promise<void> {
  const parsed = parseAuditForwardEnv(process.env);
  if (!parsed) return;
  const { serverEnv } = await import("@/lib/env/server");
  const { headers } = await import("next/headers");
  globalThis.fetch = withAuditForwarding(globalThis.fetch, { ...parsed, apiOrigin: serverEnv.apiBaseUrl }, () => headers());
}
