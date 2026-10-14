import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("@/lib/auth/local-bootstrap/session", () => ({
  resolveLocalBootstrapSession: mocks.resolve,
}));

import { LOCAL_BOOTSTRAP_REQUEST_TIMEOUT_MS } from "@/lib/auth/local-bootstrap/config";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  createCsrfToken,
} from "@/lib/auth/local-bootstrap/csrf";
import {
  FIXTURE_ACCESS,
  FIXTURE_BASE_URL,
  FIXTURE_KEY,
  FIXTURE_NEXTAUTH_SECRET,
  FIXTURE_OPERATION_CODE,
  FIXTURE_SITE_URL,
} from "@/lib/auth/local-bootstrap/fixtures";
import { OPERATION_COOKIE_NAME, createOperationBinding } from "@/lib/auth/local-bootstrap/operation";
import { POST } from "./route";

const NOW = 1_700_000_000_000;
const SESSION_COOKIE = "next-auth.session-token=renewed-fixture; HttpOnly; Path=/";
const ENDPOINT = "http://localhost:3000/api/auth/local-bootstrap/apply";
const OTHER_OPERATION = "MFRGGZDFMZTWQ2LKNNWG23TPA";

function stubEnabledEnv() {
  vi.stubEnv("PEOPLEFLOW_LOCAL_BOOTSTRAP_ENABLED", "true");
  vi.stubEnv("PEOPLEFLOW_LOCAL_BOOTSTRAP_BASE_URL", FIXTURE_BASE_URL);
  vi.stubEnv("PEOPLEFLOW_LOCAL_BOOTSTRAP_KEY", FIXTURE_KEY);
  vi.stubEnv("NEXTAUTH_URL", FIXTURE_SITE_URL);
  vi.stubEnv("NEXTAUTH_SECRET", FIXTURE_NEXTAUTH_SECRET);
}

type ApplyOverrides = {
  contentType?: string | null;
  origin?: string | null;
  csrf?: string;
  omitOperationCookie?: boolean;
  operationCookieToken?: string;
};

function bindingFor(
  options: { access?: string; csrf?: string; operationCode?: string; ttl?: number; now?: number } = {},
): string {
  return createOperationBinding(
    FIXTURE_NEXTAUTH_SECRET,
    options.access ?? FIXTURE_ACCESS,
    options.csrf ?? REQUEST_CSRF,
    options.operationCode ?? FIXTURE_OPERATION_CODE,
    options.ttl ?? 60,
    options.now ?? NOW,
  );
}

/** One shared nonce keeps every probe attributable to a single differing field. */
const REQUEST_CSRF = createCsrfToken(FIXTURE_NEXTAUTH_SECRET, FIXTURE_ACCESS, NOW);

function applyRequest(body: string, overrides: ApplyOverrides = {}) {
  const csrf = overrides.csrf ?? REQUEST_CSRF;
  const binding = overrides.operationCookieToken ?? bindingFor({ csrf });
  const headers = new Headers();
  headers.set("origin", overrides.origin ?? FIXTURE_SITE_URL);
  if (overrides.origin === null) headers.delete("origin");
  const cookieParts = [`${CSRF_COOKIE_NAME}=${csrf}`];
  if (!overrides.omitOperationCookie) cookieParts.push(`${OPERATION_COOKIE_NAME}=${binding}`);
  headers.set("cookie", cookieParts.join("; "));
  headers.set(CSRF_HEADER_NAME, csrf);
  if (overrides.contentType !== null)
    headers.set("content-type", overrides.contentType ?? "application/json");
  return new NextRequest(ENDPOINT, { method: "POST", headers, body });
}

const validBody = JSON.stringify({ operation_code: FIXTURE_OPERATION_CODE });

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  stubEnabledEnv();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  mocks.resolve.mockReset();
  mocks.resolve.mockResolvedValue({ accessToken: FIXTURE_ACCESS, cookies: [SESSION_COOKIE] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/auth/local-bootstrap/apply", () => {
  it.each(["created", "already_exists"])(
    "resolves the CURRENT private session, requires the bound operation and decodes %s",
    async (code) => {
      const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true, code }));
      vi.stubGlobal("fetch", fetchMock);

      const response = await POST(applyRequest(validBody));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, code });
      expect(mocks.resolve).toHaveBeenCalledTimes(1);
      expect(response.headers.getSetCookie()).toEqual([SESSION_COOKIE]);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://127.0.0.1:8081/apply");
      expect(init.body).toBe(validBody);
      const headers = new Headers(init.headers);
      expect(headers.get("authorization")).toBe(`Bearer ${FIXTURE_ACCESS}`);
      expect(headers.get("x-local-bootstrap-key")).toBe(FIXTURE_KEY);
    },
  );

  it("passes through approval_required without marking success and without an automatic retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ ok: false, code: "approval_required" }, { status: 409 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(applyRequest(validBody));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, code: "approval_required" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not consume the binding: an explicit re-apply with the same bound operation reaches Go again", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ok: false, code: "approval_required" }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ ok: true, code: "created" }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await POST(applyRequest(validBody));
    expect(first.status).toBe(409);
    const second = await POST(applyRequest(validBody));
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ ok: true, code: "created" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects an apply with no transaction binding before any Go call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(applyRequest(validBody, { omitOperationCookie: true }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, code: "bootstrap_forbidden" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      "another operation code",
      bindingFor({ operationCode: OTHER_OPERATION }),
    ],
    [
      "another csrf nonce",
      bindingFor({ csrf: "other-csrf-nonce-value" }),
    ],
    [
      "another authenticated session (account switch)",
      bindingFor({ access: "fixture-other-access" }),
    ],
    ["a tampered token", `${bindingFor()}x`],
  ])("rejects a binding minted for %s with 403 and zero Go calls", async (_label, token) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(applyRequest(validBody, { operationCookieToken: token }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, code: "bootstrap_forbidden" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 410 operation_expired for an expired binding with zero Go calls", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      applyRequest(validBody, { operationCookieToken: bindingFor({ now: NOW - 61_000 }) }),
    );
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ ok: false, code: "operation_expired" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["an extra PII field", JSON.stringify({ operation_code: FIXTURE_OPERATION_CODE, email: "pii@example.com" })],
    ["a missing operation code", JSON.stringify({})],
    ["a malformed operation code", JSON.stringify({ operation_code: "short" })],
    ["a non-string operation code", JSON.stringify({ operation_code: 26 })],
    ["a JSON array", JSON.stringify([FIXTURE_OPERATION_CODE])],
    ["a JSON scalar", JSON.stringify("created")],
    ["invalid JSON", "{not-json"],
  ])("rejects %s with a sanitized 400 before reaching Go", async (_label, body) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(applyRequest(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, code: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized body before reaching Go", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const oversized = JSON.stringify({
      operation_code: FIXTURE_OPERATION_CODE,
      pad: "x".repeat(2048),
    });

    const response = await POST(applyRequest(oversized));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, code: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("bounds a stalled apply body read with the shared deadline and zero Go calls", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const request = applyRequest(validBody);
    Object.defineProperty(request, "body", {
      value: new ReadableStream<Uint8Array>({ start() {} }),
    });
    const pending = POST(request);
    await vi.advanceTimersByTimeAsync(LOCAL_BOOTSTRAP_REQUEST_TIMEOUT_MS);
    const response = await pending;

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, code: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["text/plain", "application/x-www-form-urlencoded"])(
    "rejects the %s content type before reaching Go",
    async (contentType) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const response = await POST(applyRequest(validBody, { contentType }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ ok: false, code: "invalid_request" });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("rejects a spoofed Origin before any session or Go call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(applyRequest(validBody, { origin: "https://attacker.example" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, code: "bootstrap_forbidden" });
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a path suffix", "http://localhost:3000/"],
    ["userinfo", "http://user@localhost:3000"],
    ["a query", "http://localhost:3000?x=1"],
    ["a fragment", "http://localhost:3000#f"],
    ["uppercase scheme and host", "HTTP://LOCALHOST:3000"],
    ["a non-canonical port", "http://localhost:03000"],
  ])(
    "rejects a non-canonical Origin (%s) even when Host and X-Forwarded-Host match, with zero Go calls",
    async (_label, origin) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const csrf = REQUEST_CSRF;
      const headers = new Headers({
        origin,
        "x-forwarded-host": "localhost:3000",
        cookie: `${CSRF_COOKIE_NAME}=${csrf}; ${OPERATION_COOKIE_NAME}=${bindingFor({ csrf })}`,
        [CSRF_HEADER_NAME]: csrf,
        "content-type": "application/json",
      });
      const request = new NextRequest(ENDPOINT, { method: "POST", headers, body: validBody });

      const response = await POST(request);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ ok: false, code: "bootstrap_forbidden" });
      expect(mocks.resolve).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("rejects a CSRF token bound to a different session before reaching Go", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const foreign = createCsrfToken(FIXTURE_NEXTAUTH_SECRET, "fixture-other-access", NOW);
    const headers = new Headers();
    headers.set("origin", FIXTURE_SITE_URL);
    headers.set("cookie", `${CSRF_COOKIE_NAME}=${foreign}`);
    headers.set(CSRF_HEADER_NAME, foreign);
    headers.set("content-type", "application/json");
    const request = new NextRequest(ENDPOINT, { method: "POST", headers, body: validBody });

    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, code: "bootstrap_forbidden" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed with a sanitized 401 and forwarded cookies without usable access", async () => {
    mocks.resolve.mockResolvedValue({ accessToken: null, cookies: [SESSION_COOKIE] });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(applyRequest(validBody));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, code: "unauthenticated" });
    expect(response.headers.getSetCookie()).toEqual([SESSION_COOKIE]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an ambiguous apply transport failure as a generic 500 without retrying", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("socket hang up"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(applyRequest(validBody));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, code: "bootstrap_failed" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("collapses an unknown or extra-field Go envelope instead of proxying it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ ok: false, code: "bootstrap_failed", detail: "raw-upstream-secret" }, { status: 500 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(applyRequest(validBody));
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body).toEqual({ ok: false, code: "bootstrap_failed" });
    expect(JSON.stringify(body)).not.toContain("raw-upstream-secret");
  });
});
