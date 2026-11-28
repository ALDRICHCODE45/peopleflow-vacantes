import type { NextAuthOptions } from "next-auth";
import type { CognitoClient } from "./cognito/client";
import type { CognitoClientOperation } from "./cognito/errors";
import { PASSWORD_PROVIDER_ID, buildPasswordProvider, takePasswordTokens } from "./credentials";
import { EMPLOYER_LOGIN_PATH, type AuthEnv } from "./env";
import { buildCognitoProvider } from "./provider";
import { expireSession, hasUsableCredentials, refreshSessionToken, refreshSessionTokens, type RefreshObserver, type TokenLike } from "./refresh";
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
// preserves the original behavior exactly. `onSignIn` runs once per sign-in
// with the fresh access token (audit «Inició sesión»); its failure never blocks.
export type AuthHooks = { onSignIn?: (accessToken: string) => Promise<void> };

/**
 * Embedded password sign-in (A4.2). Without `cognito` only the OAuth provider
 * is registered. The client factory is called lazily, per sign-in/refresh.
 */
export type AuthDeps = {
  cognito?: () => Pick<CognitoClient, "signIn" | "refresh">;
  onServiceError?: (operation: CognitoClientOperation, errorName: string | null) => void;
};

export function buildAuthOptions(authEnv: AuthEnv, observer?: RefreshObserver, hooks: AuthHooks = {}, deps: AuthDeps = {}): NextAuthOptions {
  const { cognito, onServiceError } = deps;
  return {
    secret: authEnv.secret,
    session: { strategy: "jwt" },
    pages: { signIn: EMPLOYER_LOGIN_PATH, error: EMPLOYER_LOGIN_PATH },
    providers: [
      buildCognitoProvider(authEnv),
      ...(cognito ? [buildPasswordProvider({ cognito, onServiceError })] : []),
    ],
    callbacks: {
      async jwt({ token, account, user }) {
        if (account) {
          // Both kinds produce the same cookie shape; `authKind` picks refresh and logout.
          const password = account.type === "credentials" && account.provider === PASSWORD_PROVIDER_ID;
          const tokens = password
            ? takePasswordTokens(user)
            : {
                accessToken: account.access_token,
                refreshToken: account.refresh_token,
                expiresAt: typeof account.expires_at === "number" ? account.expires_at * 1000 : undefined,
              };
          const initial: TokenLike = {
            sub: token.sub, name: token.name, email: token.email, picture: token.picture,
            accessToken: tokens?.accessToken,
            refreshToken: tokens?.refreshToken,
            expiresAt: tokens?.expiresAt,
            authKind: password ? "password" : "oauth",
          };
          if (!hasUsableCredentials(initial, Date.now())) return expireSession(initial);
          if (hooks.onSignIn && initial.accessToken) await hooks.onSignIn(initial.accessToken).catch(() => {});
          return initial;
        }
        const current = token as TokenLike;
        return refreshSessionToken({
          token: current,
          now: Date.now(),
          observer,
          refresh: (refreshToken) => refreshSessionTokens(current, refreshToken, {
            oauth: {
              tokenEndpoint: authEnv.tokenEndpoint,
              clientId: authEnv.clientId,
              clientSecret: authEnv.clientSecret,
            },
            cognito,
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
