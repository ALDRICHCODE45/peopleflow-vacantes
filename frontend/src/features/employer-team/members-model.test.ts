import { expect, it } from "vitest";
import { membersSchema, memberWorkload, memberRowActions } from "./members-model";
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
  const rows = [draft("a"), draft("b", { status: "paused" }), draft("c", { status: "draft", candidates: null }), draft("d", { status: "closed" }), draft("e", { process: "finished" }), draft("f", { principal_recruiter: { id: members[1].id, name: "José Real" } })];
  expect(memberWorkload(members[1], rows)).toEqual({ ownedVacancies: 2, inProcessCandidates: 6 });
  expect(memberWorkload(members[0], rows)).toEqual({ ownedVacancies: 0, inProcessCandidates: 0 });
  expect(memberWorkload({ ...members[1], user: null }, rows)).toBeNull();
});
it("protects own row, recruiter access, unknown identity and the only owner", () => {
  expect(memberRowActions(members[0], members, "owner", selfId)).toEqual([]);
  expect(memberRowActions(members[0], members, "owner", members[1].user.id)).toEqual([]);
  expect(memberRowActions(members[1], members, "recruiter", selfId)).toEqual([]);
  expect(memberRowActions(members[1], members, "owner", null)).toEqual([]);
  expect(memberRowActions(members[1], members, "owner", selfId)).toEqual([{ kind: "role", role: "owner", label: "Cambiar a Dueño" }, { kind: "remove", label: "Quitar del equipo" }]);
  const owners = members.map(member => ({ ...member, role: "owner" as const }));
  expect(memberRowActions(owners[1], owners, "owner", selfId)[0]).toEqual({ kind: "role", role: "recruiter", label: "Cambiar a Reclutador" });
});
