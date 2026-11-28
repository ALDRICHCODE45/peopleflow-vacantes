import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";
import { serializeLogoutKindCookie } from "./logout";
import { sessionKindOf, type SessionKind } from "./refresh";
import { IDENTITY_PROVIDER_PARAM, type SocialProvider } from "./social";

// The App Router context NextAuth expects (`{ params }`), passed through untouched.
type RouteContext = { params: Promise<{ nextauth: string[] }> };
export type AuthRouteHandler = (request: NextRequest, context: RouteContext) => Promise<Response>;

export type AuthRouteGuardConfig = {
  secret: string;
  siteUrl: string;
  socialProviders: readonly SocialProvider[];
};

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
 * Wraps the NextAuth route handler with two narrow, server-side rules:
 *
 * 1. Sign-in with the Cognito OAuth provider (matched on the decoded route
 *    segments from the URL and from Next's params, extra segments ignored as
 *    NextAuth ignores them) admits at most one query param,
 *    `identity_provider`, and only with an enabled provider name. NextAuth
 *    merges sign-in query params over the provider's authorization params, so
 *    without this a request could drop the L8 scope or pick a disabled IdP.
 *    The bare hosted sign-in (no params) keeps working until A4.3 retires it.
 * 2. Sign-out leaves the session kind for the logout route, because NextAuth
 *    clears the session cookie before that route runs (logout.ts).
 *
 * Every other auth request reaches NextAuth unchanged.
 */
export function guardAuthRoute(handler: AuthRouteHandler, config: AuthRouteGuardConfig): AuthRouteHandler {
  const secureCookie = config.siteUrl.startsWith("https://");
  const enabled = new Set(config.socialProviders.map((provider) => provider.identityProvider));

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

    if (is("signin", "cognito")) {
      const keys = [...searchParams.keys()];
      if (keys.length > 0) {
        const values = searchParams.getAll(IDENTITY_PROVIDER_PARAM);
        if (keys.length !== 1 || values.length !== 1 || !enabled.has(values[0])) return refuseSignIn();
      }
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
