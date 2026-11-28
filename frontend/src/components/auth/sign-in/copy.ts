import type { SignInAudience } from "./routes";

/** Artboard 01 · Panel dividido (design/embedded-auth/_src/ui.js COPY + alerts). */
export const FIELD_COPY: Record<SignInAudience, { emailLabel: string; emailPlaceholder: string }> = {
  employer: { emailLabel: "Correo corporativo", emailPlaceholder: "tu@empresa.com" },
  candidate: { emailLabel: "Correo", emailPlaceholder: "tu@correo.com" },
};

export type AlertTone = "danger" | "review" | "info" | "success";

export type SignInAlertKind =
  | "invalid_credentials"
  | "too_many_attempts"
  | "network"
  | "social_failed"
  | "expired"
  | "callback"
  | "email_in_use"
  | "verified"
  | "password_reset";

export type SignInAlertCopy = { tone: AlertTone; title: string; body?: string; resetLink?: string };

export const ALERT_COPY: Record<SignInAlertKind, SignInAlertCopy> = {
  invalid_credentials: { tone: "danger", title: "Correo o contraseña incorrectos." },
  too_many_attempts: {
    tone: "review",
    title: "Demasiados intentos.",
    body: "Espera unos minutos antes de volver a intentarlo o restablece tu contraseña.",
    resetLink: "Restablecer contraseña",
  },
  network: { tone: "danger", title: "No pudimos conectarnos.", body: "Revisa tu conexión e inténtalo de nuevo. Lo que escribiste sigue aquí." },
  // Existing product copy (EmployerAuthControls / CandidateAuthControls).
  social_failed: { tone: "danger", title: "No pudimos iniciar el acceso. Inténtalo de nuevo." },
  expired: { tone: "info", title: "Tu sesión venció. Vuelve a ingresar." },
  callback: { tone: "danger", title: "No pudimos completar el acceso. Inténtalo de nuevo." },
  // L5 agreed copy for a social sign-in whose email already has a password account.
  email_in_use: { tone: "info", title: "Ese correo ya tiene cuenta. Entra con tu contraseña." },
  // A4.4: after «Verifica tu correo» (Cognito's confirmation does not sign in).
  verified: { tone: "success", title: "Tu correo quedó verificado. Ingresa para continuar." },
  // A4.6: after «Recupera tu acceso» (Cognito's ConfirmForgotPassword does not sign in).
  password_reset: { tone: "success", title: "Tu contraseña se actualizó. Ingresa con tu nueva contraseña." },
};

export const MISSING_EMAIL = "Escribe tu correo.";
export const MISSING_PASSWORD = "Escribe tu contraseña.";

export const PROVIDER_LABEL = { google: "Google", microsoft: "Microsoft", linkedin: "LinkedIn" } as const;
