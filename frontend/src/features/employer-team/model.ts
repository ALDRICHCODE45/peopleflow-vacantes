/**
 * Employer-team vocabulary for `/empresa/equipo`: the backend member roles,
 * their Spanish labels and the shape of a member's recruiting workload.
 */

/** Shared backend role vocabulary. Multiple owners are supported by the real member list. */
export const TEAM_MEMBER_ROLES = ["owner", "recruiter"] as const;
export type TeamMemberRole = (typeof TEAM_MEMBER_ROLES)[number];

/** Spanish display labels for the member roles. */
export const TEAM_MEMBER_ROLE_LABELS: Readonly<Record<TeamMemberRole, string>> = Object.freeze({
  owner: "Dueño",
  recruiter: "Reclutador",
});

/** Recruiting workload of one member, derived from the company's vacancy list. */
export type TeamMemberWorkload = { readonly ownedVacancies: number; readonly inProcessCandidates: number };
