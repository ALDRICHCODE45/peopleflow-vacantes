import type { AlertTone } from "../sign-in/copy";

/** Artboard 01 · «Tu empresa» (design/embedded-auth/_src/ui.js `company`, FLOWS.upE). */
export const COMPANY_STEP_COPY = {
  eyebrow: "Registro de empresa · Paso 3 de 3",
  heading: "Tu empresa",
  // Artboard's second sentence («Podrás cambiarlo en Configuración.») dropped: Configuración edits only the location today.
  subheading: "Así te verán los candidatos.",
  nameLabel: "Nombre comercial",
  nameHint: "El nombre que verán los candidatos.",
  rfcLabel: "RFC",
  // Invented (A4.5): POST /companies requires the RFC (exactly 12 characters); the artboard had «Razón social» (no API field).
  rfcHint: "El de tu empresa, como aparece en tu constancia fiscal (12 caracteres).",
  // Invented (A4.5): POST /companies requires the industry; the artboard had none.
  industryLabel: "Industria",
  industryPlaceholder: "Selecciona una industria",
  websiteLabel: "Sitio web",
  optional: "(opcional)",
  websitePrefix: "https://",
  websitePlaceholder: "tuempresa.com",
  // Fallback only when the session carries no usable name (the artboard never asks it here).
  fullNameLabel: "Nombre completo",
  // Requested line (A4.5); the artboard's «Mientras, ya puedes preparar tus vacantes.» is left out: no gate exists yet.
  verificationNote: "Podrás publicar vacantes cuando verifiquemos tu empresa.",
  submit: "Crear empresa",
  // Invented (A4.5): pending label.
  pending: "Creando empresa…",
  signedInAs: "Ingresaste como",
  signOut: "Salir",
  // Invented (A4.5): status while the session and the step load.
  loading: "Cargando…",
  retry: "Reintentar",
} as const;

export const COMPANY_FIELD_ERRORS = {
  nameMissing: "Escribe el nombre de tu empresa.",
  // Existing product copy (features/employer-company/company-section.tsx).
  industryUnavailable: "Esta industria ya no está disponible. Selecciona otra.",
} as const;

export type CompanyStepAlertKind = "candidate_account" | "email_in_use" | "email_not_verified" | "forbidden" | "invalid" | "network";

export const COMPANY_STEP_ALERTS: Record<CompanyStepAlertKind, { tone: AlertTone; title: string; body?: string }> = {
  // Invented (A4.5), from the RoleBlocked wording: one account, one role.
  candidate_account: { tone: "danger", title: "Esta cuenta es de candidato.", body: "Una cuenta tiene un solo rol. Para registrar tu empresa, sal y crea una cuenta con otro correo." },
  // L5 copy for an email that already has an account; body invented.
  email_in_use: { tone: "danger", title: "Ese correo ya tiene cuenta. Entra con tu contraseña.", body: "Sal e ingresa con ese correo y su contraseña." },
  // Invented (A4.5).
  email_not_verified: { tone: "review", title: "Tu correo aún no está verificado.", body: "Sal y vuelve a ingresar para verificarlo con un código." },
  // Invented (A4.5): POST /companies 403 after the employer account (should not happen).
  forbidden: { tone: "danger", title: "Esta cuenta no puede crear una empresa.", body: "Sal e ingresa con tu cuenta de empresa." },
  // Invented (A4.5): a server rejection with no field to mark (the API message is never shown).
  invalid: { tone: "danger", title: "Revisa los datos de tu empresa.", body: "No pudimos crearla con esos datos." },
  network: { tone: "danger", title: "No pudimos conectarnos.", body: "Revisa tu conexión e inténtalo de nuevo. Lo que escribiste sigue aquí." },
};
