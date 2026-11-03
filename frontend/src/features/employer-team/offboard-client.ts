import { z } from "zod";
import { companyMemberSchema, type CompanyMember } from "./members-model";

const vacancySchema = z.object({
  draft_id: z.string().uuid(), title: z.string(), lifecycle: z.enum(["draft", "published", "paused", "closed"]),
  team: z.array(z.object({ user_id: z.string().uuid(), name: z.string(), function: z.enum(["responsible", "collaborator", "member"]) })),
});
export const offboardPreviewSchema = z.object({ user: z.object({ id: z.string().uuid(), full_name: z.string() }), vacancies: z.array(vacancySchema), other_tramos: z.number().int().nonnegative() });
export type OffboardPreview = z.infer<typeof offboardPreviewSchema>;
export type OffboardBody = { default_to_user_id: string | null; reassignments: { draft_id: string; to_user_id: string }[] };
export type OffboardScenario = "none" | "responsible" | "collaborator";
export class OffboardError extends Error {
  constructor(public status: number, public code: string, public vacancies: OffboardPreview["vacancies"] = []) { super(code); }
}
export function offboardPrototypeEnabled() {
  return process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE === "1";
}

/** Development-only recruiters so the owner always has someone to offboard locally. Never used when the flag is off. */
export function prototypeMembers(companyId: string): CompanyMember[] {
  return [["Ana López", "ana.lopez"], ["Diego Hernández", "diego.hernandez"], ["Mariana Ruiz", "mariana.ruiz"]].map(([name, handle], i) => companyMemberSchema.parse({
    id: `50000000-0000-4000-8000-00000000000${i + 1}`, company_id: companyId, role: "recruiter", created_at: "2026-10-20T16:00:00Z", updated_at: "2026-10-20T16:00:00Z",
    user: { id: `60000000-0000-4000-8000-00000000000${i + 1}`, full_name: name, email: `${handle}@trustpeople.mx` } }));
}

/** Read-only contract-shaped previews; all writes live in this instance, never on the server.
 * Scenario is explicit so every real company member can exercise all three branches locally. */
export function createOffboardFixtureClient(initial: readonly CompanyMember[], scenario: OffboardScenario) {
  let members = structuredClone([...initial]);
  async function preview(id: string): Promise<OffboardPreview> {
    const member = members.find(member => member.id === id);
    if (!member?.user) throw new OffboardError(404, "member_not_found");
    const team = members.filter(person => person.id !== id && person.user).map(person => ({ user_id: person.user!.id, name: person.user!.full_name, function: "collaborator" as const }));
    return offboardPreviewSchema.parse({ user: { id: member.user.id, full_name: member.user.full_name }, other_tramos: scenario === "collaborator" ? 3 : 0,
      vacancies: scenario === "responsible" ? ["Analista contable", "Coordinación de operaciones"].map((title, i) => ({ draft_id: `40000000-0000-4000-8000-00000000000${i + 1}`, title, lifecycle: "published", team })) : [] });
  }
  function removeMembership(id: string) { members = members.filter(member => member.id !== id); }
  return {
    preview,
    async list() { return structuredClone(members); },
    async remove(id: string) {
      const data = await preview(id);
      if (data.vacancies.length) throw new OffboardError(409, "member_is_responsible", data.vacancies);
      removeMembership(id);
    },
    async offboard(id: string, body: OffboardBody) {
      const data = await preview(id);
      const valid = (target: string | null | undefined) => !!target && target !== data.user.id && members.some(member => member.user?.id === target);
      const unresolved = data.vacancies.filter(vacancy => !valid(body.reassignments.find(item => item.draft_id === vacancy.draft_id)?.to_user_id ?? body.default_to_user_id));
      if (unresolved.length) throw new OffboardError(422, "offboard_unresolved_vacancies", unresolved);
      removeMembership(id);
    },
  };
}
export type OffboardFixtureClient = ReturnType<typeof createOffboardFixtureClient>;
