/**
 * Carries the email typed in «Ingresar» to the verify-code screen (A4.4) when
 * Cognito answers not_confirmed: tab-scoped session storage, never the URL
 * (no Referer, history or server log), never the password.
 */
export const PENDING_EMAIL_KEY = "peopleflow.auth.pendingEmail";

export function rememberPendingEmail(email: string): void {
  try {
    window.sessionStorage.setItem(PENDING_EMAIL_KEY, email.trim());
  } catch {
    // Storage disabled: the verify screen asks for the email again.
  }
}

/** Drops a carried email (a new sign-in attempt starts). */
export function forgetPendingEmail(): void {
  try {
    window.sessionStorage.removeItem(PENDING_EMAIL_KEY);
  } catch {
    // Storage disabled: nothing was carried.
  }
}

/** Reads and forgets the carried email (for the A4.4 verify screen). */
export function takePendingEmail(): string | null {
  try {
    const email = window.sessionStorage.getItem(PENDING_EMAIL_KEY);
    window.sessionStorage.removeItem(PENDING_EMAIL_KEY);
    return email;
  } catch {
    return null;
  }
}
