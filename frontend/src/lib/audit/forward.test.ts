import { describe, expect, it, vi } from "vitest";
import { auditForwardHeaders, clientIp, parseAuditForwardEnv, withAuditForwarding, type AuditForwardConfig } from "./forward";

const SECRET = "a".repeat(64);
const API = "https://api.peopleflow.mx";
const CONFIG: AuditForwardConfig = { secret: SECRET, apiOrigin: API, trustedProxyHops: 0 };
const incoming = (values: Record<string, string>) => new Headers(values);
const BROWSER = incoming({ "x-forwarded-for": "201.141.12.7", "user-agent": "Mozilla/5.0 Test" });

function setup(readIncoming: () => Promise<Headers> = async () => BROWSER, config = CONFIG) {
  const base = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
  const wrapped = withAuditForwarding(base, config, readIncoming);
  const sent = () => new Headers(base.mock.calls[0][1]?.headers);
  return { base, wrapped, sent };
}

describe("audit forwarding environment", () => {
  it("is disabled when AUDIT_PROXY_SECRET is absent or blank", () => {
    expect(parseAuditForwardEnv({})).toBeNull();
    expect(parseAuditForwardEnv({ AUDIT_PROXY_SECRET: "  " })).toBeNull();
  });

  it("rejects a secret shorter than 32 bytes without echoing it", () => {
    expect(() => parseAuditForwardEnv({ AUDIT_PROXY_SECRET: "short-secret" })).toThrow(/AUDIT_PROXY_SECRET: must be at least 32 bytes/);
    expect(() => parseAuditForwardEnv({ AUDIT_PROXY_SECRET: "short-secret" })).not.toThrow(/short-secret/);
  });

  it("reads the trusted proxy hops, default 0, integer 0-5", () => {
    expect(parseAuditForwardEnv({ AUDIT_PROXY_SECRET: SECRET })).toEqual({ secret: SECRET, trustedProxyHops: 0 });
    expect(parseAuditForwardEnv({ AUDIT_PROXY_SECRET: SECRET, AUDIT_TRUSTED_PROXY_HOPS: "2" })).toEqual({ secret: SECRET, trustedProxyHops: 2 });
    for (const bad of ["-1", "6", "1.5", "x"])
      expect(() => parseAuditForwardEnv({ AUDIT_PROXY_SECRET: SECRET, AUDIT_TRUSTED_PROXY_HOPS: bad })).toThrow(/AUDIT_TRUSTED_PROXY_HOPS/);
  });
});

describe("client IP from X-Forwarded-For", () => {
  it("takes the right-most entry by default, the one the nearest proxy appended", () => {
    expect(clientIp(incoming({ "x-forwarded-for": "6.6.6.6, 201.141.12.7" }), 0)).toBe("201.141.12.7");
  });

  it("skips the configured trusted proxy hops from the right", () => {
    expect(clientIp(incoming({ "x-forwarded-for": "6.6.6.6, 201.141.12.7, 10.0.0.5" }), 1)).toBe("201.141.12.7");
  });

  it("accepts IPv6 and returns null for missing, invalid or too-short chains", () => {
    expect(clientIp(incoming({ "x-forwarded-for": "2001:db8::1" }), 0)).toBe("2001:db8::1");
    // Next itself appends the socket peer in IPv4-mapped form.
    expect(clientIp(incoming({ "x-forwarded-for": "::ffff:127.0.0.1" }), 0)).toBe("::ffff:127.0.0.1");
    for (const bad of ["256.1.1.1", "1.2.3", "01.2.3.4", "1::2::3", "[::1]", "::1/64"])
      expect(clientIp(incoming({ "x-forwarded-for": bad }), 0), bad).toBeNull();
    expect(clientIp(incoming({}), 0)).toBeNull();
    expect(clientIp(incoming({ "x-forwarded-for": "not-an-ip" }), 0)).toBeNull();
    expect(clientIp(incoming({ "x-forwarded-for": "201.141.12.7" }), 1)).toBeNull();
  });
});

describe("audit forward headers", () => {
  it("carries the secret, the client IP and the browser user agent", () => {
    expect(auditForwardHeaders(CONFIG, BROWSER)).toEqual({
      "x-pf-proxy-secret": SECRET, "x-pf-client-ip": "201.141.12.7", "x-pf-client-user-agent": "Mozilla/5.0 Test",
    });
  });

  it("omits an unknown IP or user agent and truncates the user agent to 512 bytes", () => {
    const headers = auditForwardHeaders(CONFIG, incoming({ "user-agent": "u".repeat(600) }));
    expect(headers).toEqual({ "x-pf-proxy-secret": SECRET, "x-pf-client-user-agent": "u".repeat(512) });
    // A multi-byte character cut at the limit is dropped, never sent half.
    expect(auditForwardHeaders(CONFIG, incoming({ "user-agent": `${"u".repeat(511)}é` }))["x-pf-client-user-agent"]).toBe("u".repeat(511));
    expect(auditForwardHeaders(CONFIG, incoming({}))).toEqual({ "x-pf-proxy-secret": SECRET });
  });
});

describe("fetch with audit forwarding", () => {
  it("adds the headers to an authenticated call to the API and keeps the caller's headers", async () => {
    const { wrapped, sent, base } = setup();
    const response = await wrapped(`${API}/v2/me/company`, { method: "POST", headers: { authorization: "Bearer t", "if-match": "\"1\"" }, body: "{}" });
    expect(response.status).toBe(204);
    expect(base.mock.calls[0][0]).toBe(`${API}/v2/me/company`);
    expect(base.mock.calls[0][1]?.method).toBe("POST");
    expect(base.mock.calls[0][1]?.body).toBe("{}");
    expect(Object.fromEntries(sent())).toEqual({
      authorization: "Bearer t", "if-match": "\"1\"",
      "x-pf-proxy-secret": SECRET, "x-pf-client-ip": "201.141.12.7", "x-pf-client-user-agent": "Mozilla/5.0 Test",
    });
  });

  it("reads the headers of a Request input and of a URL input", async () => {
    const first = setup();
    await first.wrapped(new Request(`${API}/v2/me`, { headers: { authorization: "Bearer t" } }));
    expect(first.sent().get("x-pf-proxy-secret")).toBe(SECRET);
    expect(first.sent().get("authorization")).toBe("Bearer t");
    const second = setup();
    await second.wrapped(new URL("/v2/me", API), { headers: new Headers({ Authorization: "Bearer t" }) });
    expect(second.sent().get("x-pf-client-ip")).toBe("201.141.12.7");
  });

  it("replaces X-PF headers a caller set instead of trusting them", async () => {
    const { wrapped, sent } = setup();
    await wrapped(`${API}/v2/me`, { headers: { authorization: "Bearer t", "x-pf-client-ip": "1.2.3.4" } });
    expect(sent().get("x-pf-client-ip")).toBe("201.141.12.7");
  });

  it("never sends the secret to another origin, an unauthenticated call or outside a request", async () => {
    const cases: Array<[string, RequestInit | undefined, () => Promise<Headers>]> = [
      ["https://cognito.example.com/oauth2/token", { headers: { authorization: "Basic x" } }, async () => BROWSER],
      ["https://api.peopleflow.mx.evil.com/v2/me", { headers: { authorization: "Bearer t" } }, async () => BROWSER],
      [`${API}/v2/vacancies`, undefined, async () => BROWSER],
      [`${API}/v2/me`, { headers: { authorization: "Bearer t" } }, async () => { throw new Error("outside a request scope"); }],
    ];
    for (const [url, init, read] of cases) {
      const { wrapped, base } = setup(read);
      await wrapped(url, init);
      expect(base).toHaveBeenCalledWith(url, init);
    }
  });

  it("never lets fetch follow a redirect with the secret attached", async () => {
    for (const redirect of [undefined, "follow", "error"] as const) {
      const { wrapped, base } = setup();
      await wrapped(`${API}/v2/me`, { headers: { authorization: "Bearer t" }, redirect });
      expect(base.mock.calls[0][1]?.redirect, String(redirect)).toBe("error");
    }
    const manual = setup();
    await manual.wrapped(`${API}/v2/me`, { headers: { authorization: "Bearer t" }, redirect: "manual" });
    expect(manual.base.mock.calls[0][1]?.redirect).toBe("manual");
  });

  it("does not read the incoming request for calls it leaves untouched", async () => {
    const read = vi.fn(async () => BROWSER);
    const { wrapped } = setup(read);
    await wrapped(`${API}/v2/vacancies`);
    await wrapped("https://cognito.example.com/x", { headers: { authorization: "Basic x" } });
    expect(read).not.toHaveBeenCalled();
  });
});
