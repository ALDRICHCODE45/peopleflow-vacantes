import "server-only";
import type { CognitoClient } from "../cognito/client";
import { MAX_PASSWORD_LENGTH, meetsPasswordPolicy } from "../password-policy";
import type { AuthAttemptKeys, AuthAttemptLimiter, AuthAttemptOperation } from "../rate-limit";
import {
  displayName,
  validCode,
  validEmail,
  type ConfirmSignUpActionResult,
  type ResendCodeActionResult,
  type SignUpActionResult,
  type SignUpField,
} from "./contract";

export type SignUpOperationsDeps = {
  /** Lazily built (as in options.ts): a misconfigured pool answers `unavailable`. */
  cognito: () => Pick<CognitoClient, "signUp" | "confirmSignUp" | "resendCode">;
  limiter: Pick<AuthAttemptLimiter, "attempt">;
};

const UNAVAILABLE = { ok: false, reason: "unavailable" } as const;
const TOO_MANY = { ok: false, reason: "too_many_attempts" } as const;

function field(input: unknown, key: string): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

/** The email as Cognito gets it (the client lower-cases it for the username). */
function emailFrom(input: unknown): string | null {
  const email = field(input, "email");
  return email !== undefined && validEmail(email) ? email.trim() : null;
}

/**
 * The sign-up, confirm and resend steps behind the server actions (A4.4):
 * validate → rate limit per client address and per normalized email (shared
 * limiter, before Cognito) → call the server-only Cognito client → map to a
 * closed result. Passwords and codes are never logged, echoed or returned;
 * nothing throws to the caller.
 */
export function createSignUpOperations({ cognito, limiter }: SignUpOperationsDeps) {
  function admitted(operation: AuthAttemptOperation, ip: string | null, email: string): boolean {
    const keys: AuthAttemptKeys = ip ? { ip, email } : { email };
    return limiter.attempt(operation, keys).ok;
  }

  return {
    async signUp(input: unknown, ip: string | null): Promise<SignUpActionResult> {
      const name = displayName(field(input, "name") ?? "");
      const email = emailFrom(input);
      const password = field(input, "password");
      const fields: SignUpField[] = [];
      if (name === null) fields.push("name");
      if (email === null) fields.push("email");
      if (password === undefined || password.length > MAX_PASSWORD_LENGTH || !meetsPasswordPolicy(password)) fields.push("password");
      if (name === null || email === null || password === undefined || fields.length > 0) return { ok: false, reason: "invalid_input", fields };
      if (!admitted("signUp", ip, email)) return TOO_MANY;
      try {
        const result = await cognito().signUp(email, password, name);
        if (result.ok) return { ok: true, confirmed: result.confirmed };
        switch (result.reason) {
          case "email_taken":
          case "invalid_password":
          case "too_many_attempts":
            return { ok: false, reason: result.reason };
          default:
            return UNAVAILABLE;
        }
      } catch {
        return UNAVAILABLE;
      }
    },

    async confirmSignUp(input: unknown, ip: string | null): Promise<ConfirmSignUpActionResult> {
      const email = emailFrom(input);
      const code = field(input, "code");
      if (email === null || code === undefined || !validCode(code)) return { ok: false, reason: "invalid_input" };
      if (!admitted("confirmSignUp", ip, email)) return TOO_MANY;
      try {
        const result = await cognito().confirmSignUp(email, code);
        if (result.ok) return { ok: true };
        switch (result.reason) {
          case "code_mismatch":
          case "code_expired":
          case "too_many_attempts":
            return { ok: false, reason: result.reason };
          default:
            return UNAVAILABLE;
        }
      } catch {
        return UNAVAILABLE;
      }
    },

    async resendCode(input: unknown, ip: string | null): Promise<ResendCodeActionResult> {
      const email = emailFrom(input);
      if (email === null) return { ok: false, reason: "invalid_input" };
      if (!admitted("resendCode", ip, email)) return TOO_MANY;
      try {
        const result = await cognito().resendCode(email);
        if (result.ok) return { ok: true };
        return result.reason === "too_many_attempts" ? TOO_MANY : UNAVAILABLE;
      } catch {
        return UNAVAILABLE;
      }
    },
  };
}
