/**
 * Employer routes a read-only stakeholder can open (stakeholder-metrics-v1 §1.2, F8): Métricas and the invitation pages.
 * Every other employer route is gated before its page reads anything; the API rejects the stakeholder anyway.
 */
export const STAKEHOLDER_HOME = "/empresa/metricas";
const INVITATION = "/empresa/invitacion";
const LANDINGS = new Set(["/empresa", "/empresa/dashboard"]);

const within = (pathname: string, root: string) => pathname === root || pathname.startsWith(`${root}/`);

export function isInvitationRoute(pathname: string | null | undefined): boolean {
  return !!pathname && within(pathname, INVITATION);
}

export function stakeholderRoute(pathname: string | null | undefined): "allowed" | "landing" | "blocked" {
  if (!pathname) return "blocked";
  if (within(pathname, STAKEHOLDER_HOME) || isInvitationRoute(pathname)) return "allowed";
  return LANDINGS.has(pathname) ? "landing" : "blocked";
}
