import { beforeEach, expect, it, vi } from "vitest";
import { createApiClient } from "./action-client";
import { TeamError } from "./client";
import { createFixtureClient } from "./prototype-client";
import { loadTeamAction, loadTeamHistoryAction, loadTeamMembersAction, loadTeamCalendarAction, writeTeamAction } from "./actions";
vi.mock("./actions", () => ({ loadTeamAction: vi.fn(), loadTeamHistoryAction: vi.fn(), loadTeamMembersAction: vi.fn(), loadTeamCalendarAction: vi.fn(), writeTeamAction: vi.fn() }));
const fixture = createFixtureClient("owner");
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadTeamCalendarAction).mockResolvedValue({ ok: true, data: { calendar: fixture.calendar, commitmentDate: fixture.commitmentDate ?? null } });
});
it.each(["2026-11-30", null])("exposes the delivery commitment date in api mode (%s)", async commitmentDate => {
  vi.mocked(loadTeamAction).mockResolvedValue({ ok: true, data: await fixture.getTeam(), etag: '"team"' });
  vi.mocked(loadTeamCalendarAction).mockResolvedValue({ ok: true, data: { calendar: fixture.calendar, commitmentDate } });
  const client = createApiClient("vacancy");
  await client.getTeam();
  expect(client.commitmentDate).toBe(commitmentDate);
  expect(client.calendar).toEqual(fixture.calendar);
  expect(client.snapshot).toBeUndefined();
});
it("uses actions, retains the ETag and delivery calendar, never invents a snapshot", async () => {
  const team = await fixture.getTeam(), history = await fixture.getHistory(), company = await fixture.getCompanyMembers();
  vi.mocked(loadTeamAction).mockResolvedValue({ ok: true, data: team, etag: '"opaque"' });
  vi.mocked(loadTeamHistoryAction).mockResolvedValue({ ok: true, data: history });
  vi.mocked(loadTeamMembersAction).mockResolvedValue({ ok: true, data: company });
  const client = createApiClient("vacancy");
  expect(await client.getTeam()).toEqual(team); expect(client.etag).toBe('"opaque"'); expect(client.calendar).toEqual(fixture.calendar); expect(client.snapshot).toBeUndefined();
  expect(await client.getHistory("opaque+/=")).toEqual(history); expect(loadTeamHistoryAction).toHaveBeenCalledWith("vacancy", "opaque+/=");
  expect(await client.getCompanyMembers()).toEqual(company); expect(loadTeamMembersAction).toHaveBeenCalledWith("vacancy");
});
it("freezes UUID/body/ETag on uncertainty, adopts write ETags, and starts fresh on a new confirmation", async () => {
  const team = await fixture.getTeam();
  vi.mocked(loadTeamAction).mockResolvedValue({ ok: true, data: team, etag: '\"one\"' });
  vi.mocked(writeTeamAction).mockResolvedValueOnce({ ok: false, code: "write_failed" }).mockResolvedValue({ ok: true, data: team, etag: '\"two\"' });
  const client = createApiClient("vacancy"); await client.getTeam();
  await expect(client.removeMember("user")).rejects.toBeInstanceOf(TeamError);
  const first = vi.mocked(writeTeamAction).mock.calls[0][0];
  expect(first).toMatchObject({ ifMatch: '\"one\"', write: { kind: "remove", userId: "user" } });
  expect(first.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  expect(await client.removeMember("user")).toEqual(team);
  expect(vi.mocked(writeTeamAction).mock.calls[1][0]).toEqual(first);
  expect(client.etag).toBe('\"two\"');
  client.beginAttempt?.(); await client.leave();
  const next = vi.mocked(writeTeamAction).mock.calls[2][0];
  expect(next.idempotencyKey).not.toBe(first.idempotencyKey); expect(next.ifMatch).toBe('\"two\"');
});
it("dispatches every write using the latest adopted ETag and keeps it on rejection", async () => {
  const team = await fixture.getTeam();
  vi.mocked(loadTeamAction).mockResolvedValue({ ok: true, data: team, etag: '\"base\"' });
  const client = createApiClient("vacancy"); await client.getTeam();
  const reassign = { to_user_id: "user", reason: "workload" as const, recruiter_deadline: null, previous_responsible: "remove" as const };
  const cases = [
    [() => client.addMember({ user_id: "user", recruiter_deadline: null }), { kind: "add", body: { user_id: "user", recruiter_deadline: null } }],
    [() => client.removeMember("user"), { kind: "remove", userId: "user" }],
    [() => client.leave(), { kind: "leave" }],
    [() => client.editDeadline("user", null), { kind: "deadline", userId: "user", deadline: null }],
    [() => client.reassign(reassign), { kind: "reassign", body: reassign }],
    [() => client.changeMode({ mode: "shared" }), { kind: "mode", body: { mode: "shared" } }],
  ] as const;
  for (const [index, [call, write]] of cases.entries()) {
    const previous = client.etag;
    vi.mocked(writeTeamAction).mockResolvedValueOnce({ ok: true, data: team, etag: `\"${index}\"` });
    expect(await call()).toEqual(team);
    expect(writeTeamAction).toHaveBeenLastCalledWith(expect.objectContaining({ vacancyId: "vacancy", ifMatch: previous, write }));
    expect(client.etag).toBe(`\"${index}\"`);
  }
  vi.mocked(writeTeamAction).mockResolvedValueOnce({ ok: false, code: "team_version_conflict", status: 412 });
  await expect(client.leave()).rejects.toMatchObject({ code: "team_version_conflict", status: 412 });
  expect(client.etag).toBe('\"5\"');
});
it("preserves invalid_cursor and access failures as typed errors", async () => {
  vi.mocked(loadTeamHistoryAction).mockResolvedValue({ ok: false, code: "invalid_cursor", status: 400 });
  await expect(createApiClient("vacancy").getHistory("bad")).rejects.toMatchObject({ code: "invalid_cursor", status: 400 });
  vi.mocked(loadTeamAction).mockResolvedValue({ ok: false, code: "team_access_ended", status: 404 });
  await expect(createApiClient("vacancy").getTeam()).rejects.toMatchObject({ code: "team_access_ended", status: 404 });
  expect(loadTeamCalendarAction).not.toHaveBeenCalled();
});
