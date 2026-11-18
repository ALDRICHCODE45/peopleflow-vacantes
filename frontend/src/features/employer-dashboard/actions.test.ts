import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("./client", () => ({ getDashboardSection: vi.fn(), listDashboard: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { getDashboardSection, listDashboard } from "./client";
import {
  loadAttentionAction, loadOriginAction, loadPipelineAction, loadRecentAction, loadSummaryAction, loadVacanciesAction,
  listDashboardApplicationsAction, listDashboardCandidatesAction, listDashboardDeliveriesAction, listDashboardVacanciesAction,
} from "./actions";
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

it.each([
  ["candidates", listDashboardCandidatesAction, { in_process: "true", on: "2026-11-01", state: "overdue" }, { window: "90", in_process: "true", on: "2026-11-01" }],
  ["deliveries", listDashboardDeliveriesAction, { state: "due_this_week", channel: "manual" }, { window: "90", state: "due_this_week" }],
  ["vacancies", listDashboardVacanciesAction, { status: "published", sort: "positions_open" }, { window: "90", status: "published", sort: "positions_open" }],
  ["applications", listDashboardApplicationsAction, { from: "2026-11-01", to: "2026-11-01", channel: "manual" }, { window: "90", from: "2026-11-01", to: "2026-11-01", channel: "manual" }],
] as const)("%s list action validates the query again and keeps the window", async (kind, action, query, sent) => {
  vi.mocked(listDashboard).mockResolvedValue({ ok: true, data: { kind, page: {} } } as never);
  expect(await action({ window: 90, query, cursor: "c" })).toEqual({ ok: true, data: { kind, page: {} } });
  const [token, calledKind, params, cursor] = vi.mocked(listDashboard).mock.calls[0];
  expect([token, calledKind, Object.fromEntries(params), cursor]).toEqual(["token", kind, sent, "c"]);
});

it("list actions refuse a malformed cursor and map failures safely", async () => {
  expect(await listDashboardCandidatesAction({ window: 30, query: {}, cursor: "x".repeat(3000) })).toMatchObject({ ok: false, reason: "not_found" });
  expect(listDashboard).not.toHaveBeenCalled();
  vi.mocked(listDashboard).mockResolvedValue({ ok: false, error: { kind: "status", status: 400, retryable: false }, envelope: { error: "private", code: "invalid_cursor" } });
  expect(await listDashboardDeliveriesAction({ window: 30, query: {}, cursor: "c" })).toMatchObject({ ok: false, reason: "invalid_cursor" });
  vi.mocked(getActionAccessToken).mockResolvedValue(null);
  expect(await listDashboardVacanciesAction({ window: 30, query: {} })).toEqual({ ok: false, reason: "unauthenticated", reference: {} });
});
