import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "https://api.example.test", apiTimeoutMs: 100 } }));
import { getUnsubscribe, isUnsubscribeTokenShape, postUnsubscribe, UNSUBSCRIBE_MAX_BODY_BYTES } from "./client";
import { toNotificationFailure } from "./failure";

const SECRET = "s".repeat(40);
const TOKEN = "v1.AbC-123_xyz.Sig_nature-9";
const fetchMock = vi.fn();
const incoming = (extra: Record<string, string> = {}) => new Headers({
  "x-forwarded-for": "203.0.113.7", "user-agent": "MailScanner/1.0", cookie: "next-auth.session-token=private", authorization: "Bearer private", ...extra,
});
const state = (overrides: object = {}) => ({ type: "application_received", channel: "email", enabled: true, company: { id: "c-1", name: "Acme" }, ...overrides });
const envelope = (status: number, code: string, headers: Record<string, string> = {}) =>
  Response.json({ error: "private backend message", code }, { status, headers });
const requested = (call = 0) => {
  const [url, init] = fetchMock.mock.calls[call];
  return { url: new URL(String(url)), init: init as RequestInit, headers: new Headers((init as RequestInit).headers) };
};

beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", fetchMock); vi.stubEnv("AUDIT_PROXY_SECRET", SECRET); vi.stubEnv("AUDIT_TRUSTED_PROXY_HOPS", "0"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("unsubscribe token shape (L23)", () => {
  it.each([TOKEN, "a", "A".repeat(512), "a.b-c_d"])("accepts %j", token => expect(isUnsubscribeTokenShape(token)).toBe(true));
  it.each(["", "A".repeat(513), "a b", "a+b", "a/b", "a=b", "a%2Fb", "ñ", "a\nb", 7, null, undefined])("refuses %j", token =>
    expect(isUnsubscribeTokenShape(token)).toBe(false));
});

describe("GET /v2/notifications/unsubscribe", () => {
  it("reads the link state with the proxy headers, no cookie, no authorization, no redirects", async () => {
    fetchMock.mockResolvedValue(Response.json({ ...state(), extra: 1 }));
    expect(await getUnsubscribe({ token: TOKEN, incoming: incoming() })).toEqual({ ok: true, data: state() });
    const { url, init, headers } = requested();
    expect(url.toString()).toBe(`https://api.example.test/v2/notifications/unsubscribe?token=${TOKEN}`);
    expect(init.method ?? "GET").toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
    expect(headers.get("x-pf-proxy-secret")).toBe(SECRET);
    expect(headers.get("x-pf-client-ip")).toBe("203.0.113.7");
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("authorization")).toBeNull();
  });

  it("sends no proxy headers when forwarding is disabled (local development)", async () => {
    vi.stubEnv("AUDIT_PROXY_SECRET", "");
    fetchMock.mockResolvedValue(Response.json(state({ company: null })));
    expect(await getUnsubscribe({ token: TOKEN, incoming: incoming() })).toEqual({ ok: true, data: state({ company: null }) });
    expect(requested().headers.get("x-pf-proxy-secret")).toBeNull();
  });

  it("refuses a malformed token as an invalid link without a request", async () => {
    const result = await getUnsubscribe({ token: "bad token", incoming: incoming() });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(toNotificationFailure(result)).toEqual({ ok: false, reason: "unsubscribe_link_invalid", reference: {} });
  });

  it("refuses a malformed state as an unrecognized response", async () => {
    fetchMock.mockResolvedValue(Response.json(state({ channel: "in_app" })));
    const result = await getUnsubscribe({ token: TOKEN, incoming: incoming() });
    expect(!result.ok && toNotificationFailure(result).reason).toBe("unrecognized_response");
  });
});

describe("POST /v2/notifications/unsubscribe", () => {
  it("forwards the raw one-click body and its content type", async () => {
    fetchMock.mockResolvedValue(Response.json(state({ enabled: false })));
    const body = new TextEncoder().encode("List-Unsubscribe=One-Click");
    const result = await postUnsubscribe({ token: TOKEN, incoming: incoming(), body, contentType: "application/x-www-form-urlencoded" });
    expect(result).toEqual({ ok: true, data: state({ enabled: false }) });
    const { url, init, headers } = requested();
    expect(url.toString()).toBe(`https://api.example.test/v2/notifications/unsubscribe?token=${TOKEN}`);
    expect(init.method).toBe("POST");
    expect(new TextDecoder().decode(init.body as Uint8Array)).toBe("List-Unsubscribe=One-Click");
    expect(headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(init.redirect).toBe("error");
    expect(headers.get("x-pf-proxy-secret")).toBe(SECRET);
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("authorization")).toBeNull();
  });

  it("refuses a body over 1 KiB without a request", async () => {
    const result = await postUnsubscribe({ token: TOKEN, incoming: incoming(), body: new Uint8Array(UNSUBSCRIBE_MAX_BODY_BYTES + 1) });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(!result.ok && toNotificationFailure(result).reference.status).toBe(413);
  });

  it.each([
    [422, "unsubscribe_link_invalid", "unsubscribe_link_invalid"],
    [413, "payload_too_large", "unrecognized_response"],
    [500, "internal_error", "server_error"],
  ] as const)("maps %i %s to %s", async (status, code, reason) => {
    fetchMock.mockResolvedValue(envelope(status, code));
    const result = await postUnsubscribe({ token: TOKEN, incoming: incoming(), body: new Uint8Array() });
    expect(!result.ok && toNotificationFailure(result)).toEqual({ ok: false, reason, reference: { status, code } });
  });

  it("maps 429 rate_limited with a valid Retry-After and drops a malformed one", async () => {
    fetchMock.mockResolvedValueOnce(envelope(429, "rate_limited", { "retry-after": "30" }));
    const first = await postUnsubscribe({ token: TOKEN, incoming: incoming(), body: new Uint8Array() });
    expect(!first.ok && toNotificationFailure(first)).toEqual({ ok: false, reason: "rate_limited", retryAfter: "30", reference: { status: 429, code: "rate_limited" } });
    fetchMock.mockResolvedValueOnce(envelope(429, "rate_limited", { "retry-after": `30; ${TOKEN}` }));
    const second = await getUnsubscribe({ token: TOKEN, incoming: incoming() });
    expect(!second.ok && toNotificationFailure(second)).toEqual({ ok: false, reason: "rate_limited", reference: { status: 429, code: "rate_limited" } });
  });

  it("drops an unknown code and maps a network failure to no_response", async () => {
    fetchMock.mockResolvedValueOnce(envelope(422, "something_else"));
    const unknown = await postUnsubscribe({ token: TOKEN, incoming: incoming(), body: new Uint8Array() });
    expect(!unknown.ok && toNotificationFailure(unknown)).toEqual({ ok: false, reason: "unrecognized_response", reference: { status: 422 } });
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const network = await postUnsubscribe({ token: TOKEN, incoming: incoming(), body: new Uint8Array() });
    expect(!network.ok && toNotificationFailure(network).reason).toBe("no_response");
  });
});
