import { beforeEach, describe, expect, it, vi } from "vitest";
import { lifecycleSchema, lifecycleLabel, decodeLifecycleEtag } from "./model";
import { getLifecycle, transitionLifecycle } from "./client";
import { mapLifecycleFailure } from "./failure";
import { getLifecycleAction, transitionLifecycleAction } from "./actions";

vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "https://api.example.test", apiTimeoutMs: 1000 } }));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn(async () => "token") }));
import { getActionAccessToken } from "@/lib/auth/action-session";
const id = "11111111-1111-4111-8111-111111111111";
const key = "22222222-2222-4222-8222-222222222222";
const etag = `"vl-${id}-v4"`;
const view = { publication: "closed", process: "active", version: "4", published_at: null, paused_at: null, closed_at: null, process_finished_at: null, allowed_actions: ["reopen", "finish_process"] };
const input = { token: "token", draftId: id, ifMatch: etag, idempotencyKey: key };
const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); vi.mocked(getActionAccessToken).mockResolvedValue("token"); });
function respond(data: unknown = view, status = 200, headers = { etag, "idempotency-replayed": "false" }) { fetchMock.mockImplementation(async () => new Response(JSON.stringify(data), { status, headers })); }

describe("lifecycle contract", () => {
  it.each([
    [null, null, "Borrador"], ["published", "active", "Activa"], ["paused", "active", "Pausada"],
    ["closed", "active", "Cerrada · proceso en curso"], ["closed", "finished", "Cerrada · proceso finalizado"],
  ])("accepts %s/%s", (publication, process, label) => {
    const parsed = lifecycleSchema.parse({ ...view, publication, process, allowed_actions: [] });
    expect(lifecycleLabel(parsed)).toBe(label);
  });
  it.each([{ publication: "paused", process: "finished" }, { publication: null }, { process: null }, { allowed_actions: ["delete"] }, { version: 4 }, { version: "-1" }, { paused_at: 4 }, { extra: true }])("rejects mismatch %j", patch => {
    expect(lifecycleSchema.safeParse({ ...view, ...patch }).success).toBe(false);
  });
  it("requires timestamps and a matching lifecycle ETag", () => {
    const { closed_at: _, ...missing } = view;
    expect(lifecycleSchema.safeParse(missing).success).toBe(false);
    expect(decodeLifecycleEtag(etag, id, "4")).toBe(etag);
    for (const bad of ["", `W/${etag}`, `"draft-${id}-v4"`, `"vl-${key}-v4"`, `"vl-${id}-v5"`]) expect(() => decodeLifecycleEtag(bad, id, "4")).toThrow();
  });
  it("GET uses guarded transport and captures ETag", async () => {
    respond(); expect(await getLifecycle(input)).toMatchObject({ ok: true, data: view, etag });
    expect(fetchMock.mock.calls[0][0]).toBe(`https://api.example.test/v2/me/company/job-drafts/${id}/lifecycle`);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
  });
  it.each([ ["pause", {}], ["resume", {}], ["close", { process: "continue" }], ["close", { process: "finish" }], ["finish_process", {}], ["reopen", {}] ] as const)("POST %s sends intent headers/body", async (action, body) => {
    respond();
    for (let n = 0; n < 2; n++) expect(await transitionLifecycle({ ...input, action, body } as Parameters<typeof transitionLifecycle>[0])).toMatchObject({ ok: true, etag });
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe(`https://api.example.test/v2/me/company/job-drafts/${id}/lifecycle/${action.replace("_", "-")}`);
      expect(init).toMatchObject({ method: "POST", body: JSON.stringify(body), redirect: "error" });
      expect(new Headers(init.headers).get("if-match")).toBe(etag);
      expect(new Headers(init.headers).get("idempotency-key")).toBe(key);
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer token");
    }
  });
  it.each([{ token: "" }, { draftId: "bad" }, { idempotencyKey: "bad" }, { ifMatch: "draft-tag" }, { body: { extra: true } }, { action: "close", body: {} }])("rejects input before transport %j", async patch => {
    expect(await transitionLifecycle({ ...input, action: "pause", body: {}, ...patch } as Parameters<typeof transitionLifecycle>[0])).toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["lifecycle_transition_invalid", "process_finished"])("returns current view for %s", async code => {
    respond({ error: "private message", code, data: { ...(code === "lifecycle_transition_invalid" ? { action: "pause" } : {}), lifecycle: view } }, 409);
    expect(await transitionLifecycleAction({ ...input, action: "pause", body: {} })).toMatchObject({ ok: false, reason: code, lifecycle: view });
  });
  it.each([[412, "version_conflict"], [428, "precondition_required"], [403, "forbidden"], [404, "not_found"], [401, "unauthenticated"], [500, "server_error"]])("maps %s", async (status, reason) => {
    respond({ error: "secret", code: "unknown" }, status as number);
    const result = await transitionLifecycleAction({ ...input, action: "pause", body: {} });
    expect(result).toMatchObject({ ok: false, reason });
    expect(JSON.stringify(result)).not.toContain("secret");
    if (status === 412) expect(result).toMatchObject({ reload: true });
  });
  it("reuses root publication missing, rejects nested missing", async () => {
    respond({ error: "incomplete", code: "publication_incomplete", missing: ["title"] }, 422);
    expect(await transitionLifecycleAction({ ...input, action: "reopen", body: {} })).toMatchObject({ reason: "publication_incomplete", missing: ["title"], message: "Te falta para publicar" });
    respond({ error: "incomplete", code: "publication_incomplete", data: { missing: ["title"] } }, 422);
    expect(await transitionLifecycleAction({ ...input, action: "reopen", body: {} })).toMatchObject({ reason: "unrecognized_response" });
  });
  it("rejects invalid embedded lifecycle and missing success ETag", async () => {
    respond({ error: "bad", code: "process_finished", data: { lifecycle: { ...view, process: null } } }, 409);
    expect(await transitionLifecycleAction({ ...input, action: "pause", body: {} })).toMatchObject({ reason: "unrecognized_response" });
    respond(view, 200, { etag: "", "idempotency-replayed": "false" });
    expect(await getLifecycleAction(id)).toMatchObject({ reason: "unrecognized_response" });
  });
  it("network is uncertain without retries", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await transitionLifecycleAction({ ...input, action: "pause", body: {} })).toMatchObject({ reason: "no_response", uncertain: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mapLifecycleFailure({ ok: false, error: { kind: "timeout", retryable: false } })).toMatchObject({ reason: "no_response", uncertain: true });
  });
  it("fails closed without session", async () => {
    vi.mocked(getActionAccessToken).mockResolvedValue(null);
    expect(await getLifecycleAction(id)).toMatchObject({ reason: "unauthenticated" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
