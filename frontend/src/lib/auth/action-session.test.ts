import { describe, expect, it, vi } from "vitest";
import type { NextAuthOptions } from "next-auth";
vi.mock("server-only", () => ({}));
import { parseSetCookieHeader, resolveActionAccessToken, type ActionSessionDeps } from "./action-session";

type SessionCallbackArgs = Parameters<NonNullable<NonNullable<NextAuthOptions["callbacks"]>["session"]>>[0];

const options: NextAuthOptions = { providers: [], secret: "synthetic-secret", callbacks: {} };
const usable = { accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresAt: Date.now() + 60_000 };

function deps(overrides: Partial<ActionSessionDeps> = {}): ActionSessionDeps & { applied: unknown[] } {
  const applied: unknown[] = [];
  return {
    requestHeaders: new Headers({ cookie: "next-auth.session-token=encrypted", "x-private": "never-forwarded" }),
    authUrl: "http://localhost:3000",
    options,
    runSession: async (privateOptions) => {
      const body = await privateOptions.callbacks!.session!({ session: { expires: "2099-01-01" }, token: usable } as SessionCallbackArgs);
      const response = Response.json(body);
      response.headers.append("set-cookie", "next-auth.session-token=rotated; Path=/; HttpOnly; SameSite=Lax");
      return response;
    },
    applyCookie: (cookie) => { applied.push(cookie); },
    ...overrides,
    applied,
  } as ActionSessionDeps & { applied: unknown[] };
}

describe("Set-Cookie parsing for the action cookie store", () => {
  it("keeps an empty value and Max-Age=0 so deletions are not lost", () => {
    expect(parseSetCookieHeader("next-auth.session-token=; Max-Age=0; Path=/")).toEqual({
      name: "next-auth.session-token", value: "", maxAge: 0, path: "/",
    });
  });

  it("parses a secure chunked session cookie with an epoch expiry", () => {
    expect(parseSetCookieHeader(
      "__Secure-next-auth.session-token.0=eyJ.a-b_c; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=None",
    )).toEqual({
      name: "__Secure-next-auth.session-token.0", value: "eyJ.a-b_c", path: "/",
      expires: new Date(0), httpOnly: true, secure: true, sameSite: "none",
    });
  });

  it.each(["", "=value", "no-separator"])("rejects a malformed header %j", (header) => {
    expect(parseSetCookieHeader(header)).toBeNull();
  });
});

describe("server-action access token resolution", () => {
  it("returns the usable access token and persists the refreshed session cookie", async () => {
    const d = deps();
    await expect(resolveActionAccessToken(d)).resolves.toBe("synthetic-access");
    expect(d.applied).toEqual([
      expect.objectContaining({ name: "next-auth.session-token", value: "rotated", path: "/", httpOnly: true, sameSite: "lax" }),
    ]);
  });

  it("asks NextAuth for the session endpoint of the configured origin with only the cookie header", async () => {
    let seen: Request | undefined;
    const d = deps({
      runSession: async (privateOptions, request) => {
        seen = request;
        await privateOptions.callbacks!.session!({ session: { expires: "2099" }, token: usable } as SessionCallbackArgs);
        const response = Response.json({ expires: "2099" });
        response.headers.append("set-cookie", "next-auth.session-token=rotated; Path=/");
        return response;
      },
    });
    await resolveActionAccessToken(d);
    expect(seen!.url).toBe("http://localhost:3000/api/auth/session");
    expect(seen!.method).toBe("GET");
    expect(seen!.headers.get("cookie")).toBe("next-auth.session-token=encrypted");
    expect(seen!.headers.get("x-private")).toBeNull();
  });

  it("applies deletion cookies but fails closed when the session is unusable", async () => {
    const d = deps({
      runSession: async (privateOptions) => {
        await privateOptions.callbacks!.session!({ session: { expires: "2099" }, token: { accessToken: "synthetic-access", expiresAt: 0 } } as SessionCallbackArgs);
        const response = Response.json({ expires: "2099" });
        response.headers.append("set-cookie", "next-auth.session-token=; Max-Age=0; Path=/");
        return response;
      },
    });
    await expect(resolveActionAccessToken(d)).resolves.toBeNull();
    expect(d.applied).toEqual([expect.objectContaining({ name: "next-auth.session-token", value: "", maxAge: 0 })]);
  });

  it("fails closed without a cookie header and never runs the session handler", async () => {
    const runSession = vi.fn();
    const d = deps({ requestHeaders: new Headers(), runSession });
    await expect(resolveActionAccessToken(d)).resolves.toBeNull();
    expect(runSession).not.toHaveBeenCalled();
    expect(d.applied).toEqual([]);
  });

  it("fails closed when the session handler throws", async () => {
    const d = deps({ runSession: async () => { throw new Error("private failure"); } });
    await expect(resolveActionAccessToken(d)).resolves.toBeNull();
    expect(d.applied).toEqual([]);
  });

  it("fails closed when a cookie cannot be applied", async () => {
    const d = deps({ applyCookie: () => { throw new Error("read-only cookies"); } });
    await expect(resolveActionAccessToken(d)).resolves.toBeNull();
  });

  it("rejects an access token containing whitespace", async () => {
    const d = deps({
      runSession: async (privateOptions) => {
        await privateOptions.callbacks!.session!({ session: { expires: "2099" }, token: { ...usable, accessToken: "bad token" } } as SessionCallbackArgs);
        const response = Response.json({ expires: "2099" });
        response.headers.append("set-cookie", "next-auth.session-token=rotated; Path=/");
        return response;
      },
    });
    await expect(resolveActionAccessToken(d)).resolves.toBeNull();
  });
});
