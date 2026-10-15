import { hasUsableCredentials, REFRESH_ERROR, type RefreshError, type TokenLike } from "./refresh";

export type PublicUser = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

export type PublicSession = {
  user?: PublicUser;
  expires: string;
  error?: RefreshError;
};

/**
 * Projects the server-only JWT into the session returned to the browser. The
 * output carries at most the standard user fields and, on an unusable token,
 * the generic refresh error. Access, refresh, and ID tokens are never included.
 */
export function toPublicSession(session: PublicSession, token: TokenLike, now = Date.now()): PublicSession {
  if (!hasUsableCredentials(token, now)) {
    return { expires: session.expires, error: REFRESH_ERROR };
  }

  return {
    expires: session.expires,
    user: {
      name: token.name ?? session.user?.name ?? null,
      email: token.email ?? session.user?.email ?? null,
      image: token.picture ?? session.user?.image ?? null,
    },
  };
}
