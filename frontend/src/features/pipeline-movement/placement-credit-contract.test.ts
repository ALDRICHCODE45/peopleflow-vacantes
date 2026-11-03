import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080/api/v1/", apiTimeoutMs: 1000 } }));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { detailSchema } from "./model";
import { loadPlacementCreditsAction, correctPlacementCreditAction, loadParticipationAction } from "./actions";
import { detail, id } from "./test-fixtures";
export const credit = { id: id(90), status: "active", team_mode: "with_responsible", hired_at: "2026-11-03T12:00:00.123456+00:00", hired_by: { id: id(91), name: "Test User" }, exit_reason: null, recipients: [{ user_id: id(92), name: "Ana López", kind: "direct" }] };
const input = { vacancyId: id(30), participationId: detail.id, creditId: credit.id, action: "void" as const, idempotencyKey: id(99) };
const base = `http://localhost:8080/v2/me/company/job-drafts/${input.vacancyId}/participations/${input.participationId}`;
beforeEach(() => vi.mocked(getActionAccessToken).mockResolvedValue(" private-token "));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
it.each([null, ...["active", "did_not_hold", "voided"].map(status => ({ ...credit, status }))])("strict detail decodes placement credit %j", placement_credit => {
  const value = { ...detail, placement_credit, can: { void_credit: true, restore_credit: false } };
  expect(detailSchema.parse(value)).toEqual(value);
});
it.each([
  { placement_credit: undefined }, { can: undefined }, { placement_credit: { ...credit, status: "other" } },
  { placement_credit: { ...credit, recipients: [{ ...credit.recipients[0], kind: "owner" }] } },
  { placement_credit: { ...credit, exit_reason: "other" } }, { placement_credit: { ...credit, team_mode: "other" } },
  { placement_credit: { ...credit, extra: true } }, { can: { void_credit: 1, restore_credit: false } },
])("rejects missing/widened credit fields %#", patch => {
  expect(detailSchema.safeParse({ ...detail, placement_credit: null, can: { void_credit: false, restore_credit: false }, ...patch }).success).toBe(false);
});
it("reads the full newest-first credit list through the authenticated boundary", async () => {
  const data = { items: [credit, { ...credit, id: id(89), status: "voided" }] };
  const fetch = vi.fn().mockResolvedValue(Response.json(data)); vi.stubGlobal("fetch", fetch);
  expect(await loadPlacementCreditsAction(input.vacancyId, input.participationId)).toEqual({ ok: true, data });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe(`${base}/placement-credits`);
  expect(fetch.mock.calls[0][1]).toMatchObject({ method: "GET", cache: "no-store", redirect: "error" });
});
it.each(["void", "restore"] as const)("posts %s once with empty body and UUID key, never an ETag", async action => {
  const fetch = vi.fn().mockResolvedValue(Response.json(credit)); vi.stubGlobal("fetch", fetch);
  expect(await correctPlacementCreditAction({ ...input, action })).toEqual({ ok: true, data: credit });
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, init] = fetch.mock.calls[0]; expect(url).toBe(`${base}/placement-credits/${credit.id}/${action}`);
  expect(init).toMatchObject({ method: "POST", body: "{}", cache: "no-store", redirect: "error" });
  expect(Object.fromEntries(new Headers(init.headers))).toEqual({ accept: "application/json", authorization: "Bearer private-token", "content-type": "application/json", "idempotency-key": input.idempotencyKey });
});
it.each([[409, "credit_status_unchanged", "credit_status_unchanged"], [403, "team_action_forbidden", "forbidden"], [404, "team_access_ended", "team_access_ended"]] as const)("maps %s %s safely", async (status, code, reason) => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ error: "private", code }, { status })); vi.stubGlobal("fetch", fetch);
  expect(await correctPlacementCreditAction(input)).toMatchObject({ ok: false, reason, reference: { status } });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("guards session and UUID segments before sending anything", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  expect(await correctPlacementCreditAction({ ...input, creditId: "../bad" })).toMatchObject({ ok: false, reason: "invalid_request" });
  expect(await correctPlacementCreditAction({ ...input, idempotencyKey: "bad" })).toMatchObject({ ok: false, reason: "invalid_request" });
  vi.mocked(getActionAccessToken).mockResolvedValue(null);
  expect(await correctPlacementCreditAction(input)).toMatchObject({ ok: false, reason: "unauthenticated" });
  expect(fetch).not.toHaveBeenCalled();
});
it("preserves detail reads with no placement and existing profile/contact data", async () => {
  const data = { ...detail, placement_credit: null, can: { void_credit: false, restore_credit: false } };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(data)));
  expect(await loadParticipationAction(input.vacancyId, input.participationId)).toEqual({ ok: true, data });
});
