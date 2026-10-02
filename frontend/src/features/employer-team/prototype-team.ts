import { parseTeamMembers } from "./model";
import type { TeamMember } from "./model";

/**
 * The fictional Nexo Labs team behind this workspace: a made-up company. Every
 * member record below — identity, email, role, account status, and workload
 * counters — is fictional/local demo data authored for the prototype, never
 * fetched, persisted, or sent anywhere.
 *
 * The member-account status is prototype-local demo state: the backend has no
 * member-account-status vocabulary, so `active` and `invited` describe this
 * prototype only. Tomás Ríos is the workspace owner account already shown in
 * the sidebar; his system role is `owner` while his employment title is Talent
 * Lead. Recruiter workloads mirror the fictional Nexo Labs vacancy portfolio.
 */
const NEXO_TEAM_SOURCE: readonly TeamMember[] = [
  {
    id: "tomas-rios",
    fullName: "Tomás Ríos",
    email: "tomas.rios@nexolabs.mx",
    role: "owner",
    status: "active",
    workload: { ownedVacancies: 0, inProcessCandidates: 0 },
  },
  {
    id: "valeria-ortiz",
    fullName: "Valeria Ortiz",
    email: "valeria.ortiz@nexolabs.mx",
    role: "recruiter",
    status: "active",
    workload: { ownedVacancies: 2, inProcessCandidates: 10 },
  },
  {
    id: "mateo-rios",
    fullName: "Mateo Ríos",
    email: "mateo.rios@nexolabs.mx",
    role: "recruiter",
    status: "active",
    workload: { ownedVacancies: 2, inProcessCandidates: 11 },
  },
  {
    id: "camila-duarte",
    fullName: "Camila Duarte",
    email: "camila.duarte@nexolabs.mx",
    role: "recruiter",
    status: "active",
    workload: { ownedVacancies: 2, inProcessCandidates: 9 },
  },
  {
    id: "andrea-pena",
    fullName: "Andrea Peña",
    email: "andrea.pena@nexolabs.mx",
    role: "recruiter",
    status: "active",
    workload: { ownedVacancies: 0, inProcessCandidates: 0 },
  },
  {
    id: "lucia-navarro",
    fullName: "Lucía Navarro",
    email: "lucia.navarro@nexolabs.mx",
    role: "recruiter",
    status: "invited",
    workload: { ownedVacancies: 0, inProcessCandidates: 0 },
  },
];

/** Freezes a value and every plain object reachable from it. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

/**
 * The frozen Nexo Labs prototype team: validated by `parseTeamMembers` at this
 * module boundary, then deeply frozen so no later screen can mutate a fixture.
 * This local demo data imports only the local model; it never pulls in the
 * employer vacancy or candidate demo data.
 */
export const NEXO_TEAM_MEMBERS: readonly TeamMember[] = deepFreeze(parseTeamMembers(NEXO_TEAM_SOURCE));
