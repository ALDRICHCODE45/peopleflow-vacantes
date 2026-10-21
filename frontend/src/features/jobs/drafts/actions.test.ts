import { beforeEach, describe, expect, it, vi } from "vitest";
import { getActionAccessToken } from "@/lib/auth/action-session";
import { createDraftV2, saveDraftV2, type DraftV2Failure } from "./api/client-v2";
import { saveDraftV2Action } from "./actions";

vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("./api/client-v2", () => ({ createDraftV2: vi.fn(), saveDraftV2: vi.fn() }));
const input = { body: { fields: {} }, idempotencyKey: "key" };
const data = { id: "draft", version: "2", updated_at: "2026-10-06T03:00:00Z" };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getActionAccessToken).mockResolvedValue("secret-access-token");
});
describe("saveDraftV2Action", () => {
  it.each([false, true])("carries validation field paths without raw messages (existing=%s)", async existing => {
    const fields = [{ field: "fields.languages[1].min_level", code: "invalid" as const }];
    const failure = { ok: false, error: { kind: "status", status: 400, retryable: false }, envelope: { code: "validation_error", error: "unsafe", fields } } as const;
    vi.mocked(createDraftV2).mockResolvedValue({ ...failure, envelope: { ...failure.envelope, fields } });
    vi.mocked(saveDraftV2).mockResolvedValue({ ...failure, envelope: { ...failure.envelope, fields } });
    expect(await saveDraftV2Action({ ...input, ...(existing ? { draftId: "draft", etag: "tag" } : {}) })).toEqual({ ok: false, reason: "invalid_request", fields, reference: { status: 400, code: "validation_error" } });
  });
  it("carries safe geography issues to the matching controls for 422", async () => {
    const geography = { location: [{ field: "municipality", reason: "unknown" }], remoteScope: [] } as const;
    vi.mocked(saveDraftV2).mockResolvedValue({ ok: false, error: { kind: "status", status: 422, retryable: false }, envelope: { code: "invalid_location", error: "unsafe", geography } } as never);
    expect(await saveDraftV2Action({ ...input, draftId: "draft", etag: "tag" })).toEqual({ ok: false, reason: "invalid_request", geography, reference: { status: 422, code: "invalid_location" } });
  });
  it("fails closed with no session and never calls either client", async () => {
    vi.mocked(getActionAccessToken).mockResolvedValue(null);
    expect(await saveDraftV2Action(input)).toEqual({ ok: false, reason: "unauthenticated", reference: {} });
    expect(createDraftV2).not.toHaveBeenCalled();
    expect(saveDraftV2).not.toHaveBeenCalled();
  });
  it("returns a serializable failure when session resolution throws", async () => {
    vi.mocked(getActionAccessToken).mockRejectedValue(new Error("secret-access-token"));
    expect(await saveDraftV2Action(input)).toEqual({ok:false,reason:"no_response",reference:{}});
    expect(createDraftV2).not.toHaveBeenCalled();
  });
  it("fails closed on a blank session without network", async () => {
    vi.mocked(getActionAccessToken).mockResolvedValue("  ");
    expect(await saveDraftV2Action(input)).toEqual({ok:false,reason:"unauthenticated",reference:{}});
    expect(createDraftV2).not.toHaveBeenCalled();
  });
  it("creates with exact credential/key/body and returns only serializable save metadata", async () => {
    vi.mocked(createDraftV2).mockResolvedValue({ ok: true, data, etag: '"opaque"', idempotencyReplayed: "true" } as never);
    const result = await saveDraftV2Action(input);
    expect(createDraftV2).toHaveBeenCalledExactlyOnceWith({ token: "secret-access-token", ...input });
    expect(saveDraftV2).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, draftId: "draft", version: "2", savedAt: data.updated_at, etag: '"opaque"', replayed: true });
    expect(JSON.stringify(result)).not.toContain("secret-access-token");
  });
  it("saves the same draft with opaque If-Match, not create", async () => {
    vi.mocked(saveDraftV2).mockResolvedValue({ ok: true, data, etag: '"next"' } as never);
    expect(await saveDraftV2Action({ ...input, draftId: "draft", etag: '"previous"' })).toEqual({ ok: true, draftId: "draft", version: "2", savedAt: data.updated_at, etag: '"next"' });
    expect(saveDraftV2).toHaveBeenCalledExactlyOnceWith({ token: "secret-access-token", id: "draft", ifMatch: '"previous"', body: input.body });
    expect(createDraftV2).not.toHaveBeenCalled();
  });
  const failures: [DraftV2Failure["error"], string | undefined, string][] = [
    [{ kind: "missing_token", retryable: false }, undefined, "unauthenticated"],
    [{ kind: "invalid_request", retryable: false }, undefined, "invalid_request"],
    ...([401, 403, 404, 409, 412, 428, 400, 413, 500, 502, 302] as const).map((status) => [
      { kind: "status", status, retryable: false }, undefined,
      ({401:"unauthenticated",403:"forbidden",404:"not_found",409:"unrecognized_response",412:"version_conflict",428:"precondition_required",400:"invalid_request",413:"payload_too_large"} as Record<number,string>)[status] ?? (status >= 500 ? "server_error" : "unrecognized_response"),
    ] as [DraftV2Failure["error"], undefined, string]),
    [{kind:"status",status:500,retryable:false}, "internal_error", "server_error"],
    [{kind:"not_found",status:404,retryable:false}, "not_found", "not_found"],
    [{kind:"status",status:403,retryable:false}, "company_inactive", "company_inactive"],
    [{kind:"status",status:409,retryable:false}, "company_not_active", "company_not_active"],
    [{kind:"status",status:409,retryable:false}, "idempotency_conflict", "idempotency_conflict"],
    ...(["network", "timeout", "invalid_response"] as const).map((kind) => [{kind,retryable:false}, undefined, kind === "invalid_response" ? "unrecognized_response" : "no_response"] as [DraftV2Failure["error"],undefined,string]),
  ];
  it.each(failures)("maps failure %j / %s to %s without leaking envelope or retrying", async (error, code, reason) => {
    const failure: DraftV2Failure = { ok: false, error, ...(code ? {envelope:{code,error:"secret-access-token"}} : {}) };
    vi.mocked(createDraftV2).mockResolvedValue(failure);
    vi.mocked(saveDraftV2).mockResolvedValue(failure);
    const expected = {ok:false,reason,reference:{...("status" in error ? {status:error.status} : {}), ...(code ? {code} : {})}};
    expect(await saveDraftV2Action(input)).toEqual(expected);
    expect(await saveDraftV2Action({...input,draftId:"draft",etag:"tag"})).toEqual(expected);
    expect(createDraftV2).toHaveBeenCalledTimes(1);
    expect(saveDraftV2).toHaveBeenCalledTimes(1);
  });
  it("carries publication missing codes for PATCH without retry or raw message", async () => {
    const missing = ["title_missing", "future"];
    vi.mocked(saveDraftV2).mockResolvedValue({ ok: false, error: { kind: "status", status: 422, retryable: false }, envelope: { error: "unsafe", code: "publication_incomplete", missing } });
    expect(await saveDraftV2Action({ ...input, draftId: "draft", etag: "tag" })).toEqual({ ok: false, reason: "publication_incomplete", missing, reference: { status: 422, code: "publication_incomplete" } });
    expect(saveDraftV2).toHaveBeenCalledTimes(1);
    expect(createDraftV2).not.toHaveBeenCalled();
  });
  it.each([
    [422, { error: "unsafe", code: "other", missing: ["title_missing"] }],
    [422, { error: "unsafe", code: "publication_incomplete" }],
    [422, { error: "unsafe", code: "publication_incomplete", missing: [" "] }],
    [409, { error: "unsafe", code: "publication_incomplete", missing: ["title_missing"] }],
  ] as const)("does not classify a non-publication or malformed 422 %#", async (status, envelope) => {
    vi.mocked(saveDraftV2).mockResolvedValue({ ok: false, error: { kind: "status", status, retryable: false }, envelope } as never);
    expect(await saveDraftV2Action({ ...input, draftId: "draft", etag: "tag" })).toMatchObject({ ok: false, reason: "unrecognized_response" });
  });
  it("treats a thrown write as uncertain without retry or raw details", async () => {
    vi.mocked(createDraftV2).mockRejectedValue(new Error("secret-access-token"));
    expect(await saveDraftV2Action(input)).toEqual({ok:false,reason:"no_response",reference:{}});
    expect(createDraftV2).toHaveBeenCalledTimes(1);
  });
});
