import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("./api-client", () => ({ getHistory: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { getHistory } from "./api-client";
import { loadAssignmentHistoryAction } from "./actions";
import { createApiClient } from "./action-client";
afterEach(() => vi.resetAllMocks());
it("uses only the server session bearer and forwards opaque cursor", async () => {
  vi.mocked(getActionAccessToken).mockResolvedValue("session-token");
  vi.mocked(getHistory).mockResolvedValue({ ok: true, data: { items: [], next_cursor: null } });
  expect(await createApiClient().getHistory("opaque")).toEqual({ items: [], next_cursor: null });
  expect(getHistory).toHaveBeenCalledWith({ token: "session-token", cursor: "opaque" });
});
it("guards missing session and sanitizes session failures", async () => {
  vi.mocked(getActionAccessToken).mockResolvedValue(null);
  expect(await loadAssignmentHistoryAction()).toEqual({ ok: false, code: "unauthenticated", status: 401 });
  expect(getHistory).not.toHaveBeenCalled();
  vi.mocked(getActionAccessToken).mockRejectedValue(new Error("private"));
  expect(await loadAssignmentHistoryAction()).toEqual({ ok: false, code: "read_failed" });
});
it.each(["unauthenticated", "invalid_cursor", "read_failed"] as const)("preserves typed %s across the action adapter", async code => {
  vi.mocked(getActionAccessToken).mockResolvedValue("token");
  vi.mocked(getHistory).mockResolvedValue({ ok: false, code, status: 400 });
  await expect(createApiClient().getHistory()).rejects.toMatchObject({ code, status: 400 });
});
