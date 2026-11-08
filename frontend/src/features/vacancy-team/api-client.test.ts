import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8081", apiTimeoutMs: 1000 } }));
import { getTeam, getHistory, getCompanyMembers, getCalendar } from "./api-client";
import { createFixtureClient } from "./prototype-client";
const input = { token: " token ", vacancyId: "10000000-0000-4000-8000-000000000001" };
const fixture = createFixtureClient("long-history");
afterEach(() => vi.unstubAllGlobals());
function reply(body: unknown, status = 200, etag = '"team-1"') {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { etag } }));
  vi.stubGlobal("fetch", fetch); return fetch;
}
it.each(["2026-11-30", null])("reads calendar and commitment date together from delivery (%s)", async commitmentDate => {
  const calendar = createFixtureClient("owner").calendar;
  const fetch = reply({ version: "1", fulfilled: false, cutoffStageId: null, targetQuantity: null, commitmentDate, limits: { maxTargetQuantity: 100 }, calendar });
  expect(await getCalendar(input)).toEqual({ ok: true, data: { calendar, commitmentDate } });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe(`http://localhost:8081/v2/me/company/job-drafts/${input.vacancyId}/pipeline/delivery`);
});
it("reads the team with its opaque strong ETag and unchanged viewer capabilities", async () => {
  const team = await fixture.getTeam(); const fetch = reply(team);
  expect(await getTeam(input)).toEqual({ ok: true, data: team, etag: '"team-1"' });
  expect(fetch.mock.calls[0][0]).toBe(`http://localhost:8081/v2/me/company/job-drafts/${input.vacancyId}/team`);
  const init = fetch.mock.calls[0][1]; expect(init).toMatchObject({ method: "GET", cache: "no-store", redirect: "error" });
  expect(new Headers(init.headers).get("authorization")).toBe("Bearer token");
});
it.each(['', 'W/"team-1"', 'unquoted'])("rejects invalid ETag %s", async etag => {
  reply(await fixture.getTeam(), 200, etag); expect(await getTeam(input)).toMatchObject({ ok: false, code: "invalid_response" });
});
it("decodes every mixed history kind and preserves latest-event at and opaque cursors", async () => {
  const history = await fixture.getHistory();
  for (const kind of ["tramo", "reassignment", "mode_change"] as const) {
    const item = history.items.find(item => item.kind === kind)!;
    if (item.kind === "reassignment") item.reassignment.state_snapshot.stage_counts.forEach(stage => Object.assign(stage, { kind: "custom" }));
    const page = { items: [{ ...item, at: "2026-11-15T12:00:00Z" }], next_cursor: "opaque+/=" };
    const fetch = reply(page); expect(await getHistory({ ...input, cursor: "opaque+/=" })).toMatchObject({ ok: true, data: page });
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get("cursor")).toBe("opaque+/=");
  }
  reply({ items: [], next_cursor: null }); expect(await getHistory(input)).toMatchObject({ ok: true, data: { items: [], next_cursor: null } });
});
it("reads the real company members route, keeping membership and user IDs distinct and skipping deactivated users", async () => {
  const data = await fixture.getCompanyMembers();
  const company = "20000000-0000-4000-8000-000000000001";
  const body = { members: [...data.members.map((member, i) => ({ id: `30000000-0000-4000-8000-00000000000${i + 1}`, company_id: company, role: member.role, created_at: "2026-10-15T00:07:43.276165+00:00", updated_at: "2026-10-15T00:07:43.276165+00:00", user: { ...member.user, id: `40000000-0000-4000-8000-00000000000${i + 1}` } })),
    { id: "30000000-0000-4000-8000-000000000009", company_id: company, role: "recruiter", created_at: "2026-10-15T00:07:43Z", updated_at: "2026-10-15T00:07:43Z", user: null }] };
  const fetch = reply(body);
  const result = await getCompanyMembers(input);
  expect(fetch.mock.calls[0][0]).toBe("http://localhost:8081/me/company/members");
  expect(result).toEqual({ ok: true, data: { members: body.members.slice(0, -1).map(member => ({ id: member.id, role: member.role, user: member.user })) } });
});
it.each([[404, "team_access_ended"], [404, "not_found"], [401, "unauthenticated"], [400, "invalid_cursor"]] as const)("preserves %s %s", async (status, code) => {
  reply({ error: "private backend text", code }, status);
  expect(await getHistory(input)).toEqual({ ok: false, code, status });
});
it("rejects malformed successes, unknown fields and guards before transport", async () => {
  for (const [call, payload] of [[getTeam, { ...await fixture.getTeam(), unexpected: true }], [getHistory, { items: [{ kind: "unknown" }], next_cursor: null }], [getCompanyMembers, { members: [{ id: "membership", user: {} }] }]] as const) {
    reply(payload); expect(await call(input)).toMatchObject({ ok: false, code: "invalid_response" });
  }
  const fetch = reply({});
  expect(await getTeam({ ...input, vacancyId: "../bad" })).toMatchObject({ ok: false, code: "invalid_request" });
  expect(await getTeam({ ...input, token: "" })).toMatchObject({ ok: false, code: "unauthenticated" });
  expect(fetch).not.toHaveBeenCalled();
});
it("drops stakeholder memberships from the members a vacancy team can use (team writes would answer 422 not_company_member)", async () => {
  const company = "20000000-0000-4000-8000-000000000001";
  const member = (i: number, role: string) => ({ id: `30000000-0000-4000-8000-00000000000${i}`, company_id: company, role, created_at: "2026-10-15T00:07:43Z", updated_at: "2026-10-15T00:07:43Z", user: { id: `40000000-0000-4000-8000-00000000000${i}`, full_name: `Persona ${i}`, email: `p${i}@example.test` } });
  reply({ members: [member(1, "owner"), member(2, "stakeholder"), member(3, "recruiter")] });
  const result = await getCompanyMembers(input);
  expect(result).toMatchObject({ ok: true });
  expect(result.ok && result.data.members.map(item => item.role)).toEqual(["owner", "recruiter"]);
});
