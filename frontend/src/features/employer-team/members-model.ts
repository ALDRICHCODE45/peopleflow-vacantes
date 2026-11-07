import { z } from "zod";
import type { DraftListRow } from "@/features/jobs/drafts/list/client";
import { COMPANY_MEMBER_ROLES, TEAM_MEMBER_ROLES, type TeamMemberRole, type TeamMemberWorkload } from "./model";

export const memberIdSchema = z.string().uuid();
/** Writable roles only: PATCH never names `stakeholder` (422 stakeholder_role_change_not_supported). */
export const memberRoleSchema = z.enum(TEAM_MEMBER_ROLES);
const timestamp = z.string().datetime({ offset: true });
export const companyMemberSchema = z.object({
  id: memberIdSchema,
  company_id: memberIdSchema,
  role: z.enum(COMPANY_MEMBER_ROLES),
  created_at: timestamp,
  updated_at: timestamp,
  user: z.object({ id: memberIdSchema, full_name: z.string(), email: z.string().email() }).strict().nullable(),
}).strict();
export const membersSchema = z.object({ members: z.array(companyMemberSchema) }).strict();
export type CompanyMember = z.infer<typeof companyMemberSchema>;
export const memberName = (member: CompanyMember) => member.user?.full_name || "Usuario dado de baja";

/** Membership ids belong to company_members; team responsible ids belong to users. */
export function memberWorkload(member: CompanyMember, drafts: readonly DraftListRow[]): TeamMemberWorkload | null {
  if (!member.user) return null;
  // Shared-team summaries do not identify their members, so they cannot count toward a member's workload.
  const active = drafts.filter(draft => draft.team.responsible?.id === member.user!.id &&
    (draft.status === "published" || draft.status === "paused") && draft.process !== "finished");
  return { ownedVacancies: active.length, inProcessCandidates: active.reduce((sum, draft) => sum + (draft.candidates?.in_process ?? 0), 0) };
}
export type MemberRowAction = { kind: "role"; role: TeamMemberRole; label: string } | { kind: "remove"; label: string };
/** Presentation safeguards only: backend authorization remains authoritative. */
export function memberRowActions(member: CompanyMember, members: readonly CompanyMember[], role: TeamMemberRole | null, userId: string | null): MemberRowAction[] {
  if (role !== "owner" || !userId || member.user?.id === userId ||
    (member.role === "owner" && members.filter(item => item.role === "owner").length <= 1)) return [];
  // A stakeholder is removed and re-invited, never converted (D5).
  if (member.role === "stakeholder") return [{ kind: "remove", label: "Quitar" }];
  return [{ kind: "role", role: member.role === "owner" ? "recruiter" : "owner", label: member.role === "owner" ? "Hacer reclutador" : "Hacer dueño" }, { kind: "remove", label: "Quitar" }];
}
/** Stakeholders never join a vacancy team; team writes naming one answer 422 not_company_member (§1.1, L6). */
export function assignableMembers<T extends { role: string }>(members: readonly T[]): T[] {
  return members.filter(member => member.role !== "stakeholder");
}
