import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("./summary-client", () => ({ getCandidatesSummary: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { getCandidatesSummary } from "./summary-client";
import { getCandidatesSummaryAction } from "./summary-actions";
import { summary } from "./test-fixtures";
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getActionAccessToken).mockResolvedValue("token"); });
it("rejects unauthenticated sessions without calling the client", async () => {
  vi.mocked(getActionAccessToken).mockResolvedValue(null);
  expect(await getCandidatesSummaryAction()).toEqual({ ok: false, reason: "unauthenticated", reference: {} });
  expect(getCandidatesSummary).not.toHaveBeenCalled();
});
it("returns only decoded summary data", async () => {
  vi.mocked(getCandidatesSummary).mockResolvedValue({ ok: true, data: summary });
  expect(await getCandidatesSummaryAction()).toEqual({ ok: true, data: summary });
  expect(getCandidatesSummary).toHaveBeenCalledWith({ token: "token" });
});
it.each([[401, "unauthenticated", "unauthenticated"], [403, "not_a_member", "forbidden"], [403, "company_inactive", "forbidden"], [404, "not_found", "not_found"], [500, "internal_error", "server_error"], [502, "unknown_private_code", "server_error"]] as const)("maps HTTP %s without leaking raw messages", async (status, code, reason) => {
  vi.mocked(getCandidatesSummary).mockResolvedValue({ ok: false, error: { kind: "status", status, retryable: false }, envelope: { error: "private body", code } });
  const result = await getCandidatesSummaryAction();
  expect(result).toEqual({ ok: false, reason, reference: { status, ...(code === "unknown_private_code" ? {} : { code }) } });
  expect(JSON.stringify(result)).not.toMatch(/private/);
});
it.each([["network", "no_response"], ["timeout", "no_response"], ["invalid_response", "unrecognized_response"], ["missing_token", "unauthenticated"]] as const)("maps %s safely", async (kind, reason) => {
  vi.mocked(getCandidatesSummary).mockResolvedValue({ ok: false, error: { kind, retryable: false } });
  expect(await getCandidatesSummaryAction()).toEqual({ ok: false, reason, reference: {} });
});
it("handles thrown errors without exception messages", async () => {
  vi.mocked(getCandidatesSummary).mockRejectedValue(new Error("private exception"));
  expect(await getCandidatesSummaryAction()).toEqual({ ok: false, reason: "no_response", reference: {} });
});
