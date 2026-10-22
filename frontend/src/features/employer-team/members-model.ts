import { z } from "zod";
import type { DraftListRow } from "@/features/jobs/drafts/list/client";
import { TEAM_MEMBER_ROLES, type TeamMemberRole, type TeamMemberWorkload } from "./model";

export const memberIdSchema = z.string().uuid();
export const memberRoleSchema = z.enum(TEAM_MEMBER_ROLES);
const timestamp = z.string().datetime({ offset: true });
export const companyMemberSchema = z.object({
  id: memberIdSchema,
  company_id: memberIdSchema,
  role: memberRoleSchema,
  created_at: timestamp,
  updated_at: timestamp,
  user: z.object({ id: memberIdSchema, full_name: z.string(), email: z.string().email() }).strict().nullable(),
}).strict();
export const membersSchema = z.object({ members: z.array(companyMemberSchema) }).strict();
export type CompanyMember = z.infer<typeof companyMemberSchema>;
export const memberName = (member: CompanyMember) => member.user?.full_name || "Usuario dado de baja";

/** Membership ids belong to company_members; draft principals belong to users. */
export function memberWorkload(member: CompanyMember, drafts: readonly DraftListRow[]): TeamMemberWorkload | null {
  if (!member.user) return null;
  const active = drafts.filter(draft => draft.principal_recruiter.id === member.user!.id &&
    (draft.status === "published" || draft.status === "paused") && draft.process !== "finished");
  return { ownedVacancies: active.length, inProcessCandidates: active.reduce((sum, draft) => sum + (draft.candidates?.in_process ?? 0), 0) };
}
export type MemberRowAction = { kind: "role"; role: TeamMemberRole; label: string } | { kind: "remove"; label: string };
/** Presentation safeguards only: backend authorization remains authoritative. */
export function memberRowActions(member: CompanyMember, members: readonly CompanyMember[], role: TeamMemberRole | null, userId: string | null): MemberRowAction[] {
  if (role !== "owner" || !userId || member.user?.id === userId ||
    (member.role === "owner" && members.filter(item => item.role === "owner").length <= 1)) return [];
  return [{ kind: "role", role: member.role === "owner" ? "recruiter" : "owner", label: member.role === "owner" ? "Cambiar a Reclutador" : "Cambiar a Dueño" }, { kind: "remove", label: "Quitar del equipo" }];
}
