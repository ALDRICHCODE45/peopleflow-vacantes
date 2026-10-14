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
import {
  OPERATION_COOKIE_NAME,
  verifyOperationBinding,
} from "@/lib/auth/local-bootstrap/operation";
import { POST } from "./route";

const NOW = 1_700_000_000_000;
const SESSION_COOKIE = "next-auth.session-token=renewed-fixture; HttpOnly; Path=/";
const ENDPOINT = "http://localhost:3000/api/auth/local-bootstrap/stage";

function stubEnabledEnv() {
  vi.stubEnv("PEOPLEFLOW_LOCAL_BOOTSTRAP_ENABLED", "true");
  vi.stubEnv("PEOPLEFLOW_LOCAL_BOOTSTRAP_BASE_URL", FIXTURE_BASE_URL);
  vi.stubEnv("PEOPLEFLOW_LOCAL_BOOTSTRAP_KEY", FIXTURE_KEY);
  vi.stubEnv("NEXTAUTH_URL", FIXTURE_SITE_URL);
  vi.stubEnv("NEXTAUTH_SECRET", FIXTURE_NEXTAUTH_SECRET);
}

type StageOverrides = {
  origin?: string | null;
  cookie?: string | null;
  csrf?: string | null;
  body?: string;
  contentType?: string | null;
};

function stageRequest(overrides: StageOverrides = {}) {
  const token = createCsrfToken(FIXTURE_NEXTAUTH_SECRET, FIXTURE_ACCESS, NOW);
  const config = {
    origin: FIXTURE_SITE_URL as string | null,
    cookie: `${CSRF_COOKIE_NAME}=${token}` as string | null,
    csrf: token as string | null,
    body: "{}",
    contentType: "application/json" as string | null,
    ...overrides,
  };
  const headers = new Headers();
  if (config.origin !== null) headers.set("origin", config.origin);
  if (config.cookie !== null) headers.set("cookie", config.cookie);
  if (config.csrf !== null) headers.set(CSRF_HEADER_NAME, config.csrf);
  if (config.contentType !== null) headers.set("content-type", config.contentType);
  return new NextRequest(ENDPOINT, { method: "POST", headers, body: config.body });
}

function stalledRequest(overrides: StageOverrides = {}) {
  const request = stageRequest(overrides);
  Object.defineProperty(request, "body", {
    value: new ReadableStream<Uint8Array>({ start() {} }),
  });
  return request;
}

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

describe("POST /api/auth/local-bootstrap/stage", () => {
  it("forwards the current private access, returns the exact 202 envelope and binds the operation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(
        { ok: true, operation_code: FIXTURE_OPERATION_CODE, expires_in: 60 },
        { status: 202 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const csrf = createCsrfToken(FIXTURE_NEXTAUTH_SECRET, FIXTURE_ACCESS, NOW);

    const response = await POST(
      stageRequest({ cookie: `${CSRF_COOKIE_NAME}=${csrf}`, csrf }),
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      ok: true,
      operation_code: FIXTURE_OPERATION_CODE,
      expires_in: 60,
    });

    const cookies = response.headers.getSetCookie();
    expect(cookies[0]).toBe(SESSION_COOKIE);
    const operation = cookies.find((cookie) => cookie.startsWith(`${OPERATION_COOKIE_NAME}=`));
    expect(operation).toBeDefined();
    expect(operation).toContain("HttpOnly");
    expect(operation).toContain("SameSite=Strict");
    expect(operation).toContain("Max-Age=60");
    const binding = operation!.split(";")[0].slice(`${OPERATION_COOKIE_NAME}=`.length);
    expect(
      verifyOperationBinding(
        FIXTURE_NEXTAUTH_SECRET,
        FIXTURE_ACCESS,
        csrf,
        FIXTURE_OPERATION_CODE,
        binding,
        NOW,
      ),
    ).toBe("valid");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8081/stage");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${FIXTURE_ACCESS}`);
    expect(headers.get("x-local-bootstrap-key")).toBe(FIXTURE_KEY);
  });

  it("accepts the exact empty object even with ordinary JSON whitespace and still sends a fixed body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(
        { ok: true, operation_code: FIXTURE_OPERATION_CODE, expires_in: 60 },
        { status: 202 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(stageRequest({ body: "{  }" }));

    expect(response.status).toBe(202);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0][1] as RequestInit).body).toBe("{}");
  });

  it.each([
    ["unknown identity/PII fields", JSON.stringify({ email: "pii@example.com" })],
    ["a browser-supplied user type", JSON.stringify({ user_type: "recruiter" })],
    ["a non-empty object", JSON.stringify({ a: 1 })],
    ["an array body", JSON.stringify([])],
    ["a non-object body", JSON.stringify("recruiter")],
    ["a numeric body", JSON.stringify(1)],
    ["a null body", JSON.stringify(null)],
    ["malformed JSON", "{"],
    ["an empty body", ""],
    ["whitespace-only body", "   "],
  ])("rejects %s with a sanitized 400 and zero Go calls", async (_label, body) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(stageRequest({ body }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, code: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["text/plain", null])(
    "rejects a missing or non-JSON content type (%s) with a sanitized 400 and zero Go calls",
    async (contentType) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const response = await POST(stageRequest({ contentType }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ ok: false, code: "invalid_request" });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("rejects an actual-byte overflow with a sanitized 400 and zero Go calls", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(stageRequest({ body: JSON.stringify({ pad: "x".repeat(500) }) }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, code: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("bounds a stalled stage body read with the shared deadline and zero Go calls", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const pending = POST(stalledRequest());
    await vi.advanceTimersByTimeAsync(LOCAL_BOOTSTRAP_REQUEST_TIMEOUT_MS);
    const response = await pending;

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, code: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes through only a whitelisted Go error envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ ok: false, code: "stage_pending" }, { status: 409 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(stageRequest());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, code: "stage_pending" });
  });

  it("rejects a spoofed or missing Origin (never Host/X-Forwarded-Host) before any session or Go call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const origin of ["https://attacker.example", null]) {
      const response = await POST(stageRequest({ origin }));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ ok: false, code: "bootstrap_forbidden" });
    }
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
      const token = createCsrfToken(FIXTURE_NEXTAUTH_SECRET, FIXTURE_ACCESS, NOW);
      const headers = new Headers({
        origin,
        "x-forwarded-host": "localhost:3000",
        cookie: `${CSRF_COOKIE_NAME}=${token}`,
        [CSRF_HEADER_NAME]: token,
        "content-type": "application/json",
      });
      const request = new NextRequest(ENDPOINT, { method: "POST", headers, body: "{}" });

      const response = await POST(request);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ ok: false, code: "bootstrap_forbidden" });
      expect(mocks.resolve).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("rejects a missing or mismatched CSRF cookie/header pair before any Go call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const token = createCsrfToken(FIXTURE_NEXTAUTH_SECRET, FIXTURE_ACCESS, NOW);

    const mismatched = await POST(stageRequest({ csrf: `${token}x` }));
    expect(mismatched.status).toBe(403);
    expect(await mismatched.json()).toEqual({ ok: false, code: "bootstrap_forbidden" });

    const missing = await POST(stageRequest({ cookie: null }));
    expect(missing.status).toBe(403);
    expect(await missing.json()).toEqual({ ok: false, code: "bootstrap_forbidden" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a CSRF token minted for a different authenticated session", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const foreign = createCsrfToken(FIXTURE_NEXTAUTH_SECRET, "fixture-other-access", NOW);

    const response = await POST(
      stageRequest({ cookie: `${CSRF_COOKIE_NAME}=${foreign}`, csrf: foreign }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, code: "bootstrap_forbidden" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed with a sanitized 401 and forwarded cookies when there is no usable access", async () => {
    mocks.resolve.mockResolvedValue({ accessToken: null, cookies: [SESSION_COOKIE] });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(stageRequest());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, code: "unauthenticated" });
    expect(response.headers.getSetCookie()).toEqual([SESSION_COOKIE]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed with a sanitized 503 when the feature is disabled or production", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    vi.stubEnv("PEOPLEFLOW_LOCAL_BOOTSTRAP_ENABLED", "false");
    let response = await POST(stageRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: "local_bootstrap_unavailable" });

    vi.stubEnv("PEOPLEFLOW_LOCAL_BOOTSTRAP_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "production");
    response = await POST(stageRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: "local_bootstrap_unavailable" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["an extra error field", { ok: false, code: "bootstrap_failed", error: "raw-upstream-secret" }],
    ["an unknown code", { ok: false, code: "leaked_code" }],
    ["a malformed success body", { ok: true, operation_code: "short", expires_in: 60 }],
  ])("collapses %s into a generic sanitized failure", async (_label, payload) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(payload, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(stageRequest());
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body).toEqual({ ok: false, code: "bootstrap_failed" });
    expect(JSON.stringify(body)).not.toContain("raw-upstream-secret");
  });

  it("fails closed on a Go transport failure without retrying", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("connection refused"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(stageRequest());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, code: "bootstrap_failed" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
