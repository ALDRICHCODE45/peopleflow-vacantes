import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("./client", () => ({ getDashboardSection: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { getDashboardSection } from "./client";
import { loadAttentionAction, loadOriginAction, loadPipelineAction, loadRecentAction, loadSummaryAction, loadVacanciesAction } from "./actions";
import { summary } from "./test-fixtures";

beforeEach(() => { vi.resetAllMocks(); vi.mocked(getActionAccessToken).mockResolvedValue("token"); });

it.each([
  ["summary", loadSummaryAction], ["attention", loadAttentionAction], ["pipeline", loadPipelineAction],
  ["vacancies", loadVacanciesAction], ["recent", loadRecentAction], ["origin", loadOriginAction],
] as const)("%s reads its own section and returns only the decoded data", async (section, action) => {
  vi.mocked(getDashboardSection).mockResolvedValue({ ok: true, data: summary() } as never);
  expect(await action(90)).toEqual({ ok: true, data: summary() });
  expect(getDashboardSection).toHaveBeenCalledWith("token", section, 90);
});

it("defaults and sanitizes the window before transport", async () => {
  vi.mocked(getDashboardSection).mockResolvedValue({ ok: true, data: summary() } as never);
  await loadSummaryAction();
  await loadSummaryAction("14" as never);
  expect(vi.mocked(getDashboardSection).mock.calls.map(call => call[2])).toEqual([30, 30]);
});

it("rejects missing sessions without transport", async () => {
  vi.mocked(getActionAccessToken).mockResolvedValue(null);
  expect(await loadSummaryAction(30)).toEqual({ ok: false, reason: "unauthenticated", reference: {} });
  expect(getDashboardSection).not.toHaveBeenCalled();
});

it.each([
  [401, "unauthenticated", "unauthenticated"], [403, "forbidden", "forbidden"], [409, "company_not_active", "forbidden"],
  [404, "not_found", "not_found"], [422, "invalid_filter", "invalid_filter"], [500, "internal_error", "server_error"], [502, "private_code", "server_error"],
] as const)("maps HTTP %s/%s safely", async (status, code, reason) => {
  vi.mocked(getDashboardSection).mockResolvedValue({ ok: false, error: { kind: "status", status, retryable: false }, envelope: { error: "private message", code } });
  const result = await loadAttentionAction(30);
  expect(result).toMatchObject({ ok: false, reason });
  expect(JSON.stringify(result)).not.toMatch(/private/);
});

it.each([["network", "no_response"], ["timeout", "no_response"], ["invalid_response", "unrecognized_response"], ["missing_token", "unauthenticated"]] as const)(
  "maps %s safely", async (kind, reason) => {
    vi.mocked(getDashboardSection).mockResolvedValue({ ok: false, error: { kind, retryable: false } });
    expect(await loadOriginAction(30)).toMatchObject({ ok: false, reason });
  });

it.each(["session", "client"])("sanitizes thrown %s errors", async source => {
  if (source === "session") vi.mocked(getActionAccessToken).mockRejectedValue(new Error("private"));
  else vi.mocked(getDashboardSection).mockRejectedValue(new Error("private"));
  expect(await loadRecentAction(30)).toEqual({ ok: false, reason: "no_response", reference: {} });
});
