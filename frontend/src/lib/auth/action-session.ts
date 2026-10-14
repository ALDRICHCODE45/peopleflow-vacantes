import "server-only";
import type { NextAuthOptions } from "next-auth";
import type { NextResponse } from "next/server";
import { resolveBackendSession } from "./backend-session";

type ResponseCookie = ReturnType<NextResponse["cookies"]["getAll"]>[number];

/**
 * Parses one Set-Cookie header for `cookies().set`. Next's own parser drops an
 * empty value and `Max-Age=0`, which would turn a session deletion into a
 * no-op, so deletions are parsed here without that falsy filtering.
 */
export function parseSetCookieHeader(header: string): ResponseCookie | null {
  const [pair, ...attributes] = header.split(";");
  const separator = pair.indexOf("=");
  if (separator <= 0) return null;
  const name = pair.slice(0, separator).trim();
  if (!name) return null;
  let value = pair.slice(separator + 1).trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    // Keep the raw value when it is not percent-encoded.
  }
  const cookie: ResponseCookie = { name, value };
  for (const attribute of attributes) {
    const index = attribute.indexOf("=");
    const key = (index < 0 ? attribute : attribute.slice(0, index)).trim().toLowerCase();
    const raw = index < 0 ? "" : attribute.slice(index + 1).trim();
    if (key === "path") cookie.path = raw;
    else if (key === "domain") cookie.domain = raw;
    else if (key === "max-age" && /^-?\d+$/.test(raw)) cookie.maxAge = Number(raw);
    else if (key === "expires" && !Number.isNaN(Date.parse(raw))) cookie.expires = new Date(raw);
    else if (key === "httponly") cookie.httpOnly = true;
    else if (key === "secure") cookie.secure = true;
    else if (key === "samesite" && /^(lax|strict|none)$/i.test(raw))
      cookie.sameSite = raw.toLowerCase() as "lax" | "strict" | "none";
  }
  return cookie;
}

export type ActionSessionDeps = {
  /** Incoming request headers; only `cookie` is forwarded to NextAuth. */
  requestHeaders: Headers;
  /** Configured NEXTAUTH_URL origin. */
  authUrl: string;
  options: NextAuthOptions;
  runSession: (options: NextAuthOptions, request: Request) => Promise<Response>;
  /** Writes one cookie to the action response (Server Actions may set cookies). */
  applyCookie: (cookie: ResponseCookie) => void;
};

/**
 * Resolves the employer's Cognito access token inside a Server Action.
 *
 * Runs the cookie-writing NextAuth session handler (which refreshes an expired
 * access token) and applies its Set-Cookie headers to the action response, so a
 * rotated session persists. Server Components cannot write cookies, which is
 * why credentialed backend calls resolve the session here and not during render.
 * Any failure returns null: callers fail closed and the token never leaves the server.
 */
export async function resolveActionAccessToken(deps: ActionSessionDeps): Promise<string | null> {
  const cookie = deps.requestHeaders.get("cookie");
  if (!cookie) return null;
  try {
    const request = new Request(new URL("/api/auth/session", deps.authUrl), {
      method: "GET",
      headers: { cookie },
    });
    const { accessToken, cookies } = await resolveBackendSession(deps.options, (options) =>
      deps.runSession(options, request),
    );
    for (const header of cookies) {
      const item = parseSetCookieHeader(header);
      if (item) deps.applyCookie(item);
    }
    if (!accessToken || /\s/.test(accessToken)) return null;
    return accessToken;
  } catch {
    return null;
  }
}

type NextAuthApiHandler = (req: unknown, res: unknown) => Promise<unknown>;

/** Parses a Cookie request header the way NextAuth's API mode expects (first value wins). */
function parseCookieHeader(header: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    if (!name || name in cookies) continue;
    const raw = part.slice(index + 1).trim();
    try {
      cookies[name] = decodeURIComponent(raw);
    } catch {
      cookies[name] = raw;
    }
  }
  return cookies;
}

/**
 * Runs NextAuth's session action in its API (req, res) mode with an explicit
 * request. The App Router mode would ignore this request and read the ambient
 * `next/headers`, forwarding every incoming header; here NextAuth receives only
 * the cookie header and its parsed cookies, and its response is collected into
 * a standard Response (status, Set-Cookie, JSON body).
 */
export async function runSessionApiHandler(handler: NextAuthApiHandler, request: Request): Promise<Response> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  let status = 200;
  let body: unknown = null;
  const setCookies: string[] = [];
  const headers = new Headers();
  const res = {
    status(code: number) {
      status = code;
      return res;
    },
    setHeader(name: string, value: unknown) {
      if (name.toLowerCase() === "set-cookie") {
        // NextAuth re-sets the accumulated list on every cookie it adds.
        setCookies.splice(0, setCookies.length, ...(Array.isArray(value) ? value : [value]).map(String));
      } else {
        headers.set(name, String(value));
      }
      return res;
    },
    getHeader(name: string) {
      return name.toLowerCase() === "set-cookie" ? [...setCookies] : (headers.get(name) ?? undefined);
    },
    send(value: unknown) {
      body = value;
      return res;
    },
    json(value: unknown) {
      body = value;
      return res;
    },
    end() {
      return res;
    },
  };
  await handler(
    {
      method: "GET",
      query: { nextauth: ["session"] },
      headers: { cookie: cookieHeader },
      cookies: parseCookieHeader(cookieHeader),
      body: undefined,
    },
    res,
  );
  for (const value of setCookies) headers.append("set-cookie", value);
  if (body === null || body === undefined) return new Response(null, { status, headers });
  headers.set("content-type", "application/json");
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
}

/** Runtime wiring for Server Actions: request headers, cookie store and NextAuth. */
export async function getActionAccessToken(): Promise<string | null> {
  try {
    const [{ headers, cookies }, { default: NextAuth }, { authOptions }, { validateAuthEnv }] =
      await Promise.all([
        import("next/headers"),
        import("next-auth"),
        import("./options"),
        import("./env"),
      ]);
    const store = await cookies();
    return await resolveActionAccessToken({
      requestHeaders: await headers(),
      authUrl: validateAuthEnv(process.env).siteUrl,
      options: authOptions,
      // API mode: NextAuth sees only the explicit request built above.
      runSession: (options, request) =>
        runSessionApiHandler(NextAuth(options) as NextAuthApiHandler, request),
      applyCookie: (item) => store.set(item),
    });
  } catch {
    return null;
  }
}
