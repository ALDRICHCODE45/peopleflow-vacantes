import { preferenceCopy, preferencesHref } from "./copy";
import type { NotificationScope } from "./model";

/*
 * Wording of the email unsubscribe landing `/notificaciones/baja?token=` (contract v2 E7, Q4). Type names come from the
 * «Mis preferencias» titles in `copy.ts`, so the landing and the preferences page name an aviso the same way.
 */

export const UNSUBSCRIBE_PAGE_TITLE = "Dejar de recibir correos";

/** «Dejar de recibir por correo: {tipo}», plus « de {empresa}» when the link belongs to a company. */
export const unsubscribeHeading = (type: string, companyName: string | null) =>
  `Dejar de recibir por correo: ${preferenceCopy(type).title}${companyName ? ` de ${companyName}` : ""}`;

/** A link with a company is a member's (company preferences); without one, a candidate's. */
export const unsubscribeScope = (companyName: string | null): NotificationScope => companyName ? "company" : "candidate";

export const UNSUBSCRIBE_COPY = {
  currentlyOn: "Hoy recibes este aviso por correo.",
  scopeNote: "Solo se apaga el correo; tus avisos en la app no cambian.",
  confirm: "Dejar de recibir",
  confirming: "Guardando…",
  done: "Listo. Ya no recibirás este tipo de correo.",
  doneNote: "Puedes volver a activarlo cuando quieras.",
  alreadyOff: "Ya no recibes este tipo de correo.",
  alreadyOffNote: "No hay nada más que hacer con este enlace.",
  adjust: "Ajustar mis preferencias",
  invalid: "Este enlace ya no es válido.",
  invalidNote: "Elige qué correos recibes desde tus preferencias.",
  companyPreferences: "Preferencias de empresa",
  candidatePreferences: "Preferencias de candidato",
  rateLimited: "Demasiados intentos. Inténtalo en unos minutos.",
  rateLimitedNote: "No se cambió nada.",
  loadError: "No pudimos abrir este enlace.",
  retryNote: "No se cambió nada. Inténtalo de nuevo.",
  retry: "Reintentar",
} as const;

export const unsubscribePreferencesLinks = () => [
  { label: UNSUBSCRIBE_COPY.companyPreferences, href: preferencesHref("company") },
  { label: UNSUBSCRIBE_COPY.candidatePreferences, href: preferencesHref("candidate") },
] as const;
