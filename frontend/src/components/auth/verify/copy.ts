import type { AlertTone } from "../sign-in/copy";
import type { SignInAudience } from "../sign-in/routes";

/** Artboard 01 · Verifica tu correo (design/embedded-auth/_src/ui.js `verify`, FLOWS, `resend`). */
export const VERIFY_HEADING = "Verifica tu correo";

export const VERIFY_EYEBROW: Record<SignInAudience, { signUp: string; unverified: string }> = {
  // The company sign-up reads its steps in the eyebrow (artboard 01, FLOWS.upE); the candidate flow keeps A4.4's.
  employer: { signUp: "Registro de empresa · Paso 2 de 3", unverified: "Verificar cuenta" },
  candidate: { signUp: "Crear perfil", unverified: "Verificar cuenta" },
};

export const CODE_HINT = "Revisa también tu carpeta de spam. El código vence en 24 horas.";
export const RESEND_LEAD = "¿No te llegó?";
export const RESEND_LABEL = "Reenviar código";
/** 60 s between resends (ours, on top of Cognito's own limits). */
export const RESEND_COOLDOWN_SECONDS = 60;

export const VERIFY_ERRORS = {
  // Invented (A4.4): the artboard has no incomplete-code state.
  incomplete: "Escribe los 6 dígitos del código.",
  email: "Escribe un correo válido, como nombre@correo.com.",
} as const;

/** Invented (A4.4): the screen reached without a carried email (reload in another tab, storage off). */
export const ASK_EMAIL = {
  subheading: "Escribe el correo con el que creaste tu cuenta y el código que te enviamos.",
  label: "Correo",
  submit: "Continuar",
} as const;

export type VerifyAlertKind = "unverified" | "code_mismatch" | "code_expired" | "resent" | "too_many_attempts" | "network";

export const VERIFY_ALERTS: Record<VerifyAlertKind, { tone: AlertTone; title: string; body?: string }> = {
  unverified: { tone: "info", title: "Tu cuenta aún no está verificada.", body: "Te enviamos un código nuevo para terminar." },
  code_mismatch: { tone: "danger", title: "El código no es correcto.", body: "Revísalo e inténtalo de nuevo." },
  code_expired: { tone: "review", title: "Este código ya venció.", body: "Pide uno nuevo; te llega en unos segundos." },
  resent: { tone: "success", title: "Te enviamos un código nuevo.", body: "El anterior ya no sirve." },
  // Body trimmed from the sign-in copy (no password reset here): invented wording.
  too_many_attempts: { tone: "review", title: "Demasiados intentos.", body: "Espera unos minutos antes de volver a intentarlo." },
  network: { tone: "danger", title: "No pudimos conectarnos.", body: "Revisa tu conexión e inténtalo de nuevo. Lo que escribiste sigue aquí." },
};

export const EXPIRED_ACTION = "Enviar código nuevo";
export const CHANGE_EMAIL = "Cambiar correo";
export const BACK_TO_SIGN_IN = "Volver a ingresar";

export function formatCooldown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
