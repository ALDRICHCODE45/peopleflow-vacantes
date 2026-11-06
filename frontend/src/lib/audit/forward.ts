/**
 * Audit forwarding (docs/contracts/audit-log-v1.md §4): the Next server proves to
 * the API that it is the BFF with a shared secret, and forwards the browser's IP
 * and user agent so audit rows record the person, not this server. A client that
 * sends these headers itself is never trusted: the API ignores them without the
 * secret, and the wrapper below replaces whatever a caller set.
 */
export type AuditForwardConfig = { secret: string; apiOrigin: string; trustedProxyHops: number };

const MIN_SECRET_BYTES = 32;
const MAX_TRUSTED_PROXY_HOPS = 5;
const MAX_USER_AGENT_BYTES = 512;
const SECRET_HEADER = "x-pf-proxy-secret";
const IP_HEADER = "x-pf-client-ip";
const USER_AGENT_HEADER = "x-pf-client-user-agent";

/** Null disables forwarding (local development without the secret); the value is never echoed. */
export function parseAuditForwardEnv(env: Record<string, unknown>): Omit<AuditForwardConfig, "apiOrigin"> | null {
  const raw = env.AUDIT_PROXY_SECRET;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const secret = raw.trim();
  if (new TextEncoder().encode(secret).length < MIN_SECRET_BYTES)
    throw new Error(`AUDIT_PROXY_SECRET: must be at least ${MIN_SECRET_BYTES} bytes`);
  const hops = env.AUDIT_TRUSTED_PROXY_HOPS ?? "0";
  if (typeof hops !== "string" || !/^\d$/.test(hops) || Number(hops) > MAX_TRUSTED_PROXY_HOPS)
    throw new Error(`AUDIT_TRUSTED_PROXY_HOPS: must be an integer from 0 to ${MAX_TRUSTED_PROXY_HOPS}`);
  return { secret, trustedProxyHops: Number(hops) };
}

/**
 * The client IP is the X-Forwarded-For entry appended by the outermost proxy we
 * trust: counting from the right, skip the trusted hops in front of Next. Entries
 * further left were written by whoever sent the request and can be forged.
 */
export function clientIp(incoming: Headers, trustedProxyHops: number): string | null {
  const chain = (incoming.get("x-forwarded-for") ?? "").split(",").map(entry => entry.trim()).filter(Boolean);
  const candidate = chain[chain.length - 1 - trustedProxyHops];
  return candidate !== undefined && isIpAddress(candidate) ? candidate : null;
}

// No node:net: instrumentation is also compiled for the edge runtime, which has no Node modules.
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
function isIpAddress(value: string): boolean {
  if (IPV4.test(value)) return true;
  if (!value.includes(":") || !/^[0-9a-fA-F:.]+$/.test(value)) return false;
  try { return new URL(`http://[${value}]/`).hostname.length > 2; }
  catch { return false; }
}

export function auditForwardHeaders(config: AuditForwardConfig, incoming: Headers): Record<string, string> {
  const headers: Record<string, string> = { [SECRET_HEADER]: config.secret };
  const ip = clientIp(incoming, config.trustedProxyHops);
  if (ip) headers[IP_HEADER] = ip;
  const userAgent = incoming.get("user-agent");
  if (userAgent) headers[USER_AGENT_HEADER] = truncateUtf8(userAgent, MAX_USER_AGENT_BYTES);
  return headers;
}

/**
 * Wraps the server fetch so every authenticated call to the API carries the audit
 * headers, whichever feature client makes it. Calls to other origins, calls without
 * an Authorization header (public pages, which may render statically) and calls
 * outside a request scope pass through untouched, and the incoming request is not
 * read for them.
 */
export function withAuditForwarding(
  fetchImpl: typeof fetch,
  config: AuditForwardConfig,
  readIncoming: () => Promise<Headers>,
): typeof fetch {
  return async function auditForwardingFetch(input: RequestInfo | URL, init?: RequestInit) {
    const url = input instanceof Request ? input.url : input.toString();
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!sameOrigin(url, config.apiOrigin) || !headers.has("authorization")) return fetchImpl(input, init);
    let incoming: Headers;
    try { incoming = await readIncoming(); }
    catch { return fetchImpl(input, init); }
    for (const name of [SECRET_HEADER, IP_HEADER, USER_AGENT_HEADER]) headers.delete(name);
    for (const [name, value] of Object.entries(auditForwardHeaders(config, incoming))) headers.set(name, value);
    // fetch strips only Authorization when it follows a redirect to another origin: the
    // secret would travel with it. A decorated call never follows; "manual" also stops.
    const redirect = init?.redirect === "manual" ? "manual" : "error";
    return fetchImpl(input, { ...init, headers, redirect });
  };
}

function sameOrigin(url: string, origin: string): boolean {
  try { return new URL(url).origin === origin; }
  catch { return false; }
}

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length <= maxBytes) return value;
  // Drop a multi-byte character cut in half rather than send a replacement glyph.
  return new TextDecoder().decode(bytes.subarray(0, maxBytes)).replace(/\uFFFD$/, "");
}
