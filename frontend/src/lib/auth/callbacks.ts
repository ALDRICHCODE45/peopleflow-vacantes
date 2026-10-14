import type { NextAuthOptions } from "next-auth";
import { EMPLOYER_LOGIN_PATH, type AuthEnv } from "./env";
import { buildCognitoProvider } from "./provider";
import { expireSession, hasUsableCredentials, refreshAccessToken, refreshSessionToken, type RefreshObserver, type TokenLike } from "./refresh";
import { toPublicSession } from "./session";

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
    },
  };
}
