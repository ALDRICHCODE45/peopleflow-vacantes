import { createHash, timingSafeEqual } from "node:crypto";
import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";
import { serializeLogoutKindCookie } from "./logout";
import { clientIpFrom, type AuthAttemptLimiter } from "./rate-limit";
import { sessionKindOf, type SessionKind } from "./refresh";
import { IDENTITY_PROVIDER_PARAM, type SocialProvider } from "./social";

// The App Router context NextAuth expects (`{ params }`), passed through untouched.
type RouteContext = { params: Promise<{ nextauth: string[] }> };
export type AuthRouteHandler = (request: NextRequest, context: RouteContext) => Promise<Response>;

export type AuthRouteGuardConfig = {
  secret: string;
  siteUrl: string;
  /**
   * The enabled social providers, or a function resolved on each social
   * sign-in (L16 R3/R4) so a bad AUTH_SOCIAL_* value never breaks the module:
   * if it throws, every identity_provider sign-in is refused.
   */
  socialProviders: readonly SocialProvider[] | (() => readonly SocialProvider[]);
  /** Per-IP and per-email limits on the password callback (L16 R1). */
  rateLimiter?: Pick<AuthAttemptLimiter, "attempt">;
};

/** The NextAuth credentials provider id (credentials.ts), kept literal to avoid importing the provider here. */
const PASSWORD_PROVIDER = "password";

const AUTH_PREFIX = "/api/auth/";

type AuthRoute = { action?: string; provider?: string } | "undecodable";

/**
 * NextAuth acts on the first two `[...nextauth]` segments only (action,
 * provider) and ignores the rest, so the guard matches on decoded, lower-cased
 * segments: `/signin/cognito/x`, `/signin/cognito/` and `/signin/%63ognito` are
 * all the Cognito sign-in. A segment that cannot be decoded is refused.
 */
function routeFromPath(pathname: string): AuthRoute {
  if (!pathname.startsWith(AUTH_PREFIX)) return {};
  const segments: string[] = [];
  for (const raw of pathname.slice(AUTH_PREFIX.length).split("/")) {
    if (raw === "") continue;
    try {
      segments.push(decodeURIComponent(raw).toLowerCase());
    } catch {
      return "undecodable";
    }
  }
  return { action: segments[0], provider: segments[1] };
}

/** The segments Next resolved for NextAuth itself; unreadable params count as none. */
async function routeFromContext(context: RouteContext): Promise<{ action?: string; provider?: string }> {
  try {
    const segments = (await context.params)?.nextauth;
    if (!Array.isArray(segments)) return {};
    const [action, provider] = segments.map((segment) => (typeof segment === "string" ? segment.toLowerCase() : ""));
    return { action, provider };
  } catch {
    return {};
  }
}

/**
 * Cap on a password-callback body. A real one is the email (≤ 254), password
 * (≤ 256), CSRF token, callbackUrl and flags: well under 1 KiB encoded.
 */
export const MAX_PASSWORD_CALLBACK_BODY_BYTES = 8 * 1024;

const OVERSIZED = Symbol("oversized");

/** Reads at most `limit` bytes of a clone; past it, stops (cancels) and reports OVERSIZED. */
async function readCapped(request: NextRequest, limit: number): Promise<string | typeof OVERSIZED> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return OVERSIZED;
  const body = request.clone().body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      // Not awaited: cancelling one branch of a cloned (teed) body settles only
      // when the other branch is cancelled too. Reading stops here, so nothing
      // more is pulled or buffered.
      reader.cancel().catch(() => {});
      return OVERSIZED;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

type CallbackFields = { email?: string; csrfToken?: string };

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * The `email` and `csrfToken` fields of a password-callback body, read from a
 * bounded clone (NextAuth reads the original) exactly as NextAuth parses it:
 * form-encoded or JSON, last value wins. The password is never read into a
 * variable.
 */
async function submittedFields(request: NextRequest): Promise<CallbackFields | typeof OVERSIZED> {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    const text = await readCapped(request, MAX_PASSWORD_CALLBACK_BODY_BYTES);
    if (text === OVERSIZED) return OVERSIZED;
    if (contentType.includes("application/json")) {
      const body: unknown = JSON.parse(text);
      if (!body || typeof body !== "object") return {};
      const { email, csrfToken } = body as { email?: unknown; csrfToken?: unknown };
      return { email: stringField(email), csrfToken: stringField(csrfToken) };
    }
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(text);
      return { email: params.getAll("email").at(-1), csrfToken: params.getAll("csrfToken").at(-1) };
    }
  } catch {
    // An unreadable body is limited by address only; NextAuth rejects it anyway.
  }
  return {};
}

/** NextAuth v4's CSRF cookie name: `__Host-` exactly when it uses secure cookies (https NEXTAUTH_URL). */
function csrfCookieName(secureCookie: boolean): string {
  return `${secureCookie ? "__Host-" : ""}next-auth.csrf-token`;
}

/**
 * NextAuth's double-submit check (core/lib/csrf-token.js), done here so the
 * per-email budget is only spent by requests NextAuth would accept: the cookie
 * is `token|sha256(token + secret)` and the body's csrfToken equals `token`.
 * The cookie is split exactly like NextAuth (`split("|")`, first two parts), so
 * every pair NextAuth accepts also spends the email budget. A pair is not tied to
 * a person: anyone can fetch one from /api/auth/csrf, so this only stops bare
 * scripted requests from burning an email's budget; targeted lockout of a known
 * email stays possible (accepted, bounded by the window). NextAuth makes the final call.
 */
function hasValidCsrfPair(request: NextRequest, secret: string, secureCookie: boolean, bodyToken: string | undefined): boolean {
  const cookie = request.cookies.get(csrfCookieName(secureCookie))?.value;
  if (!cookie || !bodyToken) return false;
  const [token, hash] = cookie.split("|");
  if (!token || hash === undefined) return false;
  const expected = createHash("sha256").update(`${token}${secret}`).digest("hex");
  const same = (a: string, b: string) => {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  };
  return same(hash, expected) && same(bodyToken, token);
}

/**
 * Wraps the NextAuth route handler with three narrow, server-side rules
 * (routes matched on the decoded segments from the URL and from Next's params,
 * extra segments ignored as NextAuth ignores them):
 *
 * 1. POST sign-in with the Cognito OAuth provider admits at most one query
 *    param, `identity_provider`, and only with an enabled provider name.
 *    NextAuth merges sign-in query params over the provider's authorization
 *    params on POST, so without this a request could drop the L8 scope or pick
 *    a disabled IdP. GET never starts an authorization (NextAuth renders or
 *    redirects to the sign-in page), so it passes through unchanged. The bare
 *    POST (no params) stays open: the candidate apply wizard still uses it
 *    (src/features/candidate-applications/wizard.tsx) until A4.7.
 * 2. POST to the password callback is rate limited per client address (when
 *    one can be derived) and, only with a valid NextAuth CSRF pair, per
 *    submitted email before NextAuth (and so Cognito) runs; over the limit it
 *    answers NextAuth's own `{ url }` shape with `error=too_many_attempts`.
 *    A body over MAX_PASSWORD_CALLBACK_BODY_BYTES (declared or actual; the
 *    read stops at the cap) is refused with 413 after counting the address.
 * 3. Sign-out leaves the session kind for the logout route, because NextAuth
 *    clears the session cookie before that route runs (logout.ts).
 *
 * Every other auth request reaches NextAuth unchanged.
 */
export function guardAuthRoute(handler: AuthRouteHandler, config: AuthRouteGuardConfig): AuthRouteHandler {
  const secureCookie = config.siteUrl.startsWith("https://");
  const { socialProviders, rateLimiter } = config;

  function enabledProviders(): ReadonlySet<string> {
    try {
      const providers = typeof socialProviders === "function" ? socialProviders() : socialProviders;
      return new Set(providers.map((provider) => provider.identityProvider));
    } catch {
      return new Set();
    }
  }

  function tooManyAttempts(retryAfterMs: number): Response {
    return NextResponse.json(
      { url: new URL("/api/auth/error?error=too_many_attempts", config.siteUrl).toString() },
      { status: 429, headers: { "retry-after": String(Math.max(1, Math.ceil(retryAfterMs / 1000))) } },
    );
  }

  function refuseSignIn(): Response {
    // Same `{ url }` shape NextAuth answers to next-auth/react, pointing at its generic error.
    return NextResponse.json({ url: new URL("/api/auth/error?error=OAuthSignin", config.siteUrl).toString() }, { status: 400 });
  }

  async function sessionKind(request: NextRequest): Promise<SessionKind> {
    try {
      const token = await getToken({ req: request, secret: config.secret, secureCookie });
      return token ? sessionKindOf(token) : "oauth";
    } catch {
      return "oauth";
    }
  }

  return async (request, context) => {
    const { searchParams } = request.nextUrl;
    const fromPath = routeFromPath(request.nextUrl.pathname);
    if (fromPath === "undecodable") return refuseSignIn();
    const fromContext = await routeFromContext(context);
    const is = (action: string, provider?: string) =>
      [fromPath, fromContext].some((route) => route.action === action && (provider === undefined || route.provider === provider));

    if (is("signin", "cognito") && request.method === "POST") {
      const keys = [...searchParams.keys()];
      if (keys.length > 0) {
        const values = searchParams.getAll(IDENTITY_PROVIDER_PARAM);
        if (keys.length !== 1 || values.length !== 1 || !enabledProviders().has(values[0])) return refuseSignIn();
      }
      return handler(request, context);
    }

    if (rateLimiter && is("callback", PASSWORD_PROVIDER) && request.method === "POST") {
      const address = clientIpFrom(request.headers);
      const ip = address === null ? {} : { ip: address };
      const fields = await submittedFields(request);
      if (fields === OVERSIZED) {
        // Refused rather than passed on: padding a body past the cap would
        // otherwise skip the per-email limit. The address is still counted.
        const verdict = rateLimiter.attempt("signIn", ip);
        if (!verdict.ok) return tooManyAttempts(verdict.retryAfterMs);
        return NextResponse.json({ url: new URL("/api/auth/error?error=invalid_request", config.siteUrl).toString() }, { status: 413 });
      }
      // Without a valid CSRF pair only the address is counted; NextAuth rejects the request.
      const email = hasValidCsrfPair(request, config.secret, secureCookie, fields.csrfToken) && fields.email !== undefined ? { email: fields.email } : {};
      const verdict = rateLimiter.attempt("signIn", { ...ip, ...email });
      if (!verdict.ok) return tooManyAttempts(verdict.retryAfterMs);
      return handler(request, context);
    }

    if (is("signout") && request.method === "POST") {
      const kind = await sessionKind(request);
      const response = await handler(request, context);
      // Appended raw so NextAuth's own Set-Cookie headers (session chunks, CSRF) stay byte-identical.
      const headers = new Headers(response.headers);
      headers.append("set-cookie", serializeLogoutKindCookie(kind, secureCookie));
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }

    return handler(request, context);
  };
}
