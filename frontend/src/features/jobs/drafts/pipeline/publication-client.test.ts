import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080/api/v1/", apiTimeoutMs: 8000 } }));
import { getDraftPublication, publishDraft } from "./publication-client";
const draftId = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
const input = { token: " secret ", draftId, ifMatch: '"draft-tag"', idempotencyKey: draftId, body: {} };
const readiness = { status: "draft", publishedAt: null, missing: ["future_code"] };
const published = { id: draftId, status: "published", publishedAt: "2026-10-16T12:00:00Z" };
function respond(data: unknown, status = 200, headers = {}) { const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(data), { status, headers })); vi.stubGlobal("fetch", fetch); return fetch; }
afterEach(() => vi.unstubAllGlobals());
it("GET uses absolute v2 private no-store and accepts unknown missing codes", async () => {
 const fetch = respond(readiness); expect(await getDraftPublication(input)).toEqual({ ok: true, data: readiness });
 expect(fetch.mock.calls[0][0]).toBe(`http://localhost:8080/v2/me/company/job-drafts/${draftId}/publication`);
 expect(fetch.mock.calls[0][1]).toMatchObject({ cache: "no-store", redirect: "error" });
});
it.each([{ ...readiness, extra: true }, { status: "paused", publishedAt: null, missing: [] }, { ...readiness, publishedAt: "2026-02-30" }, { ...readiness, publishedAt: undefined }, { ...readiness, missing: [""] }, { ...readiness, missing: [" "] }, { ...readiness, missing: null }])("rejects readiness shape %#", async value => { respond(value); expect(await getDraftPublication(input)).toMatchObject({ ok: false, error: { kind: "invalid_response" } }); });
it("POST sends exactly {} with caller key and draft ETag, accepts replay", async () => {
 const fetch = respond(published, 201, { "Idempotency-Replayed": "true" }); expect(await publishDraft(input)).toEqual({ ok: true, data: published, idempotencyReplayed: "true" });
 const init = fetch.mock.calls[0][1]; expect(init.method).toBe("POST"); expect(init.body).toBe("{}"); expect(new Headers(init.headers).get("if-match")).toBe(input.ifMatch); expect(new Headers(init.headers).get("idempotency-key")).toBe(draftId); expect(fetch).toHaveBeenCalledTimes(1);
});
it.each([{ ...published, extra: 1 }, { ...published, id: "223e4567-e89b-42d3-a456-426614174000" }, { ...published, status: "draft" }, { ...published, publishedAt: null }, { ...published, publishedAt: "bad" }])("rejects publish response %#", async value => { respond(value, 201); expect(await publishDraft(input)).toMatchObject({ ok: false }); });
it.each([{ ...input, body: { unexpected: true } }, { ...input, idempotencyKey: "bad" }, { ...input, ifMatch: " " }, { ...input, token: " " }, { ...input, draftId: "bad" }])("guards invalid input %#", async value => { const fetch = respond(published, 201); expect(await publishDraft(value)).toMatchObject({ ok: false }); expect(fetch).not.toHaveBeenCalled(); });
it("preserves missing only for strict publication_incomplete", async () => {
 const envelope = { error: "unsafe", code: "publication_incomplete", missing: ["future"] }; respond(envelope, 422); expect(await publishDraft(input)).toMatchObject({ ok: false, envelope });
});
it.each([{ error: "unsafe", code: "other", missing: ["title_missing"] }, { error: "unsafe", code: "publication_incomplete" }, { error: "unsafe", code: "publication_incomplete", missing: [""] }, { error: "unsafe", code: "publication_incomplete", missing: [], extra: true }])("drops malformed error envelope %#", async value => { respond(value, 422); expect(await publishDraft(input)).not.toHaveProperty("envelope"); });
it("does not automatically retry uncertain writes", async () => { const fetch = vi.fn().mockRejectedValue(new Error("offline")); vi.stubGlobal("fetch", fetch); expect(await publishDraft(input)).toMatchObject({ ok: false, error: { kind: "network", retryable: false } }); expect(fetch).toHaveBeenCalledTimes(1); });
