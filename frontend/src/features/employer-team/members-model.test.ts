import { expect, it } from "vitest";
import { assignableMembers, memberRoleSchema, membersSchema, memberWorkload, memberRowActions } from "./members-model";
import { members, selfId, draft } from "./test-fixtures";

it("strictly accepts real members, multiple owners and deleted users", () => {
  expect(membersSchema.parse({ members: [...members, { ...members[1], id: "20000000-0000-4000-8000-000000000003", role: "owner", user: null }] }).members).toHaveLength(3);
  expect(membersSchema.parse({ members: [] }).members).toEqual([]);
});
it.each([
  { ...members[0], role: "admin" }, { ...members[0], status: "active" },
  { ...members[0], created_at: "bad" }, { ...members[0], user: { ...members[0].user, email: "bad" } },
  { ...members[0], user: { ...members[0].user, extra: true } },
])("rejects malformed or additive wire members", member => {
  expect(membersSchema.safeParse({ members: [member] }).success).toBe(false);
});
it("matches workload by user id, only published/paused and unfinished", () => {
  const rows = [draft("a"), draft("b", { status: "paused" }), draft("c", { status: "draft", candidates: null }), draft("d", { status: "closed" }), draft("e", { process: "finished" }), draft("f", { team: { mode: "with_responsible", responsible: { id: members[1].id, name: "José Real" }, members_count: 1, viewer_function: null } }), draft("g", { team: { mode: "shared", responsible: null, members_count: 2, viewer_function: "member" } })];
  expect(memberWorkload(members[1], rows)).toEqual({ ownedVacancies: 2, inProcessCandidates: 6 });
  expect(memberWorkload(members[0], rows)).toEqual({ ownedVacancies: 0, inProcessCandidates: 0 });
  expect(memberWorkload({ ...members[1], user: null }, rows)).toBeNull();
});
it("protects own row, recruiter access, unknown identity and the only owner", () => {
  expect(memberRowActions(members[0], members, "owner", selfId)).toEqual([]);
  expect(memberRowActions(members[0], members, "owner", members[1].user.id)).toEqual([]);
  expect(memberRowActions(members[1], members, "recruiter", selfId)).toEqual([]);
  expect(memberRowActions(members[1], members, "owner", null)).toEqual([]);
  expect(memberRowActions(members[1], members, "owner", selfId)).toEqual([{ kind: "role", role: "owner", label: "Hacer dueño" }, { kind: "remove", label: "Quitar" }]);
  const owners = members.map(member => ({ ...member, role: "owner" as const }));
  expect(memberRowActions(owners[1], owners, "owner", selfId)[0]).toEqual({ kind: "role", role: "recruiter", label: "Hacer reclutador" });
});
const stakeholder = { ...members[1], id: "20000000-0000-4000-8000-000000000005", role: "stakeholder" as const, user: { id: "10000000-0000-4000-8000-000000000005", full_name: "Jorge Treviño", email: "jorge@example.test" } };
it("accepts stakeholder members from GET /me/company/members (F1)", () => {
  expect(membersSchema.parse({ members: [...members, stakeholder] }).members[2]).toEqual(stakeholder);
});
it("offers only «Quitar» on a stakeholder row, to the owner only: no role change (D5)", () => {
  const all = [...members, stakeholder];
  expect(memberRowActions(stakeholder, all, "owner", selfId)).toEqual([{ kind: "remove", label: "Quitar" }]);
  expect(memberRowActions(stakeholder, all, "recruiter", selfId)).toEqual([]);
  expect(memberRowActions(stakeholder, all, "owner", null)).toEqual([]);
  expect(memberRowActions(members[1], all, "owner", selfId)).toEqual([{ kind: "role", role: "owner", label: "Hacer dueño" }, { kind: "remove", label: "Quitar" }]);
});
it("never writes the stakeholder role through the role-change schema", () => {
  expect(memberRoleSchema.safeParse("stakeholder").success).toBe(false);
  expect(memberRoleSchema.safeParse("recruiter").success).toBe(true);
});
it("filters stakeholders out of every person a vacancy can be handed to", () => {
  expect(assignableMembers([...members, stakeholder]).map(member => member.id)).toEqual(members.map(member => member.id));
});
