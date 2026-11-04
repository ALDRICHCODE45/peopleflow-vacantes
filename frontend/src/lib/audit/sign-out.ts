import { endSessionAction } from "./session-actions";

type SignOutDeps = {
  endSession: () => Promise<void>;
  signOut: (options: { callbackUrl: string }) => Promise<unknown>;
  timeoutMs: number;
};

// NextAuth loads on use, so importing a sign-out button never depends on its module shape.
const DEFAULT_DEPS: SignOutDeps = {
  endSession: endSessionAction,
  signOut: async (options) => (await import("next-auth/react")).signOut(options),
  timeoutMs: 3000,
};

/**
 * Every «Cerrar sesión» button calls this instead of NextAuth's signOut. NextAuth
 * clears the session before the Cognito logout route runs, so the end of the
 * session is recorded first, while the token is still valid. Recording is best
 * effort and bounded in time; a sign-out failure still reaches the caller.
 */
export async function signOutWithAudit(callbackUrl: string, deps: SignOutDeps = DEFAULT_DEPS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>(resolve => { timer = setTimeout(resolve, deps.timeoutMs); });
  try { await Promise.race([deps.endSession().catch(() => {}), timeout]); }
  finally { clearTimeout(timer); }
  await deps.signOut({ callbackUrl });
}
