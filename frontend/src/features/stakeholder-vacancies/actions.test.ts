import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("./client", () => ({ listStakeholderVacancies: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { listStakeholderVacancies } from "./client";
import { loadStakeholderVacanciesAction } from "./actions";
import { listWire } from "./test-fixtures";
import { stakeholderVacanciesSchema } from "./model";

beforeEach(() => { vi.resetAllMocks(); vi.mocked(getActionAccessToken).mockResolvedValue("secret"); });

it("does not call the client without a token", async () => {
  vi.mocked(getActionAccessToken).mockResolvedValue(null);
  expect(await loadStakeholderVacanciesAction()).toEqual({ ok: false, reason: "unauthenticated", reference: {} });
  expect(listStakeholderVacancies).not.toHaveBeenCalled();
});
it("returns the rows and the next cursor and forwards only the cursor", async () => {
  vi.mocked(listStakeholderVacancies).mockResolvedValue({ ok: true, data: stakeholderVacanciesSchema.parse({ ...listWire(), next_cursor: "opaque+/=" }) });
  const result = await loadStakeholderVacanciesAction({ cursor: "opaque+/=" });
  expect(result).toMatchObject({ ok: true, nextCursor: "opaque+/=" });
  expect(result.ok && result.items).toHaveLength(2);
  expect(listStakeholderVacancies).toHaveBeenCalledExactlyOnceWith({ token: "secret", cursor: "opaque+/=" });
});
it("asks for the default page when no cursor is given", async () => {
  vi.mocked(listStakeholderVacancies).mockResolvedValue({ ok: true, data: { items: [], next_cursor: null } });
  await loadStakeholderVacanciesAction();
  expect(listStakeholderVacancies).toHaveBeenCalledExactlyOnceWith({ token: "secret" });
});
it.each([[401, "unauthenticated"], [403, "forbidden"], [400, "invalid_request"], [500, "server_error"], [503, "server_error"], [418, "unrecognized_response"]] as const)("maps status %s to %s without leaking the backend text", async (status, reason) => {
  vi.mocked(listStakeholderVacancies).mockResolvedValue({ ok: false, error: { kind: "status", status, retryable: false }, envelope: { error: "unsafe secret", code: "invalid_request" } });
  const result = await loadStakeholderVacanciesAction();
  expect(result).toMatchObject({ ok: false, reason });
  expect(JSON.stringify(result)).not.toMatch(/unsafe|secret/);
});
it.each([["network", "no_response"], ["timeout", "no_response"], ["invalid_response", "unrecognized_response"], ["invalid_request", "invalid_request"]] as const)("maps %s to %s", async (kind, reason) => {
  vi.mocked(listStakeholderVacancies).mockResolvedValue({ ok: false, error: { kind, retryable: false } });
  expect(await loadStakeholderVacanciesAction()).toMatchObject({ ok: false, reason });
});
it("turns a thrown error into «no_response»", async () => {
  vi.mocked(listStakeholderVacancies).mockRejectedValue(new Error("secret"));
  expect(await loadStakeholderVacanciesAction()).toEqual({ ok: false, reason: "no_response", reference: {} });
});
