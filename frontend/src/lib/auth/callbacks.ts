import type { NextAuthOptions } from "next-auth";
import { EMPLOYER_LOGIN_PATH, type AuthEnv } from "./env";
import { buildCognitoProvider } from "./provider";
import { expireSession, hasUsableCredentials, refreshAccessToken, refreshSessionToken, type RefreshObserver, type TokenLike } from "./refresh";
import { toPublicSession } from "./session";

/** Same-origin path prefixes NextAuth may send the browser to after sign-in or sign-out. */
const REDIRECT_PREFIXES = ["/empresa", "/candidato", "/api/auth/cognito/logout"] as const;

/**
 * Allowlisted NextAuth redirect: only same-origin URLs whose path is one of the
 * product areas (or the Cognito logout route) survive; anything else, including
 * other origins, protocol-relative URLs and unknown paths, falls back to the root.
 */
export function allowlistedRedirect(url: string, baseUrl: string): string {
  try {
    const base = new URL(baseUrl);
    const root = new URL("/", base).toString();
    const target = new URL(url, base);
    if (target.origin !== base.origin) return root;
    // Admit only the candidate apply callback, not the whole public catalog.
    const applyCallback = /^\/vacantes\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\/postular$/.test(target.pathname);
    const allowed = applyCallback || REDIRECT_PREFIXES.some(prefix => target.pathname === prefix || target.pathname.startsWith(`${prefix}/`));
    return allowed ? target.toString() : root;
  } catch {
    // NextAuth always supplies a valid baseUrl; a malformed one never redirects anywhere.
    return "/";
  }
}

// The server-only entry point supplies validated environment configuration.
// Keeping this factory free of ambient environment reads lets regression tests
// exercise the exact production callbacks with synthetic credentials. The
// optional observer is an inert development-only reporting seam; omitting it
// preserves the original behavior exactly.
export function buildAuthOptions(authEnv: AuthEnv, observer?: RefreshObserver): NextAuthOptions {
  return {
    secret: authEnv.secret,
    session: { strategy: "jwt" },
    pages: { signIn: EMPLOYER_LOGIN_PATH, error: EMPLOYER_LOGIN_PATH },
    providers: [buildCognitoProvider(authEnv)],
    callbacks: {
      async jwt({ token, account }) {
        if (account) {
          const initial: TokenLike = {
            sub: token.sub, name: token.name, email: token.email, picture: token.picture,
            accessToken: account.access_token,
            refreshToken: account.refresh_token,
            expiresAt: typeof account.expires_at === "number" ? account.expires_at * 1000 : undefined,
          };
          return hasUsableCredentials(initial, Date.now()) ? initial : expireSession(initial);
        }
        return refreshSessionToken({
          token: token as TokenLike,
          now: Date.now(),
          observer,
          refresh: (refreshToken) => refreshAccessToken({
            tokenEndpoint: authEnv.tokenEndpoint,
            clientId: authEnv.clientId,
            clientSecret: authEnv.clientSecret,
            refreshToken,
          }),
        });
      },
      async session({ session, token }) {
        return toPublicSession(session, token as TokenLike);
      },
      async redirect({ url, baseUrl }) {
        return allowlistedRedirect(url, baseUrl);
      },
    },
  };
}
