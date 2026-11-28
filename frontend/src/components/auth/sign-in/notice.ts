import type { SignInNotice } from "./SignInForm";

/**
 * The notice «Ingresar» opens with: the expired-session banner, the L5
 * already-registered social notice (`?error=email_in_use`), or the generic
 * callback failure for any other `?error=` NextAuth leaves. Query text is
 * never reflected.
 */
export function signInNotice(expired: boolean, params: Pick<URLSearchParams, "get">): SignInNotice | null {
  if (expired) return "expired";
  const error = params.get("error");
  if (error === "email_in_use") return "email_in_use";
  return error !== null ? "callback" : null;
}
