import { isValidJobId } from "@/features/jobs/jobId";

/**
 * Employer routes a read-only stakeholder can open (stakeholder-metrics-v1 §1.2, F8): Métricas and the invitation pages, plus,
 * for vacancy documents (S11, S12), exactly two more: their own «Vacantes» list and the Documentos tab of one vacancy.
 * Every other employer route (`/empresa/vacantes`, a vacancy's pipeline or configuration, …) is gated before its page reads
 * anything; the API rejects the stakeholder anyway.
 */
export const STAKEHOLDER_HOME = "/empresa/metricas";
/** S12: the stakeholder's read-only vacancy list; the sidebar entry, the page and this gate share the path. */
export const STAKEHOLDER_VACANCIES = "/empresa/stakeholder/vacantes";
const INVITATION = "/empresa/invitacion";
const LANDINGS = new Set(["/empresa", "/empresa/dashboard"]);

const within = (pathname: string, root: string) => pathname === root || pathname.startsWith(`${root}/`);

export function isInvitationRoute(pathname: string | null | undefined): boolean {
  return !!pathname && within(pathname, INVITATION);
}

const VACANCY_DOCUMENTS = /^\/empresa\/vacantes\/([^/]+)\/documentos$/;
/** S11: `/empresa/vacantes/<uuid>/documentos` only; the id is validated, never trimmed. */
function isVacancyDocumentsRoute(pathname: string): boolean {
  const id = VACANCY_DOCUMENTS.exec(pathname)?.[1];
  return id !== undefined && isValidJobId(id);
}

export function stakeholderRoute(pathname: string | null | undefined): "allowed" | "landing" | "blocked" {
  if (!pathname) return "blocked";
  if (within(pathname, STAKEHOLDER_HOME) || isInvitationRoute(pathname) || pathname === STAKEHOLDER_VACANCIES || isVacancyDocumentsRoute(pathname)) return "allowed";
  return LANDINGS.has(pathname) ? "landing" : "blocked";
}
