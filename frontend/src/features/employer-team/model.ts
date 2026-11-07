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

/**
 * Every membership role GET /me/company/members can return (stakeholder-metrics-v1 §1.1, F1). `stakeholder` is
 * read-only: it is listed and removable, but never a target of a role change (D5) or of any vacancy hand-over.
 */
export const COMPANY_MEMBER_ROLES = [...TEAM_MEMBER_ROLES, "stakeholder"] as const;
export type CompanyMemberRole = (typeof COMPANY_MEMBER_ROLES)[number];
export const COMPANY_MEMBER_ROLE_LABELS: Readonly<Record<CompanyMemberRole, string>> = Object.freeze({
  ...TEAM_MEMBER_ROLE_LABELS,
  stakeholder: "Stakeholder",
});

/** Recruiting workload of one member, derived from the company's vacancy list. */
export type TeamMemberWorkload = { readonly ownedVacancies: number; readonly inProcessCandidates: number };
