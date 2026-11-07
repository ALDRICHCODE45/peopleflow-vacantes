import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "https://api.example.test", apiTimeoutMs: 100 } }));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import {
  acceptStakeholderInvitationAction, createStakeholderInvitationAction, listStakeholderInvitationsAction, revokeStakeholderInvitationAction,
} from "./actions";
import { acceptBody, companyId, createdInvitation, invitationId, memberId, pendingInvitation, urlToken } from "./test-fixtures";

const fetchMock = vi.fn();
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", fetchMock); vi.mocked(getActionAccessToken).mockResolvedValue(" private-token "); });
afterEach(() => vi.unstubAllGlobals());
const envelope = (status: number, code: string) => Response.json({ error: "private backend message", code }, { status });
const call = (index = 0) => ({ url: String(fetchMock.mock.calls[index][0]), init: fetchMock.mock.calls[index][1] as RequestInit });

it("creates with the session token and returns the token-bearing 201 once", async () => {
  fetchMock.mockResolvedValue(Response.json(createdInvitation(), { status: 201 }));
  expect(await createStakeholderInvitationAction()).toEqual({ ok: true, invitation: createdInvitation() });
  const { url, init } = call();
  expect(url).toBe("https://api.example.test/v2/me/company/stakeholder-invitations");
  expect(init).toMatchObject({ method: "POST", redirect: "error" });
  expect(new Headers(init.headers).get("authorization")).toBe("Bearer private-token");
});

it("maps 422 invitation_limit_reached to the limit and never leaks the backend text", async () => {
  fetchMock.mockResolvedValue(envelope(422, "invitation_limit_reached"));
  const result = await createStakeholderInvitationAction();
  expect(result).toEqual({ ok: false, reason: "limit_reached", reference: { status: 422, code: "invitation_limit_reached" } });
  expect(JSON.stringify(result)).not.toContain("private backend message");
});

it("treats a 200 instead of the contract's 201 as an unrecognized create", async () => {
  fetchMock.mockResolvedValue(Response.json(createdInvitation()));
  expect(await createStakeholderInvitationAction()).toMatchObject({ ok: false, reason: "unrecognized_response" });
});

it("lists pending invitations without any token", async () => {
  fetchMock.mockResolvedValue(Response.json({ items: [pendingInvitation()] }));
  expect(await listStakeholderInvitationsAction()).toEqual({ ok: true, items: [pendingInvitation()] });
  expect(call().url).toBe("https://api.example.test/v2/me/company/stakeholder-invitations");
  fetchMock.mockResolvedValue(Response.json({ items: [{ ...pendingInvitation(), url_token: urlToken }] }));
  expect(await listStakeholderInvitationsAction()).toMatchObject({ ok: false, reason: "unrecognized_response" });
});

it.each([
  [401, "unauthenticated", "unauthenticated"],
  [403, "forbidden", "forbidden"],
  [500, "internal_error", "server_error"],
  [502, "anything", "server_error"],
  [418, "teapot", "unrecognized_response"],
] as const)("maps a %s %s on reads and writes to «%s»", async (status, code, reason) => {
  fetchMock.mockImplementation(async () => envelope(status, code));
  expect(await listStakeholderInvitationsAction()).toMatchObject({ ok: false, reason, reference: { status } });
  expect(await createStakeholderInvitationAction()).toMatchObject({ ok: false, reason, reference: { status } });
  expect(await revokeStakeholderInvitationAction(invitationId)).toMatchObject({ ok: false, reason, reference: { status } });
});

it("reports no response on a network failure", async () => {
  fetchMock.mockRejectedValue(new TypeError("fetch failed"));
  expect(await listStakeholderInvitationsAction()).toEqual({ ok: false, reason: "no_response", reference: {} });
  expect(await revokeStakeholderInvitationAction(invitationId)).toEqual({ ok: false, reason: "no_response", reference: {} });
  expect(await acceptStakeholderInvitationAction(urlToken)).toEqual({ ok: false, reason: "no_response", reference: {} });
});

it("revokes with DELETE and accepts the idempotent 204 (unknown, used or other-company ids too)", async () => {
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  expect(await revokeStakeholderInvitationAction(invitationId)).toEqual({ ok: true });
  const { url, init } = call();
  expect(url).toBe(`https://api.example.test/v2/me/company/stakeholder-invitations/${invitationId}`);
  expect(init).toMatchObject({ method: "DELETE", redirect: "error", cache: "no-store" });
  expect(new Headers(init.headers).get("authorization")).toBe("Bearer private-token");
  fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
  expect(await revokeStakeholderInvitationAction(invitationId)).toMatchObject({ ok: false, reason: "unrecognized_response" });
});

it("refuses a malformed invitation id before any request", async () => {
  expect(await revokeStakeholderInvitationAction("../members")).toEqual({ ok: false, reason: "invalid_request", reference: {} });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("answers unauthenticated without a request when there is no session", async () => {
  vi.mocked(getActionAccessToken).mockResolvedValue(null);
  expect(await createStakeholderInvitationAction()).toEqual({ ok: false, reason: "unauthenticated", reference: {} });
  expect(await listStakeholderInvitationsAction()).toEqual({ ok: false, reason: "unauthenticated", reference: {} });
  expect(await revokeStakeholderInvitationAction(invitationId)).toEqual({ ok: false, reason: "unauthenticated", reference: {} });
  expect(await acceptStakeholderInvitationAction(urlToken)).toEqual({ ok: false, reason: "unauthenticated", reference: {} });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("accepts by posting the token in the body, never in the URL", async () => {
  fetchMock.mockResolvedValue(Response.json(acceptBody));
  expect(await acceptStakeholderInvitationAction(urlToken)).toEqual({ ok: true, companyId, memberId });
  const { url, init } = call();
  expect(url).toBe("https://api.example.test/v2/me/stakeholder-invitations/accept");
  expect(url).not.toContain(urlToken);
  expect(init).toMatchObject({ method: "POST", redirect: "error", body: JSON.stringify({ token: urlToken }) });
  expect(new Headers(init.headers).get("authorization")).toBe("Bearer private-token");
});

it("treats the same-user replay (200, same body) exactly like the first accept", async () => {
  fetchMock.mockImplementation(async () => Response.json(acceptBody));
  const first = await acceptStakeholderInvitationAction(urlToken);
  expect(await acceptStakeholderInvitationAction(urlToken)).toEqual(first);
});

it.each([
  [404, "invitation_invalid", "invitation_invalid"],
  [403, "candidate_account", "candidate_account"],
  [409, "already_company_member", "already_company_member"],
  [400, "invalid_request", "invitation_invalid"],
  [401, "unauthenticated", "unauthenticated"],
  [500, "internal_error", "server_error"],
  [403, "forbidden", "unrecognized_response"],
  [409, "conflict", "unrecognized_response"],
] as const)("maps an accept %s %s to «%s» without echoing the token or the backend text", async (status, code, reason) => {
  fetchMock.mockResolvedValue(envelope(status, code));
  const result = await acceptStakeholderInvitationAction(urlToken);
  expect(result).toMatchObject({ ok: false, reason, reference: { status } });
  expect(JSON.stringify(result)).not.toContain(urlToken);
  expect(JSON.stringify(result)).not.toContain("private backend message");
});

it("rejects an accept body with another role and a token outside the URL-safe alphabet", async () => {
  fetchMock.mockResolvedValue(Response.json({ ...acceptBody, role: "recruiter" }));
  expect(await acceptStakeholderInvitationAction(urlToken)).toMatchObject({ ok: false, reason: "unrecognized_response" });
  fetchMock.mockClear();
  expect(await acceptStakeholderInvitationAction("abc/def?x=1")).toEqual({ ok: false, reason: "invitation_invalid", reference: {} });
  expect(fetchMock).not.toHaveBeenCalled();
});
