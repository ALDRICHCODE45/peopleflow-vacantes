import { describe, expect, it } from "vitest";
import { companyMembersSchema, historySchema, reassignSchema, teamSchema, availableMembers, memberActions, prototypeEnabled } from "./model";
import { createFixtureClient } from "./prototype-client";

describe("contract boundaries", () => {
  it("requires explicit development opt-in", () => {
    expect(prototypeEnabled("development", "1")).toBe(true);
    for (const environment of ["production", "test", undefined]) expect(prototypeEnabled(environment, "1")).toBe(false);
    expect(prototypeEnabled("development", undefined)).toBe(false);
  });
  it("validates the team and subtracts user ids, not membership ids", async () => {
    const client = createFixtureClient("owner");
    const team = teamSchema.parse(await client.getTeam());
    const company = companyMembersSchema.parse(await client.getCompanyMembers());
    expect(availableMembers(team, company).map(member => member.user.full_name)).toEqual(["Sofía Ramírez", "Luis Pérez"]);
    expect(teamSchema.safeParse({ ...team, viewer: { can: {} } }).success).toBe(false);
  });
  it("requires a reason and a trimmed note for Otro, counts Unicode characters", () => {
    const body = { to_user_id: "user-luis", reason: "other", recruiter_deadline: null };
    expect(reassignSchema.safeParse(body).success).toBe(false);
    expect(reassignSchema.safeParse({ ...body, note: "  " }).success).toBe(false);
    expect(reassignSchema.parse({ ...body, note: "  Cambio de cuenta  " })).toMatchObject({ note: "Cambio de cuenta", previous_responsible: "remove" });
    expect(reassignSchema.safeParse({ ...body, note: "😀".repeat(500) }).success).toBe(true);
    expect(reassignSchema.safeParse({ ...body, note: "😀".repeat(501) }).success).toBe(false);
    expect(reassignSchema.safeParse({ ...body, reason: "unknown" }).success).toBe(false);
  });
  it("member actions depend on can, not owner or viewer function", async () => {
    const team = await createFixtureClient("collaborator").getTeam();
    expect(memberActions(team.viewer.can)).toEqual([]);
    team.viewer.can.edit_deadline = true;
    expect(memberActions(team.viewer.can)).toEqual(["deadline"]);
  });
});

describe("fixture public interface", () => {
  it.each(["owner", "collaborator", "shared", "long-history", "empty-history"] as const)("validates fixture %s", async fixture => {
    const client = createFixtureClient(fixture);
    expect(teamSchema.safeParse(await client.getTeam()).success).toBe(true);
    const history = await client.getHistory();
    expect(history.items.length === 0).toBe(fixture === "empty-history");
  });
  it("rejects invalid or forbidden writes without changing the team or history", async () => {
    for (const fixture of ["owner", "collaborator"] as const) {
      const client = createFixtureClient(fixture);
      const before = { team: await client.getTeam(), history: await client.getHistory() };
      await expect(client.reassign({ to_user_id: "user-luis", reason: "other", note: "", recruiter_deadline: null, previous_responsible: "remove" })).rejects.toThrow();
      expect({ team: await client.getTeam(), history: await client.getHistory() }).toEqual(before);
    }
  });
  it.each(["remove", "keep_as_collaborator"] as const)("reassigns atomically with %s and preserves continuous stays", async previous_responsible => {
    const client = createFixtureClient("owner");
    const before = await client.getTeam();
    const next = await client.reassign({ to_user_id: "user-diego", reason: "other", note: "Cambio de cuenta", recruiter_deadline: null, previous_responsible });
    expect(next.members.find(member => member.user.id === "user-diego")).toMatchObject({ assignment_id: before.members[1].assignment_id, function: "responsible", started_at: before.members[1].started_at });
    expect(next.members.find(member => member.user.id === "user-ana")?.function).toBe(previous_responsible === "remove" ? undefined : "collaborator");
    const history = await client.getHistory();
    expect(history.items[0]).toMatchObject({ kind: "reassignment", reassignment: { reason: "other", note: "Cambio de cuenta", previous_responsible, state_snapshot: { delivery: { delivered: 3, target: 5 } } } });
    const tramos = history.items.filter(item => item.kind === "tramo");
    expect(tramos.find(item => item.kind === "tramo" && item.tramo.user.id === "user-diego")).toMatchObject({ tramo: { functions: [{ function: "collaborator", end_cause: "reassignment" }, { function: "responsible", ended_at: null }] } });
  });
  it("adds, edits a deadline, removes and changes modes through the same state", async () => {
    const client = createFixtureClient("owner");
    expect((await client.addMember({ user_id: "user-luis", recruiter_deadline: null })).members).toHaveLength(3);
    expect((await client.editDeadline("user-luis", "2026-11-25")).members.find(member => member.user.id === "user-luis")).toMatchObject({ effective_deadline: "2026-11-25", deadline_source: "recruiter" });
    expect((await client.editDeadline("user-luis", null)).members.find(member => member.user.id === "user-luis")).toMatchObject({ effective_deadline: "2026-11-30", deadline_source: "commitment" });
    expect((await client.removeMember("user-luis")).members).toHaveLength(2);
    expect((await client.changeMode({ mode: "shared" })).members.every(member => member.function === "member")).toBe(true);
    expect((await client.changeMode({ mode: "with_responsible", responsible_user_id: "user-diego" })).members[1].function).toBe("responsible");
  });
  it("allows a collaborator to leave and does not leak mutable fixture references", async () => {
    const client = createFixtureClient("collaborator");
    const read = await client.getTeam(); read.members.length = 0;
    expect((await client.getTeam()).members).toHaveLength(2);
    expect((await client.leave()).members).toHaveLength(1);
    expect((await client.getHistory()).items.some(item => item.kind === "tramo" && item.tramo.end_cause === "left")).toBe(true);
  });
});
it("accepts the backend's offset timestamps with microseconds (real :8081 payload)", () => {
  const at = "2026-10-15T00:07:43.276165+00:00";
  const parsed = historySchema.safeParse({ items: [{ kind: "tramo", at, tramo: { assignment_id: "b31f5b77-ddc7-40dd-9c88-6020862d7b73", user: { id: "01a1378d-e6e5-7e87-bed6-4f918608b12c", name: "Test User" },
    started_at: at, started_by: null, start_cause: "backfill", ended_at: null, ended_by: null, end_cause: null, recruiter_deadline: null, closing_deadline: null,
    functions: [{ function: "responsible", started_at: at, ended_at: null, start_cause: "backfill", end_cause: null }] } }], next_cursor: null });
  expect(parsed.success).toBe(true);
});
