import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("@/lib/auth/local-bootstrap/session", () => ({
  resolveLocalBootstrapSession: mocks.resolve,
}));

import {
  CSRF_COOKIE_MAX_AGE_SECONDS,
  CSRF_COOKIE_NAME,
  verifyCsrfToken,
} from "@/lib/auth/local-bootstrap/csrf";
import {
  FIXTURE_ACCESS,
  FIXTURE_BASE_URL,
  FIXTURE_KEY,
  FIXTURE_NEXTAUTH_SECRET,
  FIXTURE_SITE_URL,
} from "@/lib/auth/local-bootstrap/fixtures";
import { GET } from "./route";

const NOW = 1_700_000_000_000;
const SESSION_COOKIE = "next-auth.session-token=renewed-fixture; HttpOnly; Path=/";

function stubEnabledEnv() {
  vi.stubEnv("PEOPLEFLOW_LOCAL_BOOTSTRAP_ENABLED", "true");
  vi.stubEnv("PEOPLEFLOW_LOCAL_BOOTSTRAP_BASE_URL", FIXTURE_BASE_URL);
  vi.stubEnv("PEOPLEFLOW_LOCAL_BOOTSTRAP_KEY", FIXTURE_KEY);
  vi.stubEnv("NEXTAUTH_URL", FIXTURE_SITE_URL);
  vi.stubEnv("NEXTAUTH_SECRET", FIXTURE_NEXTAUTH_SECRET);
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  stubEnabledEnv();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  mocks.resolve.mockReset();
  mocks.resolve.mockResolvedValue({ accessToken: FIXTURE_ACCESS, cookies: [SESSION_COOKIE] });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/auth/local-bootstrap/nonce", () => {
  it("issues a session-bound nonce, forwards renewal cookies and never calls Go", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new NextRequest("http://localhost:3000/api/auth/local-bootstrap/nonce"),
    );
    const body = (await response.json()) as { ok: boolean; nonce: string };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(verifyCsrfToken(FIXTURE_NEXTAUTH_SECRET, FIXTURE_ACCESS, body.nonce, NOW)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("no-store");

    const cookies = response.headers.getSetCookie();
    expect(cookies).toContain(SESSION_COOKIE);
    expect(
      cookies.some(
        (cookie) =>
          cookie.startsWith(`${CSRF_COOKIE_NAME}=`) &&
          cookie.includes("HttpOnly") &&
          cookie.includes("SameSite=Strict") &&
          cookie.includes(`Max-Age=${CSRF_COOKIE_MAX_AGE_SECONDS}`),
      ),
    ).toBe(true);
  });

  it("is read-only: it ignores query parameters and never reaches Go even when they are hostile", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await GET(
      new NextRequest(
        "http://localhost:3000/api/auth/local-bootstrap/nonce?operation_code=attacker&url=https://attacker.example",
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed with a sanitized 401 when the private session has no usable access", async () => {
    mocks.resolve.mockResolvedValue({ accessToken: null, cookies: [SESSION_COOKIE] });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new NextRequest("http://localhost:3000/api/auth/local-bootstrap/nonce"),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, code: "unauthenticated" });
    expect(response.headers.getSetCookie()).toEqual([SESSION_COOKIE]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a sanitized unavailable response when the feature is disabled, invalid or in production", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    vi.stubEnv("PEOPLEFLOW_LOCAL_BOOTSTRAP_ENABLED", "false");
    let response = await GET(new NextRequest("http://localhost:3000/api/auth/local-bootstrap/nonce"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: "local_bootstrap_unavailable" });

    vi.stubEnv("PEOPLEFLOW_LOCAL_BOOTSTRAP_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "production");
    response = await GET(new NextRequest("http://localhost:3000/api/auth/local-bootstrap/nonce"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: "local_bootstrap_unavailable" });

    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed without leaking when session resolution throws", async () => {
    mocks.resolve.mockRejectedValue(new Error("no session infrastructure"));
    const response = await GET(
      new NextRequest("http://localhost:3000/api/auth/local-bootstrap/nonce"),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: "local_bootstrap_unavailable" });
  });
});
