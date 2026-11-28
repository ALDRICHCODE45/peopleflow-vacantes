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

const SIGN_OUT_PATH = "/api/auth/signout";
const COGNITO_SIGN_IN_PATH = "/api/auth/signin/cognito";

/**
 * Wraps the NextAuth route handler with two narrow, server-side rules:
 *
 * 1. Sign-in with the Cognito OAuth provider admits at most one query param,
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
    const { pathname, searchParams } = request.nextUrl;

    if (pathname === COGNITO_SIGN_IN_PATH) {
      const keys = [...searchParams.keys()];
      if (keys.length > 0) {
        const values = searchParams.getAll(IDENTITY_PROVIDER_PARAM);
        if (keys.length !== 1 || values.length !== 1 || !enabled.has(values[0])) return refuseSignIn();
      }
      return handler(request, context);
    }

    if (pathname === SIGN_OUT_PATH && request.method === "POST") {
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
