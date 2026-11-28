// @vitest-environment node
import { createHash } from "node:crypto";
import NextAuth from "next-auth";
import { decode } from "next-auth/jwt";
import { describe, expect, it, vi } from "vitest";
import { buildAuthOptions } from "./callbacks";
import { validateAuthEnv } from "./env";

/**
 * Drives the real NextAuth v4 request pipeline (pages API mode, which shares
 * AuthHandler with the App Router handler) for a password sign-in, then
 * decrypts the session cookie it issues: proves the hidden tokens survive from
 * authorize() into the JWT and never into the response body or other cookies.
 */
const SECRET = "fixture-secret-not-a-real-credential";
const env = validateAuthEnv({
  NODE_ENV: "test", NEXTAUTH_URL: "http://localhost:3000", NEXTAUTH_SECRET: SECRET,
  COGNITO_CLIENT_ID: "fixture-client-id", COGNITO_CLIENT_SECRET: "fixture-client-secret",
  COGNITO_ISSUER: "https://cognito-idp.us-east-1.amazonaws.com/fixture_pool",
  COGNITO_DOMAIN: "https://fixture.auth.example.com",
});
const SUB = "a1b2c3d4-5678-40ab-8def-0123456789ab";
const PASSWORD = "Sup3r-secret-pass!";
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const ACCESS = `${b64({ alg: "RS256", kid: "k" })}.${b64({ sub: SUB, token_use: "access" })}.c2ln`;

type Captured = { status: number; headers: Record<string, string | string[]>; body?: unknown };

async function postCredentials(signIn: ReturnType<typeof vi.fn>) {
  vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");
  const csrf = "fixture-csrf-token";
  const csrfCookie = `${csrf}|${createHash("sha256").update(`${csrf}${SECRET}`).digest("hex")}`;
  const options = buildAuthOptions(env, undefined, {}, { cognito: () => ({ signIn, refresh: vi.fn() }) as never });
  const captured: Captured = { status: 200, headers: {} };
  const res = {
    status(code: number) { captured.status = code; return res; },
    setHeader(name: string, value: string | string[]) { captured.headers[name.toLowerCase()] = value; return res; },
    getHeader(name: string) { return captured.headers[name.toLowerCase()]; },
    end() { return res; },
    json(body: unknown) { captured.body = body; return res; },
    send(body: unknown) { captured.body = body; return res; },
  };
  const req = {
    method: "POST",
    query: { nextauth: ["callback", "password"] },
    headers: { host: "localhost:3000", "content-type": "application/x-www-form-urlencoded" },
    cookies: { "next-auth.csrf-token": csrfCookie },
    body: { email: "laura@empresa.mx", password: PASSWORD, csrfToken: csrf, callbackUrl: "/empresa", json: "true" },
  };
  await NextAuth(req as never, res as never, options);
  vi.unstubAllEnvs();
  const cookies = ([] as string[]).concat(captured.headers["set-cookie"] ?? []);
  return { captured, cookies };
}

describe("password sign-in through the NextAuth pipeline", () => {
  it("issues one encrypted session cookie holding the password-session token shape", async () => {
    const signIn = vi.fn().mockResolvedValue({
      ok: true, kind: "tokens", tokens: { accessToken: ACCESS, refreshToken: "fixture-private-refresh", expiresAt: Date.now() + 3_600_000 },
    });
    const { captured, cookies } = await postCredentials(signIn);
    const session = cookies.find((c) => c.startsWith("next-auth.session-token="));
    expect(session).toBeDefined();
    const raw = decodeURIComponent(session!.split(";")[0].split("=").slice(1).join("="));
    const token = await decode({ token: raw, secret: SECRET });
    expect(token).toMatchObject({
      sub: SUB, email: "laura@empresa.mx", accessToken: ACCESS, refreshToken: "fixture-private-refresh", authKind: "password",
    });
    expect(captured.body).toEqual({ url: "http://localhost:3000/empresa" });
    const visible = JSON.stringify(captured.body) + cookies.filter((c) => c !== session).join(";");
    for (const secret of [ACCESS, "fixture-private-refresh", PASSWORD]) expect(visible).not.toContain(secret);
  });

  it.each([
    [{ ok: false, reason: "invalid_credentials" }, "invalid_credentials"],
    [{ ok: false, reason: "not_confirmed" }, "not_confirmed"],
    [{ ok: false, reason: "too_many_attempts" }, "too_many_attempts"],
    [{ ok: false, reason: "unavailable" }, "unavailable"],
  ])("answers %j with the stable error code and no session cookie", async (result, code) => {
    const { captured, cookies } = await postCredentials(vi.fn().mockResolvedValue(result));
    expect(captured.status).toBe(401);
    expect(new URL((captured.body as { url: string }).url).searchParams.get("error")).toBe(code);
    expect(cookies.some((c) => c.startsWith("next-auth.session-token="))).toBe(false);
    expect(JSON.stringify(captured.body)).not.toContain(PASSWORD);
  });
});
