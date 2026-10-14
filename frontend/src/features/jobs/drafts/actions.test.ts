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
  it("fails closed with no session and never calls either client", async () => {
    vi.mocked(getActionAccessToken).mockResolvedValue(null);
    expect(await saveDraftV2Action(input)).toEqual({ ok: false, reason: "unauthenticated" });
    expect(createDraftV2).not.toHaveBeenCalled();
    expect(saveDraftV2).not.toHaveBeenCalled();
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
    ...([401, 403, 404, 409, 412, 428, 400, 413, 500, 503, 302] as const).map((status) => [
      { kind: "status", status, retryable: false }, undefined,
      ({401:"unauthenticated",403:"forbidden",404:"not_found",409:"uncertain",412:"version_conflict",428:"precondition_required",400:"invalid_request",413:"payload_too_large"} as Record<number,string>)[status] ?? "uncertain",
    ] as [DraftV2Failure["error"], undefined, string]),
    [{kind:"not_found",status:404,retryable:false}, "not_found", "not_found"],
    [{kind:"status",status:403,retryable:false}, "company_inactive", "company_inactive"],
    [{kind:"status",status:409,retryable:false}, "company_not_active", "company_not_active"],
    [{kind:"status",status:409,retryable:false}, "idempotency_conflict", "idempotency_conflict"],
    ...(["network", "timeout", "invalid_response"] as const).map((kind) => [{kind,retryable:false}, undefined, "uncertain"] as [DraftV2Failure["error"],undefined,string]),
  ];
  it.each(failures)("maps failure %j / %s to %s without leaking envelope or retrying", async (error, code, reason) => {
    const failure: DraftV2Failure = { ok: false, error, ...(code ? {envelope:{code,error:"secret-access-token"}} : {}) };
    vi.mocked(createDraftV2).mockResolvedValue(failure);
    vi.mocked(saveDraftV2).mockResolvedValue(failure);
    expect(await saveDraftV2Action(input)).toEqual({ok:false,reason});
    expect(await saveDraftV2Action({...input,draftId:"draft",etag:"tag"})).toEqual({ok:false,reason});
    expect(createDraftV2).toHaveBeenCalledTimes(1);
    expect(saveDraftV2).toHaveBeenCalledTimes(1);
  });
  it("treats a thrown write as uncertain without retry or raw details", async () => {
    vi.mocked(createDraftV2).mockRejectedValue(new Error("secret-access-token"));
    expect(await saveDraftV2Action(input)).toEqual({ok:false,reason:"uncertain"});
    expect(createDraftV2).toHaveBeenCalledTimes(1);
  });
});
