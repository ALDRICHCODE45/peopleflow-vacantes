import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ token: vi.fn(), getProfile: vi.fn(), saveProfile: vi.fn(), getInvitations: vi.fn(), createInvitation: vi.fn(), mintLink: vi.fn(), remindInvitation: vi.fn(), revokeInvitation: vi.fn(), getResult: vi.fn(), createComparison: vi.fn() }));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: mocks.token }));
vi.mock("./client", () => mocks);
import * as a from "./actions";
const target = { vacancyId: "v", invitationId: "i" };
const endpoints = [
  [() => a.loadProfileAction("v"), mocks.getProfile, { vacancyId: "v" }],
  [() => a.saveProfileAction({ vacancyId: "v", ifMatch: '"1"', body: {} }), mocks.saveProfile, { vacancyId: "v", ifMatch: '"1"', body: {} }],
  [() => a.loadInvitationsAction("v"), mocks.getInvitations, { vacancyId: "v" }],
  [() => a.createInvitationAction({ vacancyId: "v", participationId: "p" }), mocks.createInvitation, { vacancyId: "v", participationId: "p" }],
  [() => a.mintLinkAction(target), mocks.mintLink, target], [() => a.remindInvitationAction(target), mocks.remindInvitation, target],
  [() => a.revokeInvitationAction(target), mocks.revokeInvitation, target], [() => a.loadResultAction(target), mocks.getResult, target],
  [() => a.createComparisonAction(target), mocks.createComparison, target],
] as const;
beforeEach(() => vi.resetAllMocks());
for (const [call, mock, expected] of endpoints) {
  it(`injects the session for ${Object.keys(mocks).find(k => mocks[k as keyof typeof mocks] === mock)}`, async () => {
    mocks.token.mockResolvedValue("session"); mock.mockResolvedValue({ ok: true, data: { stored: true } });
    expect(await call()).toEqual({ ok: true, data: { stored: true } }); expect(mock).toHaveBeenCalledExactlyOnceWith({ ...expected, token: "session" });
  });
  it.each([null, "", " "])(`rejects absent session for ${String(call)} (%s)`, async token => {
    mocks.token.mockResolvedValue(token); expect(await call()).toEqual({ ok: false, reason: "unauthenticated", reference: {} }); expect(mock).not.toHaveBeenCalled();
  });
  it("preserves typed failures without replay and contains thrown errors", async () => {
    mocks.token.mockResolvedValue("session"); const failure = { ok: false, reason: "version_conflict", reference: { status: 412 } }; mock.mockResolvedValue(failure);
    expect(await call()).toEqual(failure); expect(mock).toHaveBeenCalledTimes(1);
    mock.mockRejectedValue(new Error("private")); expect(await call()).toEqual({ ok: false, reason: "no_response", reference: {} }); expect(mock).toHaveBeenCalledTimes(2);
    mocks.token.mockRejectedValue(new Error("private")); expect(await call()).toEqual({ ok: false, reason: "no_response", reference: {} }); expect(mock).toHaveBeenCalledTimes(2);
  });
}
