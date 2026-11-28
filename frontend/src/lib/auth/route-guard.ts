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
 * The `email` field of a password-callback body, read from a clone (NextAuth
 * reads the original) exactly as NextAuth parses it: form-encoded or JSON, last
 * value wins. The password is never read into a variable.
 */
async function submittedEmail(request: NextRequest): Promise<string | undefined> {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    const clone = request.clone();
    if (contentType.includes("application/json")) {
      const body: unknown = await clone.json();
      const email = body && typeof body === "object" ? (body as { email?: unknown }).email : undefined;
      return typeof email === "string" ? email : undefined;
    }
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const values = new URLSearchParams(await clone.text()).getAll("email");
      return values.at(-1);
    }
  } catch {
    // An unreadable body is limited by address only; NextAuth rejects it anyway.
  }
  return undefined;
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
 * 2. POST to the password callback is rate limited per client address and per
 *    submitted email before NextAuth (and so Cognito) runs; over the limit it
 *    answers NextAuth's own `{ url }` shape with `error=too_many_attempts`.
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
      const verdict = rateLimiter.attempt("signIn", { ip: clientIpFrom(request.headers), email: await submittedEmail(request) });
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
