import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("./publication-client", () => ({ getDraftPublication: vi.fn(), publishDraft: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { getDraftPublication, publishDraft } from "./publication-client";
import { loadDraftPublicationAction, publishDraftAction } from "./publication-actions";
const input = { draftId: "id", ifMatch: '"draft"', idempotencyKey: "key", body: {} };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getActionAccessToken).mockResolvedValue("secret"); });
it("returns readiness without credentials", async () => { const data = { status: "draft", publishedAt: null, missing: ["future"] } as const; vi.mocked(getDraftPublication).mockResolvedValue({ ok: true, data: { ...data, missing: [...data.missing] } }); expect(await loadDraftPublicationAction("id")).toEqual({ ok: true, publication: data }); });
it("passes key body and draft ETag unchanged", async () => { const data = { id: "id", status: "published", publishedAt: "2026-10-16T12:00:00Z" } as const; vi.mocked(publishDraft).mockResolvedValue({ ok: true, data, idempotencyReplayed: "false" }); expect(await publishDraftAction(input)).toEqual({ ok: true, publication: data }); expect(publishDraft).toHaveBeenCalledExactlyOnceWith({ ...input, token: "secret" }); });
it.each([[422,"publication_incomplete"],[409,"already_published"],[409,"idempotency_conflict"],[412,"version_conflict"]] as const)("maps %s %s", async (status, code) => { vi.mocked(publishDraft).mockResolvedValue({ ok: false, error: { kind: "status", status, retryable: false }, envelope: { error: "unsafe", code, ...(code === "publication_incomplete" ? { missing: ["future"] } : {}) } }); expect(await publishDraftAction(input)).toEqual({ ok: false, reason: code, reference: { status, code }, ...(code === "publication_incomplete" ? { missing: ["future"] } : {}) }); });
it.each([[400, "publication_incomplete"], [409, "publication_incomplete"], [422, "already_published"], [400, "idempotency_conflict"]] as const)("does not classify a publication code on the wrong status %s %s", async (status, code) => {
 vi.mocked(publishDraft).mockResolvedValue({ ok: false, error: { kind: "status", status, retryable: false }, envelope: { error: "unsafe", code, missing: ["title_missing"] } });
 const result = await publishDraftAction(input); expect(result).toEqual({ ok: false, reason: "unrecognized_response", reference: { status, code } }); expect(result).not.toHaveProperty("missing");
});
it("does not call clients without a session", async () => { vi.mocked(getActionAccessToken).mockResolvedValue(null); expect(await publishDraftAction(input)).toMatchObject({ reason: "unauthenticated" }); expect(publishDraft).not.toHaveBeenCalled(); });
it("does not retry a rejected write", async () => { vi.mocked(publishDraft).mockRejectedValue(new Error("unsafe")); expect(await publishDraftAction(input)).toEqual({ ok: false, reason: "no_response", reference: {} }); expect(publishDraft).toHaveBeenCalledTimes(1); });
