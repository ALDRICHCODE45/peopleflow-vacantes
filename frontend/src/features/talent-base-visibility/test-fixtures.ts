import type { CompanyMember } from "@/features/employer-team/members-model";
import type { TalentBaseVisibility } from "./model";

export const ownerId = "10000000-0000-4000-8000-000000000001";
export const anaId = "10000000-0000-4000-8000-000000000002";
export const luisId = "10000000-0000-4000-8000-000000000003";
export const martaId = "10000000-0000-4000-8000-000000000004";
const companyId = "30000000-0000-4000-8000-000000000001";

function member(n: number, role: "owner" | "recruiter", user: { id: string; full_name: string; email: string } | null): CompanyMember {
  return { id: `20000000-0000-4000-8000-00000000000${n}`, company_id: companyId, role, created_at: "2026-01-02T12:00:00Z", updated_at: "2026-01-02T12:00:00Z", user };
}
/** Owner, three recruiters and one offboarded membership (no user) as GET /me/company/members returns them. */
export const companyMembers: CompanyMember[] = [
  member(1, "owner", { id: ownerId, full_name: "Olga Dueña", email: "olga@empresa.mx" }),
  member(2, "recruiter", { id: anaId, full_name: "Ana Pérez", email: "ana@empresa.mx" }),
  member(3, "recruiter", { id: luisId, full_name: "Luis Soto", email: "luis@empresa.mx" }),
  member(4, "recruiter", { id: martaId, full_name: "Marta Ruiz", email: "marta@empresa.mx" }),
  member(5, "recruiter", null),
];

export function visibility(overrides: Partial<TalentBaseVisibility> = {}): TalentBaseVisibility {
  return { mode: "all_recruiters", viewers: [], version: 1, updated_at: "2026-11-04T18:00:00Z", updated_by: null, ...overrides };
}
export const selectedByAna = visibility({
  mode: "selected_users", version: 3, updated_by: { user_id: ownerId, full_name: "Olga Dueña" },
  viewers: [{ user_id: anaId, full_name: "Ana Pérez", email: "ana@empresa.mx", role: "recruiter", added_at: "2026-11-04T18:00:00Z" }],
});
