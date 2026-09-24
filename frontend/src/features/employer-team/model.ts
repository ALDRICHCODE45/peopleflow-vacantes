import { z } from "zod";

/**
 * Prototype employer-team model for `/empresa/equipo`. It owns a closed local
 * role vocabulary plus a prototype-local member-account-status vocabulary, and
 * imports only zod: no transport, React, browser API, or persistence is
 * reachable from here, and nothing is fetched, stored, or sent anywhere.
 */

/** Roles a Nexo Labs team member can hold; `owner` is the single workspace account. */
export const TEAM_MEMBER_ROLES = ["owner", "recruiter"] as const;
export type TeamMemberRole = (typeof TEAM_MEMBER_ROLES)[number];

/**
 * Prototype-local member account status. The backend member model declares
 * no member-account-status vocabulary, so this set is authored demo state for
 * the prototype only; it is prototype-local demo state, not a wire contract,
 * and must never be treated as one.
 */
export const TEAM_MEMBER_STATUSES = ["active", "invited"] as const;
export type TeamMemberStatus = (typeof TEAM_MEMBER_STATUSES)[number];

/** Spanish display labels for the local member roles. */
export const TEAM_MEMBER_ROLE_LABELS: Readonly<Record<TeamMemberRole, string>> = Object.freeze({
  owner: "Propietario",
  recruiter: "Reclutador",
});

/** Spanish display labels for the prototype-local member statuses. */
export const TEAM_MEMBER_STATUS_LABELS: Readonly<Record<TeamMemberStatus, string>> = Object.freeze({
  active: "Cuenta activa",
  invited: "Invitación pendiente",
});

/** URL-safe slug shape a stable member id relies on. */
const memberIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const workloadCountSchema = z.number().int().nonnegative();

/**
 * Rejects surrounding whitespace instead of silently trimming it, so a padded
 * name or email is a fixture bug rather than quietly normalized data.
 */
function withoutSurroundingWhitespace(schema: z.ZodString): z.ZodEffects<z.ZodString, string, string> {
  return schema.refine((value) => value === value.trim(), "must not have surrounding whitespace");
}

const memberNameSchema = withoutSurroundingWhitespace(z.string().min(1).max(120));
const memberEmailSchema = withoutSurroundingWhitespace(z.string().max(160).email());

/** Recruiting workload of one member; both counters are non-negative integers. */
const workloadSchema = z
  .object({
    ownedVacancies: workloadCountSchema,
    inProcessCandidates: workloadCountSchema,
  })
  .strict();
export type TeamMemberWorkload = z.infer<typeof workloadSchema>;

/**
 * Validates one prototype member. Strict on purpose: an unknown role or status,
 * a negative or fractional count, a malformed id or email, a blank name, or an
 * extra key is a fixture bug that must fail at the module boundary.
 */
export const teamMemberSchema = z
  .object({
    id: memberIdSchema,
    fullName: memberNameSchema,
    email: memberEmailSchema,
    role: z.enum(TEAM_MEMBER_ROLES),
    status: z.enum(TEAM_MEMBER_STATUSES),
    workload: workloadSchema,
  })
  .strict();

/** One display-ready prototype member of the fictional Nexo Labs team. */
export type TeamMember = z.infer<typeof teamMemberSchema>;

/**
 * Validates the whole prototype team in one boundary call and enforces the
 * collection identity invariants of this frozen fixture: unique member ids,
 * case-insensitive unique emails, and exactly one owner. Owner cardinality is
 * a local fixture invariant for this prototype workspace, not a backend or
 * wire-level claim, and must never be treated as one.
 */
export const teamMembersSchema = z.array(teamMemberSchema).superRefine((members, context) => {
  const ids = new Set<string>();
  const emails = new Set<string>();
  let owners = 0;
  for (const [index, member] of members.entries()) {
    if (ids.has(member.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [index, "id"], message: `duplicate member id: ${member.id}` });
    }
    ids.add(member.id);
    const normalizedEmail = member.email.toLowerCase();
    if (emails.has(normalizedEmail)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [index, "email"], message: `duplicate member email: ${member.email}` });
    }
    emails.add(normalizedEmail);
    if (member.role === "owner") owners += 1;
  }
  if (owners !== 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: [], message: `expected exactly one owner, found ${owners}` });
  }
});

/** Parses untrusted fixture data into validated prototype team members. */
export function parseTeamMembers(input: unknown): readonly TeamMember[] {
  return teamMembersSchema.parse(input);
}

/** Exact team counters the team list renders. */
export type TeamSummary = {
  readonly total: number;
  readonly owners: number;
  readonly recruiters: number;
  readonly active: number;
  readonly invited: number;
};

/** Derives the frozen team summary from a member list without mutating it. */
export function summarizeTeam(members: readonly TeamMember[]): TeamSummary {
  const countWithRole = (role: TeamMemberRole): number => members.filter((member) => member.role === role).length;
  const countWithStatus = (status: TeamMemberStatus): number => members.filter((member) => member.status === status).length;
  return Object.freeze({
    total: members.length,
    owners: countWithRole("owner"),
    recruiters: countWithRole("recruiter"),
    active: countWithStatus("active"),
    invited: countWithStatus("invited"),
  });
}
