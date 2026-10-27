import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080", apiTimeoutMs: 8000 } }));
import { getSite, putDraft, publishSite, unpublishSite, slugAvailability } from "./client";
import { decodeMediaError } from "./model";
import { defaultSiteDraft } from "../defaults";
const state = () => ({ draft: defaultSiteDraft(), draft_version: 7, published: null, has_unpublished_changes: true, media: [], updated_at: "2026-10-27T00:00:00Z" });
const respond = (body: unknown, status = 200, etag = '"7"') => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { etag } })));
afterEach(() => vi.unstubAllGlobals());
it("GET decodes state and authenticated no-store transport", async () => {
  const data = state(); respond(data); expect(await getSite("token")).toEqual({ kind: "success", data, etag: '"7"' });
  expect(fetch).toHaveBeenCalledWith("http://localhost:8080/v2/me/company/site", expect.objectContaining({ cache: "no-store", redirect: "error", headers: expect.any(Headers) }));
  expect(new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).get("authorization")).toBe("Bearer token");
});
it("PUT sends complete document with If-Match; identical 200 keeps version", async () => {
  const data = state(); respond(data); expect(await putDraft("token", { body: data.draft, ifMatch: '"7"' })).toMatchObject({ kind: "success", data: { draft_version: 7 } });
  const init = vi.mocked(fetch).mock.calls[0][1]!; expect(init.method).toBe("PUT"); expect(new Headers(init.headers).get("if-match")).toBe('"7"'); expect(JSON.parse(init.body as string)).toEqual(data.draft);
});
it("publish uses If-Match and unpublish does not", async () => {
  respond(state()); await publishSite("token", '"7"'); expect(new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).get("if-match")).toBe('"7"');
  await unpublishSite("token"); expect(new Headers(vi.mocked(fetch).mock.calls[1][1]?.headers).has("if-match")).toBe(false);
});
it.each([
  [400, { error: "Invalid", code: "validation_error", fields: [{ field: "slug", code: "invalid" }] }, "invalid"],
  [409, { error: "Taken", code: "slug_taken", field: "slug" }, "error"],
  [422, { error: "Reserved", code: "slug_reserved", field: "slug" }, "error"],
  [422, { error: "Blocked", code: "publish_blocked", issues: [{ code: "slug_missing", field: "slug" }] }, "error"],
  [403, { error: "Forbidden", code: "forbidden" }, "error"],
  [403, { error: "Inactive", code: "company_inactive" }, "error"],
  [428, { error: "Required", code: "precondition_required" }, "error"],
  [413, { error: "Large", code: "payload_too_large" }, "error"],
] as const)("decodes documented %i %j", async (status, body, kind) => {
  respond(body, status); expect(await putDraft("token", { body: state().draft, ifMatch: '"7"' })).toMatchObject({ kind, ...(kind === "error" ? { code: body.code } : { fields: body.fields }) });
});
it.each([
  ["get", () => getSite("token")],
  ["save", () => putDraft("token", { body: state().draft, ifMatch: '\"7\"' })],
  ["publish", () => publishSite("token", '\"7\"')],
  ["unpublish", () => unpublishSite("token")],
  ["availability", () => slugAvailability("token", "nexo")],
] as const)("%s treats HTTP 401 as unauthenticated regardless of envelope", async (_name, call) => {
  for (const body of [{ error: "Expired", code: "unauthenticated" }, {}, null, "invalid JSON"]) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 401 })));
    expect(await call()).toEqual({ kind: "unauthenticated" });
    expect(fetch).toHaveBeenCalledOnce();
  }
});
it("never treats an unauthenticated envelope on a non-401 as authenticated status evidence", async () => {
  respond({ error: "Expired", code: "unauthenticated" }, 403);
  expect(await getSite("token")).toEqual({ kind: "unrecognized" });
});
it.each([{}, { error: "Expired", code: "unauthenticated" }])("media decoder preserves 401 independently of the envelope (%j)", body => {
  expect(decodeMediaError(401, body)).toEqual({ kind: "unauthenticated" });
});
it("PUT decodes backend invalid_request", async () => {
  respond({ error: "Bad request", code: "invalid_request" }, 400);
  expect(await putDraft("token", { body: state().draft, ifMatch: '"7"' })).toEqual({ kind: "error", code: "invalid_request" });
});
it("412 decodes current, never merges", async () => {
  const current = state(); respond({ error: "Conflict", code: "version_conflict", current }, 412); expect(await putDraft("token", { body: current.draft, ifMatch: '"6"' })).toEqual({ kind: "conflict", current });
});
it.each([[200, {}], [200, { ...state(), draft_version: -1 }], [412, { error: "Conflict", code: "version_conflict" }], [400, { error: "Bad", code: "validation_error" }], [403, { error: "Bad", code: "slug_taken", field: "slug" }], [500, { what: "unknown" }]])("unknown or mismatched envelope is unrecognized (%s)", async (status, body) => {
  respond(body, status as number); expect(await getSite("token")).toMatchObject({ kind: "unrecognized" });
});
it("rejects missing/mismatched ETag on successful site state", async () => {
  respond(state(), 200, '"8"'); expect(await getSite("token")).toEqual({ kind: "unrecognized" });
});
it("no response is uncertain, never retried", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network"))); expect(await getSite("token")).toEqual({ kind: "uncertain" }); expect(fetch).toHaveBeenCalledOnce();
});
it("checks availability using an encoded slug", async () => {
  respond({ slug: "nexo-labs", available: true, reason: null }); expect(await slugAvailability("token", "nexo-labs")).toMatchObject({ kind: "success", data: { available: true } }); expect(vi.mocked(fetch).mock.calls[0][0]).toContain("slug-availability?slug=nexo-labs");
});
it.each([[413, "payload_too_large"], [415, "unsupported_media_type"], [422, "image_too_small"], [422, "image_too_large"], [422, "media_limit_reached"]] as const)("typed media error decoder maps %s %s only", (status, code) => {
  expect(decodeMediaError(status, { error: "Image", code })).toEqual({ kind: "error", code }); expect(decodeMediaError(status, {})).toEqual({ kind: "unrecognized" });
});
