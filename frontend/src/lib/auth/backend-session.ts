import "server-only";
import type { NextAuthOptions } from "next-auth";
import { hasUsableCredentials, type TokenLike } from "./refresh";
import type { PrivateBackendSession } from "./backend-check";

/**
 * Runs the cookie-writing NextAuth session handler, not the RSC overload of
 * getServerSession (whose response cookie setters are no-ops in v4).
 * Credentials never enter the handler's response body or the public callback.
 */
export async function resolveBackendSession(
  options: NextAuthOptions,
  runSession: (options: NextAuthOptions) => Promise<Response>,
): Promise<PrivateBackendSession> {
  let accessToken: string | null = null;
  let expires: string | undefined;
  const privateOptions: NextAuthOptions = {
    ...options,
    // NextAuth failures must not emit credential-bearing diagnostics here.
    logger: { error() {}, warn() {}, debug() {} },
    debug: false,
    callbacks: {
      ...options.callbacks,
      async session({ session, token }) {
        const credentials = token as TokenLike;
        if (hasUsableCredentials(credentials, Date.now())) {
          accessToken = credentials.accessToken ?? null;
          expires = session.expires;
        }
        return { expires: session.expires };
      },
    },
  };
  try {
    const response = await runSession(privateOptions);
    const cookies = response.headers.getSetCookie();
    const body: unknown = await response.json();
    const persisted = response.status === 200 && hasPersistedSessionCookie(cookies, options) &&
      expires !== undefined && typeof body === "object" && body !== null &&
      "expires" in body && body.expires === expires;
    return { accessToken: persisted ? accessToken : null, cookies };
  } catch {
    return { accessToken: null, cookies: [] };
  }
}

/** A retained session body plus deletion/CSRF cookies is not persistence. */
function hasPersistedSessionCookie(cookies: string[], options: NextAuthOptions): boolean {
  const names = options.cookies?.sessionToken?.name
    ? [options.cookies.sessionToken.name]
    : ["next-auth.session-token", "__Secure-next-auth.session-token"];
  const effective = new Map<string, string>();
  for (const header of cookies) {
    const pair = header.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    const name = pair.slice(0, separator);
    if (!names.some((base) => name === base ||
      (name.startsWith(`${base}.`) && /^\d+$/.test(name.slice(base.length + 1))))) continue;
    // Preserve response ordering: a later cleanup overwrites an earlier chunk.
    effective.set(name, pair.slice(separator + 1));
  }
  return [...effective.values()].some((value) => value.length > 0);
}
