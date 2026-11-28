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
 */
export const PENDING_EMAIL_KEY = "peopleflow.auth.pendingEmail";
export const PENDING_ORIGIN_KEY = "peopleflow.auth.pendingOrigin";
export const VERIFIED_EMAIL_KEY = "peopleflow.auth.verifiedEmail";

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

export function takeVerifiedEmail(): string | null {
  try {
    const email = window.sessionStorage.getItem(VERIFIED_EMAIL_KEY);
    window.sessionStorage.removeItem(VERIFIED_EMAIL_KEY);
    return email || null;
  } catch {
    return null;
  }
}
