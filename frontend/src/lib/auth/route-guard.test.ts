// @vitest-environment node
import { encode } from "next-auth/jwt";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { LOGOUT_KIND_COOKIE, SECURE_LOGOUT_KIND_COOKIE } from "./logout";
import { MAX_PASSWORD_CALLBACK_BODY_BYTES, guardAuthRoute } from "./route-guard";

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
    expect(hint).toBe(`${LOGOUT_KIND_COOKIE}=password; Path=/; Max-Age=120; HttpOnly; SameSite=lax`);
    expect(await response.json()).toEqual({ url: `${SITE}/api/auth/cognito/logout` });
    expect(setCookies(response).join(";")).not.toContain("fixture-private-access");
  });

  it.each([
    ["an OAuth session", { sub: "s", authKind: "oauth" }],
    ["a legacy session without kind", { sub: "s" }],
  ])("clears the hint for %s", async (_label, token) => {
    const { guarded } = setup();
    const response = await guarded(new NextRequest(`${SITE}/api/auth/signout`, { method: "POST", headers: { cookie: await sessionCookie(token) } }), ctx);
    expect(setCookies(response)).toContain(`${LOGOUT_KIND_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=lax`);
  });

  it("clears the hint without a session or with an undecryptable one", async () => {
    const { guarded } = setup();
    for (const headers of [{}, { cookie: "next-auth.session-token=garbage" }] as Record<string, string>[]) {
      const response = await guarded(new NextRequest(`${SITE}/api/auth/signout`, { method: "POST", headers }), ctx);
      expect(setCookies(response).some((c) => c.startsWith(`${LOGOUT_KIND_COOKIE}=;`))).toBe(true);
    }
  });

  it("names the hint __Host- and marks it Secure on an https site", async () => {
    const handler = vi.fn(async () => new Response("{}", { status: 200 }));
    const guarded = guardAuthRoute(handler, { secret: SECRET, siteUrl: "https://peopleflow.example", socialProviders: [] });
    const cookie = `__Secure-next-auth.session-token=${await encode({ token: { authKind: "password" }, secret: SECRET })}`;
    const response = await guarded(new NextRequest("https://peopleflow.example/api/auth/signout", { method: "POST", headers: { cookie } }), ctx);
    expect(setCookies(response)).toContain(`${SECURE_LOGOUT_KIND_COOKIE}=password; Path=/; Max-Age=120; Secure; HttpOnly; SameSite=lax`);
    expect(setCookies(response).some((c) => c.startsWith(`${LOGOUT_KIND_COOKIE}=`))).toBe(false);
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

  it.each([
    ["an extra path segment", "/api/auth/signin/cognito/x?scope=openid&identity_provider=Other"],
    ["several extra segments", "/api/auth/signin/cognito/a/b?scope=openid"],
    ["a trailing slash", "/api/auth/signin/cognito/?identity_provider=LinkedIn"],
    ["a percent-encoded provider", "/api/auth/signin/%63ognito?scope=openid"],
    ["a percent-encoded action", "/api/auth/%73ignin/cognito?identity_provider=Other"],
    ["an encoded provider with an extra segment", "/api/auth/signin/%63%6Fgnito/x?redirect_uri=https://evil.example"],
    ["an upper-case provider", "/api/auth/signin/COGNITO?scope=openid"],
  ])("refuses disallowed params on %s (NextAuth reads only the first two segments)", async (_label, path) => {
    const { guarded, handler } = setup();
    const response = await guarded(new NextRequest(`${SITE}${path}`, { method: "POST" }), ctx);
    expect(handler).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
  });

  it("guards on the nextauth route segments NextAuth itself reads, whatever the URL looks like", async () => {
    const { guarded, handler } = setup();
    const signinCtx = { params: Promise.resolve({ nextauth: ["signin", "cognito", "x"] }) };
    const response = await guarded(new NextRequest(`${SITE}/api/auth/other?scope=openid`, { method: "POST" }), signinCtx);
    expect(handler).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
  });

  it("still admits an enabled provider through an extra segment or trailing slash", async () => {
    const { guarded, handler } = setup();
    await guarded(new NextRequest(`${SITE}/api/auth/signin/cognito/?identity_provider=Google`, { method: "POST" }), ctx);
    await guarded(new NextRequest(`${SITE}/api/auth/signin/%63ognito/x?identity_provider=Google`, { method: "POST" }), ctx);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("refuses a sign-in path whose segments cannot be decoded", async () => {
    const { guarded, handler } = setup();
    const response = await guarded(new NextRequest(`${SITE}/api/auth/signin/%E0%A4%A?scope=openid`, { method: "POST" }), ctx);
    expect(handler).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
  });

  it("adds the sign-out hint on a trailing-slash or extra-segment sign-out too", async () => {
    const { guarded } = setup();
    const cookie = await sessionCookie({ sub: "s", authKind: "password" });
    for (const path of ["/api/auth/signout/", "/api/auth/signout/x", "/api/auth/%73ignout"]) {
      const response = await guarded(new NextRequest(`${SITE}${path}`, { method: "POST", headers: { cookie } }), ctx);
      expect(setCookies(response)).toContain(`${LOGOUT_KIND_COOKIE}=password; Path=/; Max-Age=120; HttpOnly; SameSite=lax`);
    }
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

  it.each([
    ["a scope override", "/api/auth/signin/cognito?scope=openid"],
    ["a disabled provider", "/api/auth/signin/cognito?identity_provider=LinkedIn"],
    ["a redirect override", "/api/auth/signin/%63ognito/x?redirect_uri=https://evil.example"],
  ])("passes a GET with %s to NextAuth unchanged: GET never starts an authorization (only POST does)", async (_label, path) => {
    const { guarded, handler } = setup();
    const request = new NextRequest(`${SITE}${path}`, { method: "GET" });
    await guarded(request, ctx);
    expect(handler).toHaveBeenCalledExactlyOnceWith(request, ctx);
  });
});

describe("lazy social flags", () => {
  it("resolves the enabled providers on each sign-in, not when the route is built", async () => {
    const handler = vi.fn(async () => new Response("{}", { status: 200 }));
    const socialProviders = vi.fn(() => [{ id: "google" as const, identityProvider: "Google" }]);
    const guarded = guardAuthRoute(handler, { secret: SECRET, siteUrl: SITE, socialProviders });
    expect(socialProviders).not.toHaveBeenCalled();
    await guarded(new NextRequest(`${SITE}/api/auth/session`), ctx);
    expect(socialProviders).not.toHaveBeenCalled();
    await guarded(new NextRequest(`${SITE}/api/auth/signin/cognito?identity_provider=Google`, { method: "POST" }), ctx);
    expect(socialProviders).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("refuses identity_provider sign-ins when the provider config cannot be read, and leaves every other auth route working", async () => {
    const handler = vi.fn(async () => new Response("{}", { status: 200 }));
    const guarded = guardAuthRoute(handler, {
      secret: SECRET, siteUrl: SITE,
      socialProviders: () => { throw new Error("AUTH_SOCIAL_GOOGLE: must be on or off"); },
    });
    const social = await guarded(new NextRequest(`${SITE}/api/auth/signin/cognito?identity_provider=Google`, { method: "POST" }), ctx);
    expect(social.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
    for (const request of [
      new NextRequest(`${SITE}/api/auth/session`),
      new NextRequest(`${SITE}/api/auth/csrf`),
      new NextRequest(`${SITE}/api/auth/providers`),
      new NextRequest(`${SITE}/api/auth/callback/password`, { method: "POST" }),
    ]) {
      expect((await guarded(request, ctx)).status).toBe(200);
    }
    expect(handler).toHaveBeenCalledTimes(4);
  });
});

describe("password callback rate limiting", () => {
  // NextAuth's double-submit pair: cookie `token|sha256(token + secret)`, body csrfToken === token.
  const CSRF_TOKEN = "fixture-csrf-token";
  const csrfCookie = (token = CSRF_TOKEN, secret = SECRET, name = "next-auth.csrf-token") =>
    `${name}=${encodeURIComponent(`${token}|${createHash("sha256").update(`${token}${secret}`).digest("hex")}`)}`;

  function passwordPost(
    body: Record<string, string>,
    ip: string | null = "198.51.100.1",
    contentType = "application/x-www-form-urlencoded",
    cookie: string | null = csrfCookie(),
  ) {
    const fields = cookie && body.csrfToken === undefined ? { ...body, csrfToken: CSRF_TOKEN } : body;
    return new NextRequest(`${SITE}/api/auth/callback/password`, {
      method: "POST",
      headers: { "content-type": contentType, ...(ip ? { "x-forwarded-for": ip } : {}), ...(cookie ? { cookie } : {}) },
      body: contentType.includes("json") ? JSON.stringify(fields) : new URLSearchParams(fields).toString(),
    });
  }

  type Attempt = (operation: string, keys: { ip?: string; email?: string }) => { ok: true } | { ok: false; retryAfterMs: number };
  function setupLimited(attempt = vi.fn<Attempt>(() => ({ ok: true }))) {
    const handler = vi.fn(async (request: NextRequest) => {
      // NextAuth reads the body itself: the guard must leave it readable.
      const body = new URLSearchParams(await request.text());
      return new Response(JSON.stringify({ url: `${SITE}/empresa/dashboard`, email: body.get("email") }), { status: 200 });
    });
    const guarded = guardAuthRoute(handler as never, { secret: SECRET, siteUrl: SITE, socialProviders: [], rateLimiter: { attempt } });
    return { guarded, handler, attempt };
  }

  it("checks the client address and the submitted email before NextAuth runs, and leaves the body readable", async () => {
    const { guarded, handler, attempt } = setupLimited();
    const response = await guarded(passwordPost({ email: "Laura@Empresa.mx", password: "fixture-password", json: "true" }), ctx);
    expect(attempt).toHaveBeenCalledExactlyOnceWith("signIn", { ip: "198.51.100.1", email: "Laura@Empresa.mx" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(await response.json()).toMatchObject({ email: "Laura@Empresa.mx" });
    expect(JSON.stringify(attempt.mock.calls)).not.toContain("fixture-password");
  });

  it("reads the email from a JSON body as NextAuth does", async () => {
    const { guarded, attempt } = setupLimited();
    await guarded(passwordPost({ email: "a@x.mx", password: "p" }, "198.51.100.2", "application/json"), ctx);
    expect(attempt).toHaveBeenCalledWith("signIn", { ip: "198.51.100.2", email: "a@x.mx" });
  });

  it.each([
    ["no CSRF cookie", { cookie: null, body: { csrfToken: CSRF_TOKEN } }],
    ["a cookie signed with another secret", { cookie: csrfCookie(CSRF_TOKEN, "other-secret"), body: {} }],
    ["a cookie without hash", { cookie: `next-auth.csrf-token=${CSRF_TOKEN}`, body: { csrfToken: CSRF_TOKEN } }],
    ["a body token that differs from the cookie", { cookie: csrfCookie(), body: { csrfToken: "other-token" } }],
    ["no body token", { cookie: csrfCookie(), body: { csrfToken: "" } }],
    ["the __Host- cookie on an http site", { cookie: csrfCookie(CSRF_TOKEN, SECRET, "__Host-next-auth.csrf-token"), body: { csrfToken: CSRF_TOKEN } }],
  ])("counts only the address, never the email, for %s, and lets NextAuth reject it", async (_label, { cookie, body }) => {
    const { guarded, handler, attempt } = setupLimited();
    await guarded(passwordPost({ email: "victim@empresa.mx", password: "p", ...body }, "198.51.100.7", "application/x-www-form-urlencoded", cookie), ctx);
    expect(attempt).toHaveBeenCalledExactlyOnceWith("signIn", { ip: "198.51.100.7" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("spends the email budget for a cookie with extra segments, exactly as NextAuth accepts it", async () => {
    // NextAuth reads only the first two `|` parts, so `token|hash|x` passes its check and must count the email.
    const { guarded, attempt } = setupLimited();
    const valid = csrfCookie();
    await guarded(passwordPost({ email: "victim@empresa.mx", password: "p", csrfToken: CSRF_TOKEN }, "198.51.100.9", "application/x-www-form-urlencoded", `${valid}${encodeURIComponent("|extra")}`), ctx);
    expect(attempt).toHaveBeenCalledExactlyOnceWith("signIn", { ip: "198.51.100.9", email: "victim@empresa.mx" });
  });

  it("accepts the __Host- CSRF cookie (and only it) on an https site", async () => {
    const attempt = vi.fn<Attempt>(() => ({ ok: true }));
    const handler = vi.fn(async () => new Response("{}", { status: 200 }));
    const site = "https://peopleflow.example";
    const guarded = guardAuthRoute(handler, { secret: SECRET, siteUrl: site, socialProviders: [], rateLimiter: { attempt } });
    const post = (cookie: string) => new NextRequest(`${site}/api/auth/callback/password`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": "198.51.100.8", cookie },
      body: new URLSearchParams({ email: "a@x.mx", password: "p", csrfToken: CSRF_TOKEN }).toString(),
    });
    await guarded(post(csrfCookie(CSRF_TOKEN, SECRET, "__Host-next-auth.csrf-token")), ctx);
    await guarded(post(csrfCookie()), ctx);
    expect(attempt.mock.calls).toEqual([
      ["signIn", { ip: "198.51.100.8", email: "a@x.mx" }],
      ["signIn", { ip: "198.51.100.8" }],
    ]);
  });

  it("cannot lock a victim's email out without a valid CSRF pair (real limiter)", async () => {
    const { createAuthAttemptLimiter, AUTH_RATE_LIMITS } = await import("./rate-limit");
    const handler = vi.fn(async () => new Response("{}", { status: 200 }));
    const guarded = guardAuthRoute(handler, { secret: SECRET, siteUrl: SITE, socialProviders: [], rateLimiter: createAuthAttemptLimiter({ now: () => 0 }) });
    const { limit } = AUTH_RATE_LIMITS.signIn.perEmail;
    for (let i = 0; i < limit * 3; i++) await guarded(passwordPost({ email: "victim@x.mx", password: "p" }, `198.51.100.${i}`, undefined, null), ctx);
    const owner = await guarded(passwordPost({ email: "victim@x.mx", password: "p" }, "203.0.113.9"), ctx);
    expect(owner.status).toBe(200);
  });

  it("skips the per-IP key when no client address can be derived, keeping the per-email one", async () => {
    const { guarded, attempt } = setupLimited();
    await guarded(passwordPost({ email: "a@x.mx", password: "p" }, null), ctx);
    expect(attempt).toHaveBeenCalledExactlyOnceWith("signIn", { email: "a@x.mx" });
    expect(Object.keys(attempt.mock.calls[0]![1])).toEqual(["email"]);
  });

  it("answers too_many_attempts over the limit without reaching NextAuth (so never Cognito)", async () => {
    const { guarded, handler } = setupLimited(vi.fn(() => ({ ok: false as const, retryAfterMs: 61_500 })));
    const response = await guarded(passwordPost({ email: "a@x.mx", password: "fixture-password", json: "true" }), ctx);
    expect(handler).not.toHaveBeenCalled();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("62");
    expect(await response.json()).toEqual({ url: `${SITE}/api/auth/error?error=too_many_attempts` });
  });

  it("limits through the real attempt limiter per email across addresses", async () => {
    const { createAuthAttemptLimiter, AUTH_RATE_LIMITS } = await import("./rate-limit");
    const handler = vi.fn(async () => new Response("{}", { status: 200 }));
    const guarded = guardAuthRoute(handler, { secret: SECRET, siteUrl: SITE, socialProviders: [], rateLimiter: createAuthAttemptLimiter({ now: () => 0 }) });
    const { limit } = AUTH_RATE_LIMITS.signIn.perEmail;
    for (let i = 0; i < limit; i++) await guarded(passwordPost({ email: "a@x.mx", password: "p" }, `198.51.100.${i}`), ctx);
    const blocked = await guarded(passwordPost({ email: " A@X.MX", password: "p" }, "203.0.113.9"), ctx);
    expect(blocked.status).toBe(429);
    expect(handler).toHaveBeenCalledTimes(limit);
  });

  it("refuses an oversized body by its declared length with 413, still counting the address, without NextAuth", async () => {
    const { guarded, handler, attempt } = setupLimited();
    const request = new NextRequest(`${SITE}/api/auth/callback/password`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": "198.51.100.3", "content-length": String(MAX_PASSWORD_CALLBACK_BODY_BYTES + 1) },
      body: "email=a%40x.mx",
    });
    const response = await guarded(request, ctx);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ url: `${SITE}/api/auth/error?error=invalid_request` });
    expect(handler).not.toHaveBeenCalled();
    expect(attempt).toHaveBeenCalledExactlyOnceWith("signIn", { ip: "198.51.100.3" });
  });

  it("refuses a body whose actual bytes exceed the cap (padding cannot dodge the per-email limit)", async () => {
    const { guarded, handler, attempt } = setupLimited();
    const padded = passwordPost({ email: "a@x.mx", password: "p", pad: "x".repeat(MAX_PASSWORD_CALLBACK_BODY_BYTES) }, "198.51.100.4");
    const response = await guarded(padded, ctx);
    expect(response.status).toBe(413);
    expect(handler).not.toHaveBeenCalled();
    expect(attempt).toHaveBeenCalledExactlyOnceWith("signIn", { ip: "198.51.100.4" });
  });

  it("refuses an oversized streamed body without a length header, stopping at the cap", async () => {
    const { guarded, handler } = setupLimited();
    let pulled = 0;
    const chunk = new TextEncoder().encode("x".repeat(1024));
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 1000) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const request = new NextRequest(`${SITE}/api/auth/callback/password`, {
      method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" }, duplex: "half",
      // Node needs `duplex` for a streamed request body; NextRequest's init type omits it.
    } as ConstructorParameters<typeof NextRequest>[1]);
    const response = await guarded(request, ctx);
    expect(response.status).toBe(413);
    expect(handler).not.toHaveBeenCalled();
    // Read stops just past the cap instead of buffering the ~1 MB stream.
    expect(pulled * 1024).toBeLessThan(MAX_PASSWORD_CALLBACK_BODY_BYTES * 4);
  });

  it("answers 429, not 413, when the address is already over its limit", async () => {
    const { guarded } = setupLimited(vi.fn<Attempt>(() => ({ ok: false, retryAfterMs: 1_000 })));
    const response = await guarded(passwordPost({ email: "a@x.mx", password: "p", pad: "x".repeat(MAX_PASSWORD_CALLBACK_BODY_BYTES) }), ctx);
    expect(response.status).toBe(429);
  });

  it("admits a body right at the cap", async () => {
    const { guarded, handler } = setupLimited();
    const base = new URLSearchParams({ email: "a@x.mx", password: "p", pad: "", csrfToken: CSRF_TOKEN }).toString();
    const pad = "x".repeat(MAX_PASSWORD_CALLBACK_BODY_BYTES - base.length);
    const response = await guarded(passwordPost({ email: "a@x.mx", password: "p", pad }), ctx);
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not rate limit other auth requests", async () => {
    const { guarded, attempt } = setupLimited();
    await guarded(new NextRequest(`${SITE}/api/auth/session`), ctx);
    await guarded(new NextRequest(`${SITE}/api/auth/callback/password`), ctx);
    expect(attempt).not.toHaveBeenCalled();
  });

  it("limits the password callback reached through decoded or extra segments", async () => {
    const { guarded, attempt } = setupLimited();
    for (const path of ["/api/auth/callback/%70assword", "/api/auth/callback/password/x", "/api/auth/CALLBACK/password/"]) {
      await guarded(new NextRequest(`${SITE}${path}`, { method: "POST", body: "email=a%40x.mx", headers: { "content-type": "application/x-www-form-urlencoded" } }), ctx);
    }
    expect(attempt).toHaveBeenCalledTimes(3);
  });
});
