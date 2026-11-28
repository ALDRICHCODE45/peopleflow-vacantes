/**
 * Our password requirements, stated instead of echoing Cognito's policy
 * message: one list for the server-only Cognito client (its `invalid_password`
 * answer) and for the sign-up / reset screens (live requirements). It must
 * match the user pool's password policy (Cognito default: 8+ characters with
 * lowercase, uppercase, number and symbol; console checklist, L13).
 *
 * Client-safe on purpose (no `server-only`): the screens render from it.
 */
export const PASSWORD_REQUIREMENTS = ["min_length_8", "lowercase", "uppercase", "number", "symbol"] as const;
export type PasswordRequirement = (typeof PASSWORD_REQUIREMENTS)[number];

/** Cognito's own maximum password length. */
export const MAX_PASSWORD_LENGTH = 256;

/**
 * Cognito's documented special characters. The checks are deliberately no
 * looser than Cognito's (ASCII letters for the case rules, only these symbols),
 * so a password the screen accepts is one the pool accepts.
 */
const COGNITO_SYMBOLS = new Set("^$*.[]{}()?\"!@#%&/\\,><':;|_~`=+-");

export function passwordChecks(password: string): Record<PasswordRequirement, boolean> {
  return {
    min_length_8: password.length >= 8,
    lowercase: /[a-z]/.test(password),
    uppercase: /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
    symbol: Array.from(password).some((character) => COGNITO_SYMBOLS.has(character)),
  };
}

export function meetsPasswordPolicy(password: string): boolean {
  if (password.length > MAX_PASSWORD_LENGTH) return false;
  const checks = passwordChecks(password);
  return PASSWORD_REQUIREMENTS.every((requirement) => checks[requirement]);
}
