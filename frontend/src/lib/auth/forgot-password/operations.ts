import "server-only";
import type { CognitoClient } from "../cognito/client";
import { MAX_PASSWORD_LENGTH, meetsPasswordPolicy } from "../password-policy";
import type { AuthAttemptKeys, AuthAttemptLimiter, AuthAttemptOperation } from "../rate-limit";
import { validCode, validEmail } from "../sign-up/contract";
import type { ConfirmForgotPasswordActionResult, ConfirmForgotPasswordField, ForgotPasswordActionResult } from "./contract";

export type ForgotPasswordOperationsDeps = {
  /** Lazily built (as in options.ts): a misconfigured pool answers `unavailable`. */
  cognito: () => Pick<CognitoClient, "forgotPassword" | "confirmForgotPassword">;
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
 * The request-code and reset steps behind the server actions (A4.6), the same
 * shape as the sign-up operations: validate → rate limit per client address and
 * per normalized email (shared limiter budgets `forgotPassword` /
 * `confirmForgotPassword`, before Cognito) → call the server-only Cognito
 * client → map to a closed result. The new password and the code are never
 * logged, echoed or returned; nothing throws to the caller.
 *
 * Existence hiding: the Cognito client already answers `ok` when ForgotPassword
 * meets an unknown user or an account-state error (unconfirmed, no verified
 * email: errors.ts SILENT_SEND), so `forgotPassword` is `ok` whenever the
 * request was admitted and Cognito did not fail or throttle.
 */
export function createForgotPasswordOperations({ cognito, limiter }: ForgotPasswordOperationsDeps) {
  function admitted(operation: AuthAttemptOperation, ip: string | null, email: string): boolean {
    const keys: AuthAttemptKeys = ip ? { ip, email } : { email };
    return limiter.attempt(operation, keys).ok;
  }

  return {
    async forgotPassword(input: unknown, ip: string | null): Promise<ForgotPasswordActionResult> {
      const email = emailFrom(input);
      if (email === null) return { ok: false, reason: "invalid_input" };
      if (!admitted("forgotPassword", ip, email)) return TOO_MANY;
      try {
        const result = await cognito().forgotPassword(email);
        if (result.ok) return { ok: true };
        return result.reason === "too_many_attempts" ? TOO_MANY : UNAVAILABLE;
      } catch {
        return UNAVAILABLE;
      }
    },

    async confirmForgotPassword(input: unknown, ip: string | null): Promise<ConfirmForgotPasswordActionResult> {
      const email = emailFrom(input);
      const code = field(input, "code");
      const newPassword = field(input, "newPassword");
      const fields: ConfirmForgotPasswordField[] = [];
      if (email === null) fields.push("email");
      if (code === undefined || !validCode(code)) fields.push("code");
      if (newPassword === undefined || newPassword.length > MAX_PASSWORD_LENGTH || !meetsPasswordPolicy(newPassword)) fields.push("password");
      if (email === null || code === undefined || newPassword === undefined || fields.length > 0) return { ok: false, reason: "invalid_input", fields };
      if (!admitted("confirmForgotPassword", ip, email)) return TOO_MANY;
      try {
        const result = await cognito().confirmForgotPassword(email, code, newPassword);
        if (result.ok) return { ok: true };
        switch (result.reason) {
          case "code_mismatch":
          case "code_expired":
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
  };
}
