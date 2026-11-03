import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("./api-client", () => ({ getTeam: vi.fn(), getHistory: vi.fn(), getCompanyMembers: vi.fn(), getCalendar: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { getTeam, getHistory, getCompanyMembers, getCalendar } from "./api-client";
import { loadTeamAction, loadTeamHistoryAction, loadTeamMembersAction, loadTeamCalendarAction } from "./actions";
beforeEach(() => vi.resetAllMocks());
const cases = [
  { action: () => loadTeamAction("id"), client: getTeam, input: { vacancyId: "id" } },
  { action: () => loadTeamHistoryAction("id", "opaque"), client: getHistory, input: { vacancyId: "id", cursor: "opaque" } },
  { action: () => loadTeamMembersAction("id"), client: getCompanyMembers, input: { vacancyId: "id" } },
  { action: () => loadTeamCalendarAction("id"), client: getCalendar, input: { vacancyId: "id" } },
];
it.each(cases)("authenticates server-side before reading $input", async ({ action, client, input }) => {
  vi.mocked(getActionAccessToken).mockResolvedValue("server-token");
  vi.mocked(client).mockResolvedValue({ ok: false, code: "team_access_ended", status: 404 });
  expect(await action()).toEqual({ ok: false, code: "team_access_ended", status: 404 });
  expect(client).toHaveBeenCalledWith({ ...input, token: "server-token" });
});
it.each(cases)("rejects expired sessions without calling the client $input", async ({ action, client }) => {
  vi.mocked(getActionAccessToken).mockResolvedValue(null);
  expect(await action()).toEqual({ ok: false, code: "unauthenticated", status: 401 }); expect(client).not.toHaveBeenCalled();
});
it("does not leak thrown errors", async () => {
  vi.mocked(getActionAccessToken).mockRejectedValue(new Error("private error"));
  expect(await loadTeamAction("id")).toEqual({ ok: false, code: "read_failed" });
});
