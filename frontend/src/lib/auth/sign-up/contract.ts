import { normalizedName, validName } from "@/features/identity/model";

/**
 * Input rules and closed results of the sign-up / verify-code server actions
 * (A4.4). Client-safe: the screens validate with the same functions before
 * calling the actions, and the actions validate again (never trust the client).
 */

/** Cognito's username/email limit (RFC 5321 path), as the sign-in route uses. */
export const MAX_EMAIL_LENGTH = 254;
export const CODE_LENGTH = 6;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_SHAPE = /^[0-9]{6}$/;

/** A trimmed email of plausible shape; Cognito and the email itself are the real check. */
export function validEmail(value: string): boolean {
  const email = value.trim();
  return email.length <= MAX_EMAIL_LENGTH && EMAIL_SHAPE.test(email);
}

/** Exactly six ASCII digits, nothing around them. */
export function validCode(value: string): boolean {
  return CODE_SHAPE.test(value);
}

/** Same rule as the candidate/employer account name (2–120 code points, no control characters). */
export function displayName(value: string): string | null {
  const name = normalizedName(value);
  return validName(name) ? name : null;
}

export type SignUpField = "name" | "email" | "password";

export type SignUpActionResult =
  | { ok: true; confirmed: boolean }
  | { ok: false; reason: "invalid_input"; fields: SignUpField[] }
  | { ok: false; reason: "email_taken" | "invalid_password" | "too_many_attempts" | "unavailable" };

export type ConfirmSignUpActionResult =
  | { ok: true }
  | { ok: false; reason: "invalid_input" | "code_mismatch" | "code_expired" | "too_many_attempts" | "unavailable" };

export type ResendCodeActionResult =
  | { ok: true }
  | { ok: false; reason: "invalid_input" | "too_many_attempts" | "unavailable" };
