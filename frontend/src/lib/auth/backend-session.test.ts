import { describe, expect, it, vi } from "vitest";
import type { NextAuthOptions } from "next-auth";
vi.mock("server-only", () => ({}));
import { resolveBackendSession } from "./backend-session";

const jwt = vi.fn();
const publicSession = vi.fn();
const options: NextAuthOptions = { providers: [], secret: "synthetic-secret", callbacks: { jwt, session: publicSession } };

describe("server-private session capture with cookie persistence", () => {
  it("captures only usable post-refresh access credentials without mutating public callbacks", async () => {
    const result = await resolveBackendSession(options, async (privateOptions) => {
      expect(privateOptions).not.toBe(options);
      expect(privateOptions.callbacks?.jwt).toBe(jwt);
      const session = { expires: "2099-01-01", user: { name: "private-name" } };
      const body = await privateOptions.callbacks!.session!({ session, token: { accessToken: "synthetic-access", refreshToken: "synthetic-refresh", idToken: "synthetic-id", expiresAt: Date.now() + 60000 } } as Parameters<NonNullable<NonNullable<NextAuthOptions["callbacks"]>["session"]>>[0]);
      expect(body).toEqual({ expires: "2099-01-01" });
      const response = Response.json(body);
      response.headers.append("set-cookie", "next-auth.session-token.0=encrypted0; HttpOnly; Path=/");
      response.headers.append("set-cookie", "next-auth.session-token.1=encrypted1; HttpOnly; Path=/");
      return response;
    });
    expect(result.accessToken).toBe("synthetic-access");
    expect(result.cookies).toHaveLength(2);
    expect(options.callbacks?.session).toBe(publicSession);
    expect(publicSession).not.toHaveBeenCalled();
  });
  it.each([
    { accessToken: "synthetic-access", expiresAt: 0 },
    { accessToken: "synthetic-access", expiresAt: Date.now() + 60000, error: "RefreshAccessTokenError" },
    { idToken: "synthetic-id", expiresAt: Date.now() + 60000 },
  ])("fails closed for unusable credentials %s", async (token) => {
    const result = await resolveBackendSession(options, async (privateOptions) => {
      await privateOptions.callbacks!.session!({ session: { expires: "2099" }, token } as Parameters<NonNullable<NonNullable<NextAuthOptions["callbacks"]>["session"]>>[0]);
      return Response.json({ expires: "2099" });
    });
    expect(result.accessToken).toBeNull();
  });
  it("never returns credentials when encoding/cookie session handler fails after capture", async () => {
    const result = await resolveBackendSession(options, async (privateOptions) => {
      await privateOptions.callbacks!.session!({ session: { expires: "2099" }, token: { accessToken: "synthetic-access", expiresAt: Date.now() + 60000 } } as Parameters<NonNullable<NonNullable<NextAuthOptions["callbacks"]>["session"]>>[0]);
      return Response.json({ error: "private-error" }, { status: 500 });
    });
    expect(result.accessToken).toBeNull();
  });
  it.each([
    ["next-auth.session-token=; Max-Age=0; HttpOnly; Path=/"],
    ["next-auth.csrf-token=fixture; HttpOnly; Path=/"],
    ["next-auth.session-token.0=encrypted; HttpOnly; Path=/", "next-auth.session-token.0=; Max-Age=0; HttpOnly; Path=/"],
  ])("rejects a retained 200 session body without effective populated session cookies (%s)", async (...headers) => {
    const result = await resolveBackendSession(options, async (privateOptions) => {
      const body = await privateOptions.callbacks!.session!({ session: { expires: "2099" }, token: { accessToken: "synthetic-access", expiresAt: Date.now() + 60000 } } as Parameters<NonNullable<NonNullable<NextAuthOptions["callbacks"]>["session"]>>[0]);
      const response = Response.json(body);
      for (const header of headers) response.headers.append("set-cookie", header);
      return response;
    });
    expect(result.accessToken).toBeNull();
    expect(result.cookies).toEqual(headers);
  });
  it("requires successful cookie persistence, not merely an in-memory token", async () => {
    const result = await resolveBackendSession(options, async (privateOptions) => {
      await privateOptions.callbacks!.session!({ session: { expires: "2099" }, token: { accessToken: "synthetic-access", expiresAt: Date.now() + 60000 } } as Parameters<NonNullable<NonNullable<NextAuthOptions["callbacks"]>["session"]>>[0]);
      return Response.json({});
    });
    expect(result.accessToken).toBeNull();
  });
});
