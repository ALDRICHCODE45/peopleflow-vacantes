import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "https://api.example.test", apiTimeoutMs: 100 } }));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import {
  getCandidatePreferencesAction, getPreferencesAction, updateCandidatePreferencesAction, updatePreferencesAction,
} from "./actions";
import type { PreferenceEntry } from "./model";
import { candidatePreferences, memberPreferences, preferenceItem } from "./test-fixtures";

const fetchMock = vi.fn();
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", fetchMock); vi.mocked(getActionAccessToken).mockResolvedValue(" private-token "); });
afterEach(() => vi.unstubAllGlobals());
const envelope = (status: number, code: string, extra: object = {}) => Response.json({ error: "private backend message", code, ...extra }, { status });
const requested = (call = 0) => {
  const [url, init] = fetchMock.mock.calls[call];
  return { url: new URL(String(url)), method: init.method, headers: new Headers(init.headers), body: init.body === undefined ? undefined : JSON.parse(init.body), redirect: init.redirect };
};
const entry = (type: string, channel: "in_app" | "email", enabled: boolean): PreferenceEntry => ({ type, channel, enabled });

describe("GET preferences (L21)", () => {
  it("reads the member catalog with the session token and decodes it", async () => {
    fetchMock.mockResolvedValue(Response.json(memberPreferences()));
    expect(await getPreferencesAction()).toEqual({ ok: true, data: memberPreferences() });
    const { url, method, headers, redirect } = requested();
    expect(url.toString()).toBe("https://api.example.test/v2/me/company/notifications/preferences");
    expect(method ?? "GET").toBe("GET");
    expect(headers.get("authorization")).toBe("Bearer private-token");
    expect(redirect).toBe("error");
  });

  it("reads the candidate catalog on its own path", async () => {
    fetchMock.mockResolvedValue(Response.json(candidatePreferences()));
    expect(await getCandidatePreferencesAction()).toEqual({ ok: true, data: candidatePreferences() });
    expect(requested().url.pathname).toBe("/v2/me/notifications/preferences");
  });

  it("keeps an unknown future type and kind, and strips unknown fields", async () => {
    const future = { ...preferenceItem("something_new", "digest_only"), extra: 1 };
    fetchMock.mockResolvedValue(Response.json({ ...memberPreferences({ items: [future] }), stage3: true }));
    const result = await getPreferencesAction();
    expect(result).toEqual({ ok: true, data: memberPreferences({ items: [preferenceItem("something_new", "digest_only")] }) });
  });

  it("refuses a malformed catalog as an unrecognized response", async () => {
    fetchMock.mockResolvedValue(Response.json({ channels: ["in_app", "email"], email_deliverable: "yes", items: [] }));
    expect(await getPreferencesAction()).toMatchObject({ ok: false, reason: "unrecognized_response" });
  });

  it.each([
    [401, "unauthenticated", "unauthenticated"], [403, "forbidden", "forbidden"], [403, "account_required", "forbidden"],
    [500, "internal_error", "server_error"],
  ] as const)("maps %i %s to %s", async (status, code, reason) => {
    fetchMock.mockResolvedValue(envelope(status, code));
    expect(await getCandidatePreferencesAction()).toEqual({ ok: false, reason, reference: { status, code } });
  });

  it("maps a network failure to no_response and a missing token to unauthenticated without a request", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    expect(await getPreferencesAction()).toMatchObject({ ok: false, reason: "no_response" });
    fetchMock.mockClear();
    vi.mocked(getActionAccessToken).mockResolvedValue(null);
    expect(await getPreferencesAction()).toEqual({ ok: false, reason: "unauthenticated", reference: {} });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("PUT preferences (L21)", () => {
  it("sends a JSON PUT with exactly the preferences body and renders the returned catalog", async () => {
    const answer = memberPreferences({ items: [preferenceItem("application_received", "operational", false, { email: true })] });
    fetchMock.mockResolvedValue(Response.json(answer));
    const entries = [entry("application_received", "email", true), entry("psychometric_pending", "in_app", false)];
    expect(await updatePreferencesAction(entries, memberPreferences())).toEqual({ ok: true, data: answer });
    const { url, method, headers, body, redirect } = requested();
    expect(url.toString()).toBe("https://api.example.test/v2/me/company/notifications/preferences");
    expect(method).toBe("PUT");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("authorization")).toBe("Bearer private-token");
    expect(redirect).toBe("error");
    expect(body).toEqual({ preferences: entries });
  });

  it("drops keys outside the contract from each entry and accepts 28 entries", async () => {
    fetchMock.mockImplementation(async () => Response.json(candidatePreferences()));
    await updateCandidatePreferencesAction([{ ...entry("candidate_test_pending", "email", false), scope: "company" } as PreferenceEntry]);
    expect(requested(0).url.pathname).toBe("/v2/me/notifications/preferences");
    expect(requested(0).body).toEqual({ preferences: [entry("candidate_test_pending", "email", false)] });
    const many = Array.from({ length: 14 }, (_, i) => [entry(`type_${i}`, "in_app", true), entry(`type_${i}`, "email", false)]).flat();
    expect(await updatePreferencesAction(many)).toMatchObject({ ok: true });
  });

  it("refuses an out-of-contract body locally, named like the backend's validation_error", async () => {
    const cases: [unknown, { field: string; code: string }[]][] = [
      [undefined, [{ field: "preferences", code: "required" }]],
      [[], [{ field: "preferences", code: "empty" }]],
      [Array.from({ length: 29 }, (_, i) => entry(`type_${i}`, "email", true)), [{ field: "preferences", code: "too_many" }]],
      [[{ channel: "email", enabled: true }], [{ field: "preferences[0].type", code: "required" }]],
      [[entry("Not A Type", "email", true)], [{ field: "preferences[0].type", code: "invalid" }]],
      [[entry("application_received", "sms" as "email", true)], [{ field: "preferences[0].channel", code: "invalid" }]],
      [[{ type: "application_received", channel: "email" }], [{ field: "preferences[0].enabled", code: "required" }]],
      [[{ type: "application_received", channel: "email", enabled: "yes" }], [{ field: "preferences[0].enabled", code: "invalid" }]],
      [[null], [{ field: "preferences[0]", code: "invalid" }]],
      [[entry("application_received", "email", true), entry("application_received", "email", false)], [{ field: "preferences[1]", code: "duplicate" }]],
    ];
    for (const [input, fields] of cases) {
      expect(await updatePreferencesAction(input as PreferenceEntry[]), JSON.stringify(input)).toEqual({ ok: false, reason: "validation_error", fields, reference: {} });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never sends an entry whose pair is locked in the catalog it was built from", async () => {
    const entries = [entry("application_received", "email", true), entry("delivery_overdue", "email", false), entry("vacancy_assigned", "in_app", true)];
    expect(await updatePreferencesAction(entries, memberPreferences())).toEqual({
      ok: false, reason: "preference_locked", lockedTypes: ["delivery_overdue", "vacancy_assigned"], reference: {},
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps 422 notification_preference_locked with data.types and keeps only well-formed type names", async () => {
    fetchMock.mockResolvedValue(envelope(422, "notification_preference_locked", { data: { types: ["delivery_overdue", "<b>x</b>", 3] } }));
    expect(await updatePreferencesAction([entry("delivery_overdue", "email", false)])).toEqual({
      ok: false, reason: "preference_locked", lockedTypes: ["delivery_overdue"], reference: { status: 422, code: "notification_preference_locked" },
    });
  });

  it("maps the backend's 400 validation_error with its preference fields, dropping anything else", async () => {
    fetchMock.mockResolvedValue(envelope(400, "validation_error", { fields: [
      { field: "preferences[1].type", code: "invalid" }, { field: "preferences[0]", code: "duplicate" },
      { field: "preferences", code: "too_many" }, { field: "secret", code: "invalid" }, { field: "preferences[0].type", code: "weird" },
    ] }));
    expect(await updatePreferencesAction([entry("application_received", "email", true)])).toEqual({
      ok: false, reason: "validation_error", reference: { status: 400, code: "validation_error" },
      fields: [{ field: "preferences[1].type", code: "invalid" }, { field: "preferences[0]", code: "duplicate" }, { field: "preferences", code: "too_many" }],
    });
  });

  it.each([
    [401, "unauthenticated", "unauthenticated"], [403, "company_inactive", "forbidden"], [403, "wrong_role", "forbidden"],
    [503, "internal_error", "server_error"], [400, "invalid_request", "unrecognized_response"], [413, "payload_too_large", "unrecognized_response"],
  ] as const)("maps %i %s to %s", async (status, code, reason) => {
    fetchMock.mockResolvedValue(envelope(status, code));
    expect(await updateCandidatePreferencesAction([entry("candidate_status_changed", "email", false)])).toMatchObject({ ok: false, reason, reference: { status, code } });
  });

  it("maps a timeout or network failure to no_response", async () => {
    fetchMock.mockRejectedValue(new TypeError("network down"));
    expect(await updatePreferencesAction([entry("application_received", "email", true)])).toMatchObject({ ok: false, reason: "no_response" });
  });
});
