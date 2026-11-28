/**
 * Carries an email between the embedded-auth screens in tab-scoped session
 * storage, never the URL (no Referer, history or server log), never a
 * password:
 *
 * - «Ingresar» (not_confirmed) or «Crea tu perfil» → «Verifica tu correo»,
 *   with where it came from: only the sign-in handoff resends a code on
 *   arrival (the sign-up just sent one).
 * - «Verifica tu correo» → «Ingresar», to prefill the email under the
 *   «Tu correo quedó verificado.» notice.
 * - «Recupera tu acceso» → «Ingresar» (A4.6), to prefill the email under the
 *   «Tu contraseña se actualizó.» notice; and the recovery email itself, kept
 *   while the code step is open so a reload does not lose it.
 */
import { validEmail } from "@/lib/auth/sign-up/contract";

export const PENDING_EMAIL_KEY = "peopleflow.auth.pendingEmail";
export const PENDING_ORIGIN_KEY = "peopleflow.auth.pendingOrigin";
export const VERIFIED_EMAIL_KEY = "peopleflow.auth.verifiedEmail";
export const PASSWORD_RESET_EMAIL_KEY = "peopleflow.auth.passwordResetEmail";
export const RECOVERY_EMAIL_KEY = "peopleflow.auth.recoveryEmail";

export type PendingOrigin = "sign-in" | "sign-up";
export type PendingVerification = { email: string; origin: PendingOrigin | null };

const ORIGINS: ReadonlySet<string> = new Set<PendingOrigin>(["sign-in", "sign-up"]);

/** `origin: null` keeps the email without any handoff (e.g. for a reload of the verify screen). */
export function rememberPendingEmail(email: string, origin: PendingOrigin | null): void {
  try {
    window.sessionStorage.setItem(PENDING_EMAIL_KEY, email.trim());
    if (origin) window.sessionStorage.setItem(PENDING_ORIGIN_KEY, origin);
    else window.sessionStorage.removeItem(PENDING_ORIGIN_KEY);
  } catch {
    // Storage disabled: the verify screen asks for the email again.
  }
}

/** Drops a carried email and its origin (a new attempt starts, or the code was verified). */
export function forgetPendingEmail(): void {
  try {
    window.sessionStorage.removeItem(PENDING_EMAIL_KEY);
    window.sessionStorage.removeItem(PENDING_ORIGIN_KEY);
  } catch {
    // Storage disabled: nothing was carried.
  }
}

/** Reads and forgets the carried email and its origin. */
export function takePendingVerification(): PendingVerification | null {
  try {
    const email = window.sessionStorage.getItem(PENDING_EMAIL_KEY);
    const origin = window.sessionStorage.getItem(PENDING_ORIGIN_KEY);
    window.sessionStorage.removeItem(PENDING_EMAIL_KEY);
    window.sessionStorage.removeItem(PENDING_ORIGIN_KEY);
    if (!email) return null;
    return { email, origin: origin !== null && ORIGINS.has(origin) ? (origin as PendingOrigin) : null };
  } catch {
    return null;
  }
}

/** Reads and forgets the carried email only. */
export function takePendingEmail(): string | null {
  return takePendingVerification()?.email ?? null;
}

export function rememberVerifiedEmail(email: string): void {
  try {
    window.sessionStorage.setItem(VERIFIED_EMAIL_KEY, email.trim());
  } catch {
    // Storage disabled: «Ingresar» opens without the notice.
  }
}

/** Reads and forgets the verified email; anything implausible counts as none. */
export function takeVerifiedEmail(): string | null {
  try {
    const email = window.sessionStorage.getItem(VERIFIED_EMAIL_KEY);
    window.sessionStorage.removeItem(VERIFIED_EMAIL_KEY);
    return plausibleEmail(email);
  } catch {
    return null;
  }
}

export function rememberPasswordResetEmail(email: string): void {
  try {
    window.sessionStorage.setItem(PASSWORD_RESET_EMAIL_KEY, email.trim());
  } catch {
    // Storage disabled: «Ingresar» opens without the notice.
  }
}

/** Why «Ingresar» opens with an email filled in: a verified sign-up or a changed password. */
export type SignInHandoff = { email: string; notice: "verified" | "password_reset" };

/**
 * Reads and forgets both «Ingresar» handoffs. The password reset wins: it is
 * the later step (a verified email left over from an earlier visit is stale).
 * Storage is writable by any script on the origin, so an implausible stored
 * email counts as no handoff (defense in depth; it is only ever a prefill).
 */
export function takeSignInHandoff(): SignInHandoff | null {
  let reset: string | null = null;
  try {
    reset = window.sessionStorage.getItem(PASSWORD_RESET_EMAIL_KEY);
    window.sessionStorage.removeItem(PASSWORD_RESET_EMAIL_KEY);
  } catch {
    // Storage disabled: nothing was carried.
  }
  const verified = takeVerifiedEmail();
  const resetEmail = plausibleEmail(reset);
  if (resetEmail) return { email: resetEmail, notice: "password_reset" };
  return verified ? { email: verified, notice: "verified" } : null;
}

/** The email whose reset code was requested, for a reload of the code step. */
export function rememberRecoveryEmail(email: string): void {
  try {
    window.sessionStorage.setItem(RECOVERY_EMAIL_KEY, email.trim());
  } catch {
    // Storage disabled: a reload starts the recovery again.
  }
}

/** Reads (without forgetting) the recovery email; anything implausible counts as none. */
export function readRecoveryEmail(): string | null {
  try {
    return plausibleEmail(window.sessionStorage.getItem(RECOVERY_EMAIL_KEY));
  } catch {
    return null;
  }
}

function plausibleEmail(email: string | null): string | null {
  return email && validEmail(email) ? email : null;
}

export function forgetRecoveryEmail(): void {
  try {
    window.sessionStorage.removeItem(RECOVERY_EMAIL_KEY);
  } catch {
    // Storage disabled: nothing was carried.
  }
}
