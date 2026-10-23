import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("./contacts-client", () => ({ postCandidateContacts: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { postCandidateContacts } from "./contacts-client";
import { getCandidateContactsAction } from "./contacts-actions";
const candidates = Array.from({ length: 201 }, (_, i) => ({ kind: "manual" as const, id: `0198f5a2-7c1b-7ddd-9c2e-${String(i).padStart(12, "0")}` }));
beforeEach(() => {
 vi.resetAllMocks(); vi.mocked(getActionAccessToken).mockResolvedValue("token");
 vi.mocked(postCandidateContacts).mockImplementation(async ({ candidates }) => ({ ok: true, data: { items: candidates.map(candidate => ({ ...candidate, email: null, phone: null })) } }));
});
it.each([1, 100, 101, 200, 201])("chunks %s selected identities into requests of at most 100, preserving order", async count => {
 const selected = candidates.slice(0, count);
 expect(await getCandidateContactsAction(selected)).toEqual({ ok: true, data: { items: selected.map(candidate => ({ ...candidate, email: null, phone: null })) } });
 expect(postCandidateContacts).toHaveBeenCalledTimes(Math.ceil(count / 100));
 expect(vi.mocked(postCandidateContacts).mock.calls.map(([input]) => input.candidates.length)).toEqual(count === 201 ? [100, 100, 1] : count === 200 ? [100, 100] : count === 101 ? [100, 1] : [count]);
 expect(vi.mocked(postCandidateContacts).mock.calls.flatMap(([input]) => input.candidates)).toEqual(selected);
 expect(vi.mocked(postCandidateContacts).mock.calls.every(([input]) => input.token === "token")).toBe(true);
});
it("fails atomically on a later chunk, exposing no partial contact or raw error", async () => {
 vi.mocked(postCandidateContacts).mockResolvedValueOnce({ ok: true, data: { items: [{ ...candidates[0], email: "private@example.test", phone: null }] } }).mockResolvedValueOnce({ ok: false, error: { kind: "status", retryable: false, status: 500 } });
 expect(await getCandidateContactsAction(candidates)).toEqual({ ok: false });
 expect(postCandidateContacts).toHaveBeenCalledTimes(2);
});
it("does not call the client without a session", async () => {
 vi.mocked(getActionAccessToken).mockResolvedValue(null);
 expect(await getCandidateContactsAction([candidates[0]])).toEqual({ ok: false });
 expect(postCandidateContacts).not.toHaveBeenCalled();
});
it.each([[], [candidates[0], candidates[0]], [{ ...candidates[0], extra: true }], [{ ...candidates[0], id: "invalid" }]].map(selected => ({ selected })))("rejects invalid selection before transport %#", async ({ selected }) => {
 expect(await getCandidateContactsAction(selected)).toEqual({ ok: false });
 expect(postCandidateContacts).not.toHaveBeenCalled();
});
it("contains thrown transport errors", async () => {
 vi.mocked(postCandidateContacts).mockRejectedValue(new Error("private"));
 expect(await getCandidateContactsAction([candidates[0]])).toEqual({ ok: false });
});
