import type { SignInResponse } from "next-auth/react";

/**
 * What the screen does with a `signIn("password", { redirect: false })` answer.
 * The codes come from the credentials provider (lib/auth/credentials.ts) and
 * the route guard (`too_many_attempts` from the rate limiter).
 */
export type SignInOutcome = "success" | "invalid_credentials" | "too_many_attempts" | "not_confirmed" | "unavailable";

const CODES: ReadonlySet<string> = new Set(["invalid_credentials", "too_many_attempts", "not_confirmed", "unavailable"]);

export function classifySignInResult(result: SignInResponse | undefined): SignInOutcome {
  if (!result) return "unavailable";
  if (result.error) return CODES.has(result.error) ? (result.error as SignInOutcome) : "unavailable";
  if (!result.ok || !result.url) return "unavailable";
  try {
    // A CSRF bounce answers ok with NextAuth's own sign-in page: not a session.
    if (new URL(result.url, "http://localhost").pathname.startsWith("/api/auth/")) return "unavailable";
  } catch {
    return "unavailable";
  }
  return "success";
}
