// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/company/manual-candidates/[vacancyId]/route";
import { getActionAccessToken } from "@/lib/auth/action-session";
import { item, board, id } from "@/features/pipeline-movement/test-fixtures";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "https://api.example.test", apiTimeoutMs: 5000 } }));
const fetcher = vi.fn();
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", fetcher); vi.mocked(getActionAccessToken).mockResolvedValue("server-token"); });
const context = { params: Promise.resolve({ vacancyId: id(9) }) };
function request(extra = false) {
 const body = new FormData(); body.append("data", JSON.stringify({ stage_id: id(1), existing: { kind: "manual", id: id(11) }, confirmed_distinct: false, candidate: null }));
 body.append("cv", new File(["%PDF"], "cv.pdf", { type: "application/pdf" })); if (extra) body.append("secret", "ignored");
 return new Request(`https://app.example.test/api/company/manual-candidates/${id(9)}`, { method: "POST", body, headers: { "Idempotency-Key": id(55) } });
}
it("forwards only data and cv with server bearer and stable key", async () => {
 fetcher.mockResolvedValue(Response.json({ ...item, source: "manual", added_by: { id: id(99), name: "Luis" }, candidate: { ...item.candidate, kind: "manual" }, coverage: board.coverage, delivery: board.delivery }, { status: 201 }));
 const result = await POST(request(), context); expect(result.status).toBe(201);
 const [url, init] = fetcher.mock.calls[0]; expect(String(url)).toContain(`/v2/me/company/job-drafts/${id(9)}/pipeline/candidates/manual`);
 expect(new Headers(init.headers).get("authorization")).toBe("Bearer server-token");
 expect(new Headers(init.headers).get("idempotency-key")).toBe(id(55)); expect([...init.body.keys()]).toEqual(["data", "cv"]);
 expect(result.headers.get("cache-control")).toBe("no-store");
});
it.each([
 [400, { error: "validation failed", code: "validation_error", fields: [{ field: "candidate.phone", code: "invalid" }] }],
 [409, { error: "already present", code: "candidate_already_in_process", data: { participation_id: id(10) } }],
 [409, { error: "possible duplicates", code: "possible_duplicates", data: { matches: [] } }],
] as const)("preserves the contracted %s error body", async (status, body) => {
 fetcher.mockResolvedValue(Response.json(body, { status })); const response = await POST(request(), context);
 expect(response.status).toBe(status); expect(await response.json()).toEqual(body);
});
it("requires session and a UUID idempotency key", async () => {
 vi.mocked(getActionAccessToken).mockResolvedValueOnce(null); expect((await POST(request(), context)).status).toBe(401);
 const req = request(); req.headers.delete("idempotency-key"); expect((await POST(req, context)).status).toBe(400); expect(fetcher).not.toHaveBeenCalled();
});
it("rejects unexpected multipart parts", async () => { expect((await POST(request(true), context)).status).toBe(400); expect(fetcher).not.toHaveBeenCalled(); });
it("cuts an oversized streamed body without relying on Content-Length", async () => {
 const req = new Request(`https://app.example.test/api/company/manual-candidates/${id(9)}`, { method: "POST", body: new Uint8Array(5_242_880 + 65_537), headers: { "content-type": "multipart/form-data; boundary=x", "Idempotency-Key": id(55) } });
 expect((await POST(req, context)).status).toBe(413); expect(fetcher).not.toHaveBeenCalled();
});
it("rejects cross-site requests before authentication", async () => { const req = request(); req.headers.set("origin", "https://evil.test"); expect((await POST(req, context)).status).toBe(403); expect(getActionAccessToken).not.toHaveBeenCalled(); });
