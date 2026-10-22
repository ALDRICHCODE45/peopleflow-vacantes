import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "https://api.example.test", apiTimeoutMs: 50 } }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { listTeamMembersAction, changeTeamRoleAction, removeTeamMemberAction } from "@/features/employer-team/actions";
import { members } from "./test-fixtures";
const fetchMock = vi.fn();
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", fetchMock); vi.mocked(getActionAccessToken).mockResolvedValue(" secret "); });
afterEach(() => vi.unstubAllGlobals());
it("loads the strict real members envelope over authenticated no-store transport", async () => {
  fetchMock.mockResolvedValue(Response.json({ members }));
  expect(await listTeamMembersAction()).toEqual({ ok: true, members });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("https://api.example.test/me/company/members");
  expect(init).toMatchObject({ cache: "no-store", redirect: "error" });
  expect(new Headers(init.headers).get("authorization")).toBe("Bearer secret");
});
it("rejects an unrecognized member response instead of rendering it", async () => {
  fetchMock.mockResolvedValue(Response.json({ members: [{ ...members[0], role: "admin" }] }));
  expect(await listTeamMembersAction()).toMatchObject({ ok: false, reason: "unrecognized_response" });
});
it.each([[401, "unauthenticated"], [404, "not_member"], [403, "forbidden"], [500, "server_error"]])("classifies HTTP %s for reads and writes", async (status, reason) => {
  fetchMock.mockImplementation(() => Promise.resolve(Response.json({ error: "private", code: "internal_error" }, { status: Number(status) })));
  for (const call of [listTeamMembersAction, () => changeTeamRoleAction(members[1].id, "owner"), () => removeTeamMemberAction(members[1].id)]) {
    const result = await call();
    expect(result).toMatchObject({ ok: false, reason, reference: { status } });
    expect(JSON.stringify(result)).not.toContain("private");
  }
});
it("never calls the backend without a session", async () => {
  vi.mocked(getActionAccessToken).mockResolvedValue(null);
  expect(await listTeamMembersAction()).toMatchObject({ ok: false, reason: "unauthenticated" });
  expect(await changeTeamRoleAction(members[1].id, "owner")).toMatchObject({ ok: false, reason: "unauthenticated" });
  expect(await removeTeamMemberAction(members[1].id)).toMatchObject({ ok: false, reason: "unauthenticated" });
  expect(fetchMock).not.toHaveBeenCalled();
});
it("PATCH uses company_members id and role only; DELETE accepts an empty 204", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ ...members[1], role: "owner" })).mockResolvedValueOnce(new Response(null, { status: 204 }));
  expect(await changeTeamRoleAction(members[1].id, "owner")).toEqual({ ok: true });
  expect(await removeTeamMemberAction(members[1].id)).toEqual({ ok: true });
  for (const [index, method] of ["PATCH", "DELETE"].entries()) {
    const [url, init] = fetchMock.mock.calls[index];
    expect(String(url)).toBe(`https://api.example.test/me/company/members/${members[1].id}`);
    expect(init).toMatchObject({ method, redirect: "error", cache: "no-store" });
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer secret");
    expect(init.body).toBe(index === 0 ? JSON.stringify({ role: "owner" }) : undefined);
  }
});
it("validates mutation input before transport and never automatically retries", async () => {
  expect(await changeTeamRoleAction("../other", "owner")).toMatchObject({ ok: false, reason: "invalid_request" });
  expect(await changeTeamRoleAction(members[0].id, "admin" as "owner")).toMatchObject({ ok: false, reason: "invalid_request" });
  expect(await removeTeamMemberAction("../other")).toMatchObject({ ok: false, reason: "invalid_request" });
  expect(fetchMock).not.toHaveBeenCalled();
  fetchMock.mockRejectedValue(new Error("private"));
  expect(await listTeamMembersAction()).toMatchObject({ ok: false, reason: "no_response" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("requires exact mutation success statuses", async () => {
  fetchMock.mockResolvedValue(Response.json({}));
  expect(await removeTeamMemberAction(members[1].id)).toMatchObject({ ok: false, reason: "unrecognized_response" });
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  expect(await changeTeamRoleAction(members[1].id, "owner")).toMatchObject({ ok: false, reason: "unrecognized_response" });
});
it.each([["change", () => changeTeamRoleAction(members[1].id, "recruiter")], ["remove", () => removeTeamMemberAction(members[1].id)]])("classifies the backend's last-owner guard on %s", async (_name, call) => {
  fetchMock.mockResolvedValue(Response.json({ error: "the company must keep at least one owner", code: "last_owner" }, { status: 409 }));
  expect(await call()).toEqual({ ok: false, reason: "last_owner", reference: { status: 409, code: "last_owner" } });
});
it("keeps any other conflict unrecognized", async () => {
  fetchMock.mockResolvedValue(Response.json({ error: "x", code: "something_else" }, { status: 409 }));
  expect(await removeTeamMemberAction(members[1].id)).toMatchObject({ ok: false, reason: "unrecognized_response" });
});
