import { beforeEach, expect, it, vi } from "vitest";
import { createApiClient } from "./action-client";
import { TeamError } from "./client";
import { createFixtureClient } from "./prototype-client";
import { loadTeamAction, loadTeamHistoryAction, loadTeamMembersAction, loadTeamCalendarAction } from "./actions";
vi.mock("./actions", () => ({ loadTeamAction: vi.fn(), loadTeamHistoryAction: vi.fn(), loadTeamMembersAction: vi.fn(), loadTeamCalendarAction: vi.fn() }));
const fixture = createFixtureClient("owner");
beforeEach(() => vi.clearAllMocks());
it("uses actions, retains the ETag and delivery calendar, never invents a snapshot", async () => {
  const team = await fixture.getTeam(), history = await fixture.getHistory(), company = await fixture.getCompanyMembers();
  vi.mocked(loadTeamAction).mockResolvedValue({ ok: true, data: team, etag: '"opaque"' });
  vi.mocked(loadTeamCalendarAction).mockResolvedValue({ ok: true, data: fixture.calendar });
  vi.mocked(loadTeamHistoryAction).mockResolvedValue({ ok: true, data: history });
  vi.mocked(loadTeamMembersAction).mockResolvedValue({ ok: true, data: company });
  const client = createApiClient("vacancy");
  expect(await client.getTeam()).toEqual(team); expect(client.etag).toBe('"opaque"'); expect(client.calendar).toEqual(fixture.calendar); expect(client.snapshot).toBeUndefined();
  expect(await client.getHistory("opaque+/=")).toEqual(history); expect(loadTeamHistoryAction).toHaveBeenCalledWith("vacancy", "opaque+/=");
  expect(await client.getCompanyMembers()).toEqual(company); expect(loadTeamMembersAction).toHaveBeenCalledWith("vacancy");
});
it("every write rejects with typed not_available_yet without invoking actions", async () => {
  const client = createApiClient("vacancy");
  const writes = [() => client.addMember({ user_id: "user", recruiter_deadline: null }), () => client.removeMember("user"), () => client.leave(), () => client.editDeadline("user", null), () => client.reassign({ to_user_id: "user", reason: "workload", recruiter_deadline: null, previous_responsible: "remove" }), () => client.changeMode({ mode: "shared" })];
  for (const write of writes) { await expect(write()).rejects.toBeInstanceOf(TeamError); await expect(write()).rejects.toMatchObject({ code: "not_available_yet" }); }
  for (const action of [loadTeamAction, loadTeamHistoryAction, loadTeamMembersAction, loadTeamCalendarAction]) expect(action).not.toHaveBeenCalled();
});
it("preserves invalid_cursor and access failures as typed errors", async () => {
  vi.mocked(loadTeamHistoryAction).mockResolvedValue({ ok: false, code: "invalid_cursor", status: 400 });
  await expect(createApiClient("vacancy").getHistory("bad")).rejects.toMatchObject({ code: "invalid_cursor", status: 400 });
  vi.mocked(loadTeamAction).mockResolvedValue({ ok: false, code: "team_access_ended", status: 404 });
  await expect(createApiClient("vacancy").getTeam()).rejects.toMatchObject({ code: "team_access_ended", status: 404 });
  expect(loadTeamCalendarAction).not.toHaveBeenCalled();
});
