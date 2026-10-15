import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextAuthOptions } from "next-auth";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("next-auth", () => ({ default: (options: NextAuthOptions) => (request: NextRequest, context: unknown) => mocks.run(options, request, context) }));
vi.mock("@/lib/auth/options", () => ({ authOptions: { providers: [], callbacks: { jwt: () => ({}) }, secret: "fixture-secret" } }));
import { GET } from "./route";

beforeEach(() => {
  vi.stubEnv("PEOPLEFLOW_API_BASE_URL", "http://localhost:8080");
  vi.stubEnv("PEOPLEFLOW_SITE_URL", "http://localhost:3000");
  vi.stubEnv("PEOPLEFLOW_API_TIMEOUT_MS", "1000");
  vi.stubEnv("PEOPLEFLOW_LOCAL_PREVIEW", "false");
  vi.stubEnv("PEOPLEFLOW_SAMPLE_JOBS", "false");
  mocks.run.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("GET backend-check route", () => {
  it("ignores client query/IDs and persists the private session cookies on a sanitized response", async () => {
    mocks.run.mockImplementation(async (options: NextAuthOptions, request: NextRequest, context: { params: Promise<{ nextauth: string[] }> }) => {
      expect(request.nextUrl.pathname).toBe("/api/auth/session");
      expect(request.nextUrl.search).toBe("");
      expect(await context.params).toEqual({ nextauth: ["session"] });
      const body = await options.callbacks!.session!({ session: { expires: "2099" }, token: { accessToken: "fixture-access", expiresAt: Date.now() + 60000 } } as Parameters<NonNullable<NonNullable<NextAuthOptions["callbacks"]>["session"]>>[0]);
      const result = Response.json(body);
      result.headers.append("set-cookie", "next-auth.session-token=encrypted; HttpOnly; Path=/");
      return result;
    });
    const upstream = { company_id: "private", role: "owner", company: { id: "private", name: "private", rfc: "private", industry_id: "private", status: "active" } };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(upstream));
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(new NextRequest("http://localhost:3000/api/auth/backend-check?company_id=attacker&url=https://attacker.example"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.getSetCookie()).toEqual(["next-auth.session-token=encrypted; HttpOnly; Path=/"]);
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8080/me/company");
  });
  it("returns a sanitized no-store configuration failure without running auth or Go", async () => {
    vi.stubEnv("PEOPLEFLOW_API_BASE_URL", "https://invalid.example/path?secret=fixture");
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const response = await GET(new NextRequest("http://localhost:3000/api/auth/backend-check"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: "authentication_unavailable" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.run).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
