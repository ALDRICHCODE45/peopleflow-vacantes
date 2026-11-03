import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8081", apiTimeoutMs: 1000 } }));
import { writeTeam, type TeamWrite } from "./api-client";
import { createFixtureClient } from "./prototype-client";
const id = "10000000-0000-4000-8000-000000000001";
const user = "20000000-0000-4000-8000-000000000001";
const input = { token: " token ", vacancyId: id, ifMatch: '"team-1"', idempotencyKey: "30000000-0000-4000-8000-000000000001" };
const writes: [TeamWrite, string, string, unknown][] = [
  [{ kind: "add", body: { user_id: user, recruiter_deadline: null } }, "POST", "/members", { user_id: user, recruiter_deadline: null }],
  [{ kind: "remove", userId: user }, "POST", `/members/${user}/remove`, {}],
  [{ kind: "leave" }, "POST", "/leave", {}],
  [{ kind: "deadline", userId: user, deadline: "2026-11-20" }, "PATCH", `/members/${user}`, { recruiter_deadline: "2026-11-20" }],
  [{ kind: "reassign", body: { to_user_id: user, reason: "workload", recruiter_deadline: null, previous_responsible: "remove" } }, "POST", "/reassign-responsible", { to_user_id: user, reason: "workload", recruiter_deadline: null, previous_responsible: "remove" }],
  [{ kind: "mode", body: { mode: "shared" } }, "PUT", "/mode", { mode: "shared" }],
  [{ kind: "mode", body: { mode: "with_responsible", responsible_user_id: user } }, "PUT", "/mode", { mode: "with_responsible", responsible_user_id: user }],
];
afterEach(() => vi.unstubAllGlobals());
it.each(writes)("writes %j with guarded method, path, body and headers", async (write, method, path, body) => {
  const team = await createFixtureClient("owner").getTeam();
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(team), { headers: { etag: '"team-2"' } }));
  vi.stubGlobal("fetch", fetch);
  expect(await writeTeam({ ...input, write })).toEqual({ ok: true, data: team, etag: '"team-2"' });
  expect(fetch.mock.calls[0][0]).toBe(`http://localhost:8081/v2/me/company/job-drafts/${id}/team${path}`);
  const init = fetch.mock.calls[0][1];
  expect(init).toMatchObject({ method, redirect: "error", cache: "no-store" });
  expect(JSON.parse(init.body)).toEqual(body);
  const headers = new Headers(init.headers);
  expect(headers.get("authorization")).toBe("Bearer token");
  expect(headers.get("if-match")).toBe(input.ifMatch);
  expect(headers.get("idempotency-key")).toBe(method === "POST" ? input.idempotencyKey : null);
});
const failures: [number, string][] = [
  [412, "team_version_conflict"], [403, "team_action_forbidden"], [404, "team_access_ended"],
  ...["responsible_cannot_leave", "team_last_member", "use_reassign_responsible", "team_member_already_active", "reassign_target_is_responsible", "team_mode_unchanged", "team_mode_mismatch"].map((code): [number, string] => [409, code]),
  ...["not_company_member", "reassignment_note_required", "responsible_not_on_team", "recruiter_deadline_not_applicable", "responsible_not_applicable"].map((code): [number, string] => [422, code]),
];
it.each(failures)("preserves write failure %s %s without backend text", async (status, code) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code, error: "private" }), { status: Number(status) })));
  expect(await writeTeam({ ...input, write: { kind: "leave" } })).toEqual({ ok: false, code, status });
});
it("rejects missing preconditions, malformed identities and success without a strong ETag", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(await createFixtureClient("owner").getTeam())));
  vi.stubGlobal("fetch", fetch);
  for (const change of [{ ifMatch: "" }, { idempotencyKey: "bad" }, { write: { kind: "remove", userId: "../bad" } }]) {
    expect(await writeTeam({ ...input, write: { kind: "leave" }, ...change } as Parameters<typeof writeTeam>[0])).toMatchObject({ ok: false, code: "invalid_request" });
  }
  expect(fetch).not.toHaveBeenCalled();
  expect(await writeTeam({ ...input, write: { kind: "leave" } })).toMatchObject({ ok: false, code: "invalid_response" });
});
