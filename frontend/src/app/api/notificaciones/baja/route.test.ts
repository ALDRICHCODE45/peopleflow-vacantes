import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "https://api.example.test", apiTimeoutMs: 100 } }));
import * as route from "./route";

const SECRET = "s".repeat(40);
const TOKEN = "v1.AbC-123_xyz.Sig_nature-9";
const ONE_CLICK = "List-Unsubscribe=One-Click";
const fetchMock = vi.fn();
const post = (token: string | null = TOKEN, body: BodyInit | null = ONE_CLICK, headers: Record<string, string> = {}) =>
  new Request(`https://peopleflow.test/api/notificaciones/baja${token === null ? "" : `?token=${encodeURIComponent(token)}`}`, {
    method: "POST", body,
    headers: {
      "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": "198.51.100.4", "user-agent": "Gmail",
      cookie: "next-auth.session-token=private", authorization: "Bearer private", origin: "https://mail.google.com", "sec-fetch-site": "cross-site",
      ...headers,
    },
  });
const state = { type: "application_received", channel: "email", enabled: false, company: { id: "c-1", name: "Acme" } };
const envelope = (status: number, code: string, headers: Record<string, string> = {}) =>
  Response.json({ error: `private backend message ${TOKEN}`, code }, { status, headers });
const forwarded = () => {
  const [url, init] = fetchMock.mock.calls[0];
  return { url: new URL(String(url)), init: init as RequestInit, headers: new Headers((init as RequestInit).headers) };
};
async function expectPrivate(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("set-cookie")).toBeNull();
  const text = await response.text();
  expect(text).not.toContain(TOKEN);
  expect(text).not.toContain("private backend message");
  return text;
}

beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", fetchMock); vi.stubEnv("AUDIT_PROXY_SECRET", SECRET); vi.stubEnv("AUDIT_TRUSTED_PROXY_HOPS", "0"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("POST /api/notificaciones/baja (RFC 8058 one-click, L23)", () => {
  it("forwards the raw body and proxy headers, never cookies or authorization, and answers 200", async () => {
    fetchMock.mockResolvedValue(Response.json(state));
    const response = await route.POST(post());
    expect(response.status).toBe(200);
    await expectPrivate(response);
    const { url, init, headers } = forwarded();
    expect(url.toString()).toBe(`https://api.example.test/v2/notifications/unsubscribe?token=${TOKEN}`);
    expect(init.method).toBe("POST");
    expect(new TextDecoder().decode(init.body as Uint8Array)).toBe(ONE_CLICK);
    expect(headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(headers.get("x-pf-proxy-secret")).toBe(SECRET);
    expect(headers.get("x-pf-client-ip")).toBe("198.51.100.4");
    for (const name of ["cookie", "authorization", "origin", "sec-fetch-site"]) expect(headers.get(name)).toBeNull();
    expect(init.redirect).toBe("error");
  });

  it("does not answer with the backend state (no echo)", async () => {
    fetchMock.mockResolvedValue(Response.json(state));
    const text = await expectPrivate(await route.POST(post()));
    expect(text).not.toContain("Acme");
  });

  it("forwards an empty body", async () => {
    fetchMock.mockResolvedValue(Response.json(state));
    expect((await route.POST(post(TOKEN, null))).status).toBe(200);
    expect((forwarded().init.body as Uint8Array).byteLength).toBe(0);
  });

  it("answers 413 for a body over 1 KiB without calling the API", async () => {
    const response = await route.POST(post(TOKEN, "a".repeat(1025)));
    expect(response.status).toBe(413);
    await expectPrivate(response);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts exactly 1 KiB", async () => {
    fetchMock.mockResolvedValue(Response.json(state));
    expect((await route.POST(post(TOKEN, "a".repeat(1024)))).status).toBe(200);
  });

  it.each([null, "", "A".repeat(513), "bad token", "a/b", "a%b", "ñandú"])("answers a malformed token %j like an invalid link without calling the API", async token => {
    const response = await route.POST(post(token));
    expect(response.status).toBe(422);
    expect(JSON.parse(await expectPrivate(response))).toEqual({ code: "unsubscribe_link_invalid" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes 422 through with a minimal body", async () => {
    fetchMock.mockResolvedValue(envelope(422, "unsubscribe_link_invalid"));
    const response = await route.POST(post());
    expect(response.status).toBe(422);
    expect(JSON.parse(await expectPrivate(response))).toEqual({ code: "unsubscribe_link_invalid" });
  });

  it("passes 429 through with Retry-After", async () => {
    fetchMock.mockResolvedValue(envelope(429, "rate_limited", { "retry-after": "60" }));
    const response = await route.POST(post());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(JSON.parse(await expectPrivate(response))).toEqual({ code: "rate_limited" });
  });

  it("passes the backend's 413 through", async () => {
    fetchMock.mockResolvedValue(envelope(413, "payload_too_large"));
    const response = await route.POST(post());
    expect(response.status).toBe(413);
    expect(JSON.parse(await expectPrivate(response))).toEqual({ code: "payload_too_large" });
  });

  it.each([
    ["a 5xx", () => fetchMock.mockResolvedValue(envelope(503, "internal_error"))],
    ["a network failure", () => fetchMock.mockRejectedValue(new TypeError("fetch failed"))],
  ])("answers 502 for %s", async (_, arrange) => {
    arrange();
    const response = await route.POST(post());
    expect(response.status).toBe(502);
    expect(JSON.parse(await expectPrivate(response))).toEqual({ code: "unavailable" });
  });
});

describe("other methods", () => {
  it.each(["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const)("answers %s with 405 without calling the API", async method => {
    const handler = (route as unknown as Record<string, (() => Response | Promise<Response>) | undefined>)[method];
    expect(handler).toBeTypeOf("function");
    const response = await handler!();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    await expectPrivate(response);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
