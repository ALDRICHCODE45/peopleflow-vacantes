// @vitest-environment node
import { encode } from "next-auth/jwt";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { LOGOUT_KIND_COOKIE } from "./logout";
import { guardAuthRoute } from "./route-guard";

const SECRET = "fixture-secret-not-a-real-credential";
const SITE = "http://localhost:3000";
const ctx = { params: Promise.resolve({ nextauth: ["x"] }) };

function setup(socialProviders = [{ id: "google" as const, identityProvider: "Google" }]) {
  const handler = vi.fn(async () => new Response(JSON.stringify({ url: `${SITE}/api/auth/cognito/logout` }), {
    status: 200, headers: { "content-type": "application/json" },
  }));
  return { handler, guarded: guardAuthRoute(handler, { secret: SECRET, siteUrl: SITE, socialProviders }) };
}

async function sessionCookie(token: Record<string, unknown>) {
  return `next-auth.session-token=${await encode({ token, secret: SECRET })}`;
}

function setCookies(response: Response): string[] {
  return response.headers.getSetCookie();
}

describe("sign-out kind hint", () => {
  it("marks the logout route for a password session (no Cognito hop)", async () => {
    const { guarded, handler } = setup();
    const cookie = await sessionCookie({ sub: "s", authKind: "password", accessToken: "fixture-private-access" });
    const response = await guarded(new NextRequest(`${SITE}/api/auth/signout`, { method: "POST", headers: { cookie } }), ctx);
    expect(handler).toHaveBeenCalledTimes(1);
    const hint = setCookies(response).find((c) => c.startsWith(`${LOGOUT_KIND_COOKIE}=`));
    expect(hint).toBe(`${LOGOUT_KIND_COOKIE}=password; Path=/api/auth/cognito/logout; Max-Age=120; HttpOnly; SameSite=lax`);
    expect(await response.json()).toEqual({ url: `${SITE}/api/auth/cognito/logout` });
    expect(setCookies(response).join(";")).not.toContain("fixture-private-access");
  });

  it.each([
    ["an OAuth session", { sub: "s", authKind: "oauth" }],
    ["a legacy session without kind", { sub: "s" }],
  ])("clears the hint for %s", async (_label, token) => {
    const { guarded } = setup();
    const response = await guarded(new NextRequest(`${SITE}/api/auth/signout`, { method: "POST", headers: { cookie: await sessionCookie(token) } }), ctx);
    expect(setCookies(response)).toContain(`${LOGOUT_KIND_COOKIE}=; Path=/api/auth/cognito/logout; Max-Age=0; HttpOnly; SameSite=lax`);
  });

  it("clears the hint without a session or with an undecryptable one", async () => {
    const { guarded } = setup();
    for (const headers of [{}, { cookie: "next-auth.session-token=garbage" }] as Record<string, string>[]) {
      const response = await guarded(new NextRequest(`${SITE}/api/auth/signout`, { method: "POST", headers }), ctx);
      expect(setCookies(response).some((c) => c.startsWith(`${LOGOUT_KIND_COOKIE}=;`))).toBe(true);
    }
  });

  it("marks the hint Secure on an https site", async () => {
    const handler = vi.fn(async () => new Response("{}", { status: 200 }));
    const guarded = guardAuthRoute(handler, { secret: SECRET, siteUrl: "https://peopleflow.example", socialProviders: [] });
    const cookie = `__Secure-next-auth.session-token=${await encode({ token: { authKind: "password" }, secret: SECRET })}`;
    const response = await guarded(new NextRequest("https://peopleflow.example/api/auth/signout", { method: "POST", headers: { cookie } }), ctx);
    expect(setCookies(response).find((c) => c.startsWith(`${LOGOUT_KIND_COOKIE}=`))).toContain("password; Path=/api/auth/cognito/logout; Max-Age=120; Secure; HttpOnly; SameSite=lax");
  });

  it("keeps NextAuth's own Set-Cookie headers byte-identical next to the hint", async () => {
    const handler = vi.fn(async () => {
      const headers = new Headers();
      headers.append("set-cookie", "next-auth.session-token.0=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax");
      headers.append("set-cookie", "next-auth.session-token.1=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax");
      return new Response("{}", { status: 200, headers });
    });
    const guarded = guardAuthRoute(handler, { secret: SECRET, siteUrl: SITE, socialProviders: [] });
    const response = await guarded(new NextRequest(`${SITE}/api/auth/signout`, { method: "POST" }), ctx);
    expect(setCookies(response).slice(0, 2)).toEqual([
      "next-auth.session-token.0=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax",
      "next-auth.session-token.1=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax",
    ]);
    expect(setCookies(response)).toHaveLength(3);
  });

  it("leaves every other auth request untouched", async () => {
    const { guarded, handler } = setup();
    const request = new NextRequest(`${SITE}/api/auth/session`, { method: "GET" });
    const response = await guarded(request, ctx);
    expect(handler).toHaveBeenCalledExactlyOnceWith(request, ctx);
    expect(setCookies(response)).toEqual([]);
  });
});

describe("social sign-in authorization params", () => {
  const signin = (query: string) => new NextRequest(`${SITE}/api/auth/signin/cognito${query}`, { method: "POST" });

  it("passes an enabled identity_provider through to NextAuth", async () => {
    const { guarded, handler } = setup();
    await guarded(signin("?identity_provider=Google"), ctx);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("keeps the current hosted sign-in (no params) working until the screens switch (A4.3)", async () => {
    const { guarded, handler } = setup();
    await guarded(signin(""), ctx);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a disabled provider", "?identity_provider=LinkedIn"],
    ["a case variant", "?identity_provider=google"],
    ["a repeated param", "?identity_provider=Google&identity_provider=LinkedIn"],
    ["a scope override", "?scope=openid"],
    ["an extra param", "?identity_provider=Google&prompt=none"],
    ["a redirect override", "?redirect_uri=https://evil.example"],
  ])("refuses %s without reaching NextAuth or Cognito", async (_label, query) => {
    const { guarded, handler } = setup();
    const response = await guarded(signin(query), ctx);
    expect(handler).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ url: `${SITE}/api/auth/error?error=OAuthSignin` });
  });

  it("refuses any identity_provider when every social flag is off", async () => {
    const { guarded, handler } = setup([]);
    const response = await guarded(signin("?identity_provider=Google"), ctx);
    expect(handler).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
  });

  it("does not inspect the OAuth callback (code/state) or the password callback", async () => {
    const { guarded, handler } = setup();
    await guarded(new NextRequest(`${SITE}/api/auth/callback/cognito?code=c&state=s`), ctx);
    await guarded(new NextRequest(`${SITE}/api/auth/callback/password`, { method: "POST" }), ctx);
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
