import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ token: vi.fn(), get: vi.fn(), save: vi.fn(), marks: vi.fn(), set: vi.fn(), clear: vi.fn() }));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: mocks.token }));
vi.mock("./client", () => ({ getChecklist: mocks.get, saveChecklist: mocks.save, getChecklistMarks: mocks.marks, setChecklistMark: mocks.set, clearChecklistMark: mocks.clear }));
import { loadChecklistAction, saveChecklistAction, loadChecklistMarksAction, setChecklistMarkAction, clearChecklistMarkAction } from "@/features/vacancy-checklist/actions";
it("requires a session before calling transport", async () => { mocks.token.mockResolvedValue(null); expect(await loadChecklistAction("id")).toMatchObject({ reason: "unauthenticated" }); expect(mocks.get).not.toHaveBeenCalled(); });
it("injects the session token for all endpoints", async () => {
  mocks.token.mockResolvedValue("session");
  for (const [call, mock, expected] of [
    [() => loadChecklistAction("id"), mocks.get, { vacancyId: "id" }],
    [() => saveChecklistAction({ vacancyId: "id", ifMatch: '"0"', body: {} }), mocks.save, { vacancyId: "id", ifMatch: '"0"', body: {} }],
    [() => loadChecklistMarksAction("id"), mocks.marks, { vacancyId: "id" }],
    [() => setChecklistMarkAction({ vacancyId: "id", participationId: "p", criterionId: "c", body: {} }), mocks.set, { vacancyId: "id", participationId: "p", criterionId: "c", body: {} }],
    [() => clearChecklistMarkAction({ vacancyId: "id", participationId: "p", criterionId: "c" }), mocks.clear, { vacancyId: "id", participationId: "p", criterionId: "c" }],
  ] as const) { mock.mockResolvedValue({ ok: true, data: null }); expect(await call()).toEqual({ ok: true, data: null }); expect(mock).toHaveBeenLastCalledWith({ ...expected, token: "session" }); }
});
it("preserves failures and handles session exceptions without replay", async () => { mocks.token.mockResolvedValue("session"); mocks.get.mockResolvedValue({ ok: false, reason: "forbidden", reference: { status: 403 } }); expect(await loadChecklistAction("id")).toMatchObject({ reason: "forbidden" }); mocks.token.mockRejectedValue(new Error("offline")); expect(await loadChecklistAction("id")).toMatchObject({ reason: "no_response" }); });
