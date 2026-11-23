// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080/api/v1/", apiTimeoutMs: 1000 } }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { downloadDocument, downloadDocumentLink, downloadDocumentVersion, replaceDocument, uploadDocument } from "./route-handlers";
import { DOCUMENT_REQUEST_CAP_BYTES } from "./model";
import { formatsWire, ids, itemWire, scopeWire } from "./test-fixtures";

const V = `http://localhost:8080/v2/me/company/job-drafts/${ids.draft}`;
const P = `${V}/participations/${ids.participation}`;
const boundary = "----test";
const multipart = `multipart/form-data; boundary=${boundary}`;
const idem = ids.idemToken;
const created = () => Response.json({ item: itemWire(), scope: scopeWire() }, { status: 201, headers: { "idempotency-replayed": "false" } });
const fetchMock = vi.fn();

/** A POST whose body is a stream of `bytes` (so there is no declared content-length unless the test sets one). */
function post(bytes: Uint8Array | string, headers: Record<string, string> = {}) {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let at = 0; at < data.byteLength; at += 1_048_576) controller.enqueue(data.subarray(at, at + 1_048_576));
      controller.close();
    },
  });
  return new Request("http://localhost/api/company/job-drafts/x/documents", { method: "POST", body, headers: { "content-type": multipart, ...headers }, duplex: "half" } as RequestInit);
}
async function drain(body: unknown): Promise<number> {
  let total = 0;
  for await (const chunk of body as AsyncIterable<Uint8Array>) total += chunk.byteLength;
  return total;
}
const lastCall = () => { const [url, init] = fetchMock.mock.calls.at(-1)!; return { url: String(url), init, headers: Object.fromEntries(new Headers(init.headers)) }; };

beforeEach(() => {
  vi.mocked(getActionAccessToken).mockResolvedValue("private-token");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("upload", () => {
  it("streams the multipart body as is with only the server Bearer, the boundary and the Idempotency-Key, and answers 201 {item, scope}", async () => {
    fetchMock.mockImplementation(async (_url, init) => { expect(await drain(init.body)).toBe(11); return created(); });
    const response = await uploadDocument(post("hello world", { "idempotency-key": idem, cookie: "private-cookie" }), { draftId: ids.draft });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ item: { name: "Contrato marco" }, scope: { can_manage: true } });
    expect(response.headers.get("idempotency-replayed")).toBe("false");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { url, init, headers } = lastCall();
    expect(url).toBe(`${V}/documents`);
    expect(init).toMatchObject({ method: "POST", cache: "no-store", redirect: "error", duplex: "half" });
    expect(headers).toEqual({ accept: "application/json", authorization: "Bearer private-token", "content-type": multipart, "idempotency-key": idem });
  });
  it("forwards a participation upload to V/participations/{pid}/documents and relays a replay", async () => {
    fetchMock.mockImplementation(async (_url, init) => { await drain(init.body); return Response.json({ item: itemWire({ participation_id: ids.participation }), scope: scopeWire() }, { status: 201, headers: { "idempotency-replayed": "true" } }); });
    const response = await uploadDocument(post("x", { "idempotency-key": idem }), { draftId: ids.draft, participationId: ids.participation });
    expect(response.headers.get("idempotency-replayed")).toBe("true");
    expect(lastCall().url).toBe(`${P}/documents`);
  });
  it("sends no Idempotency-Key and projects no replay header when the client sent none", async () => {
    fetchMock.mockImplementation(async (_url, init) => { await drain(init.body); return created(); });
    const response = await uploadDocument(post("x"), { draftId: ids.draft });
    expect(lastCall().headers).not.toHaveProperty("idempotency-key");
    expect(response.headers.has("idempotency-replayed")).toBe(false);
  });
  it.each(["", "not-a-uuid", `${idem}, ${idem}`])("rejects the Idempotency-Key %j with 400 invalid_idempotency_key before the body is read", async value => {
    const response = await uploadDocument(post("x", { "idempotency-key": value }), { draftId: ids.draft });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_idempotency_key", code: "invalid_idempotency_key" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("answers 401 without a session and never calls the backend", async () => {
    vi.mocked(getActionAccessToken).mockResolvedValue(null);
    const response = await uploadDocument(post("x"), { draftId: ids.draft });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated", code: "unauthenticated" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("answers 403 to a cross-site request", async () => {
    expect((await uploadDocument(post("x", { origin: "https://evil.example" }), { draftId: ids.draft })).status).toBe(403);
    expect((await uploadDocument(post("x", { "sec-fetch-site": "cross-site" }), { draftId: ids.draft })).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    ["a malformed draft id", { draftId: `${ids.draft}\n` }],
    ["a malformed participation id", { draftId: ids.draft, participationId: "nope" }],
  ])("answers 404 for %s without a request", async (_name, params) => {
    const response = await uploadDocument(post("x"), params);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found", code: "not_found" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("answers 413 with the same data.max_bytes envelope when content-length is over the cap (10 485 760 + 65 536)", async () => {
    expect(DOCUMENT_REQUEST_CAP_BYTES).toBe(10_551_296);
    const response = await uploadDocument(post("x", { "content-length": String(10_551_297) }), { draftId: ids.draft });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "payload_too_large", code: "payload_too_large", data: { max_bytes: 10485760 } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("answers 413 with the same envelope when the streamed bytes go over the cap and stops reading", async () => {
    let read = 0;
    fetchMock.mockImplementation(async (_url, init) => { for await (const chunk of init.body as AsyncIterable<Uint8Array>) read += chunk.byteLength; return created(); });
    const response = await uploadDocument(post(new Uint8Array(10_551_297)), { draftId: ids.draft });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "payload_too_large", code: "payload_too_large", data: { max_bytes: 10485760 } });
    expect(read).toBeLessThanOrEqual(10_551_296);
  });
  it("lets a body of exactly the cap through", async () => {
    fetchMock.mockImplementation(async (_url, init) => { expect(await drain(init.body)).toBe(10_551_296); return created(); });
    expect((await uploadDocument(post(new Uint8Array(10_551_296)), { draftId: ids.draft })).status).toBe(201);
  });
  it("accepts a declared content-length equal to the cap and rejects a malformed one", async () => {
    fetchMock.mockImplementation(async (_url, init) => { await drain(init.body); return created(); });
    expect((await uploadDocument(post("x", { "content-length": "10551296" }), { draftId: ids.draft })).status).toBe(201);
    expect((await uploadDocument(post("x", { "content-length": "12abc" }), { draftId: ids.draft })).status).toBe(400);
  });
  it.each([["application/json"], ["text/plain"], ["multipart/mixed; boundary=x"], [""]])("rejects the content type %j with 400 invalid_request", async type => {
    const response = await uploadDocument(post("x", { "content-type": type }), { draftId: ids.draft });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request", code: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    [415, { code: "unsupported_media_type", data: { formats: formatsWire() } }],
    [400, { code: "document_content_mismatch", data: { detected_format: "docx", extension: ".pdf" } }],
    [400, { code: "validation_error", fields: [{ field: "file", code: "empty" }] }],
    [409, { code: "document_limit_reached", data: { kind: "documents", limit: 50 } }],
    [413, { code: "payload_too_large", data: { max_bytes: 10485760 } }],
    [503, { code: "document_storage_unavailable" }],
    [404, { code: "team_access_ended" }],
    [403, { code: "forbidden" }],
    [409, { code: "idempotency_conflict" }],
  ])("relays the backend %s %j with its data and without the backend text", async (status, envelope) => {
    fetchMock.mockImplementation(async (_url, init) => { await drain(init.body); return Response.json({ error: "private-token detail", ...envelope }, { status }); });
    const response = await uploadDocument(post("x"), { draftId: ids.draft });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: envelope.code, code: envelope.code, ...("data" in envelope ? { data: envelope.data } : {}), ...("fields" in envelope ? { fields: envelope.fields } : {}) });
  });
  it("hides an unknown code and an unknown 5xx behind a generic one", async () => {
    fetchMock.mockImplementation(async (_url, init) => { await drain(init.body); return Response.json({ error: "private-token", code: "mystery" }, { status: 500 }); });
    const response = await uploadDocument(post("x"), { draftId: ids.draft });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "server_error", code: "server_error" });
  });
  it("answers 502 when the 201 is not the contract's {item, scope}", async () => {
    fetchMock.mockImplementation(async (_url, init) => { await drain(init.body); return Response.json({ item: itemWire() }, { status: 201 }); });
    const response = await uploadDocument(post("x"), { draftId: ids.draft });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "unrecognized_response", code: "unrecognized_response" });
  });
  it("answers 503 no_response when the backend is unreachable", async () => {
    fetchMock.mockImplementation(async (_url, init) => { await drain(init.body); throw new Error("ECONNREFUSED private-token"); });
    const response = await uploadDocument(post("x"), { draftId: ids.draft });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "no_response", code: "no_response" });
  });
});

describe("replace", () => {
  it("posts the multipart to V/documents/{doc}/versions and never forwards an Idempotency-Key", async () => {
    fetchMock.mockImplementation(async (_url, init) => { await drain(init.body); return created(); });
    const response = await replaceDocument(post("x", { "idempotency-key": idem }), { draftId: ids.draft, documentId: ids.document });
    expect(response.status).toBe(201);
    expect(response.headers.has("idempotency-replayed")).toBe(false);
    const { url, headers } = lastCall();
    expect(url).toBe(`${V}/documents/${ids.document}/versions`);
    expect(headers).toEqual({ accept: "application/json", authorization: "Bearer private-token", "content-type": multipart });
    await replaceDocument(post("x"), { draftId: ids.draft, participationId: ids.participation, documentId: ids.document });
    expect(lastCall().url).toBe(`${P}/documents/${ids.document}/versions`);
  });
  it("relays document_version_conflict with data.current_version", async () => {
    fetchMock.mockImplementation(async (_url, init) => { await drain(init.body); return Response.json({ error: "x", code: "document_version_conflict", data: { current_version: 3 } }, { status: 409 }); });
    const response = await replaceDocument(post("x"), { draftId: ids.draft, documentId: ids.document });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "document_version_conflict", code: "document_version_conflict", data: { current_version: 3 } });
  });
  it("answers 413 over the cap and 404 for a malformed document id", async () => {
    expect((await replaceDocument(post("x", { "content-length": "10551297" }), { draftId: ids.draft, documentId: ids.document })).status).toBe(413);
    expect((await replaceDocument(post("x"), { draftId: ids.draft, documentId: "../x" })).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("downloads", () => {
  const disposition = "attachment; filename*=utf-8''Informe%20a%C3%B1o%202026.pdf";
  const file = (extra: Record<string, string> = {}) => new Response("%PDF-bytes", { headers: {
    "content-type": "application/pdf", "content-disposition": disposition, "x-content-type-options": "nosniff", "cache-control": "no-store", "content-length": "10", "set-cookie": "private-cookie", ...extra,
  } });

  it("streams the current file passing through Content-Disposition (filename*), Content-Type, nosniff, no-store and Content-Length", async () => {
    fetchMock.mockImplementation(async () => file());
    const response = await downloadDocument({ draftId: ids.draft, documentId: ids.document });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("%PDF-bytes");
    expect(Object.fromEntries(response.headers)).toEqual({
      "cache-control": "no-store", "content-type": "application/pdf", "content-disposition": disposition, "x-content-type-options": "nosniff", "content-length": "10",
    });
    const { url, init, headers } = lastCall();
    expect(url).toBe(`${V}/documents/${ids.document}/file`);
    expect(init).toMatchObject({ method: "GET", cache: "no-store", redirect: "error" });
    expect(headers).toEqual({ authorization: "Bearer private-token" });
  });
  it("forces nosniff and no-store even if the backend omitted them, and sends no length it was not given", async () => {
    fetchMock.mockImplementation(async () => new Response("x", { headers: { "content-type": "image/png", "content-disposition": 'attachment; filename="a.png"' } }));
    const response = await downloadDocument({ draftId: ids.draft, documentId: ids.document });
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.has("content-length")).toBe(false);
  });
  it("routes the participation scope, a numbered version and a link file to their backend paths", async () => {
    fetchMock.mockImplementation(async () => file());
    await downloadDocument({ draftId: ids.draft, participationId: ids.participation, documentId: ids.document });
    expect(lastCall().url).toBe(`${P}/documents/${ids.document}/file`);
    await downloadDocumentVersion({ draftId: ids.draft, documentId: ids.document, version: "2" });
    expect(lastCall().url).toBe(`${V}/documents/${ids.document}/versions/2/file`);
    await downloadDocumentVersion({ draftId: ids.draft, participationId: ids.participation, documentId: ids.document, version: "123456789" });
    expect(lastCall().url).toBe(`${P}/documents/${ids.document}/versions/123456789/file`);
    await downloadDocumentLink({ draftId: ids.draft, linkId: ids.link });
    expect(lastCall().url).toBe(`${V}/document-links/${ids.link}/file`);
    await downloadDocumentLink({ draftId: ids.draft, participationId: ids.participation, linkId: ids.link });
    expect(lastCall().url).toBe(`${P}/document-links/${ids.link}/file`);
  });
  it.each(["0", "01", "1234567890", "1a", "-1", "1.5", ""])("answers 404 for the version %j without a request", async version => {
    expect((await downloadDocumentVersion({ draftId: ids.draft, documentId: ids.document, version })).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("answers 404 for malformed ids and 401 without a session, never calling the backend", async () => {
    expect((await downloadDocument({ draftId: ids.draft, documentId: "nope" })).status).toBe(404);
    expect((await downloadDocumentLink({ draftId: ids.draft, linkId: "nope" })).status).toBe(404);
    expect((await downloadDocument({ draftId: "nope", documentId: ids.document })).status).toBe(404);
    vi.mocked(getActionAccessToken).mockResolvedValue(null);
    const response = await downloadDocument({ draftId: ids.draft, documentId: ids.document });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated", code: "unauthenticated" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    [404, { code: "not_found" }], [404, { code: "team_access_ended" }], [403, { code: "forbidden" }], [503, { code: "document_storage_unavailable" }],
  ])("relays a %s %j as a JSON envelope without the backend text or cookies", async (status, envelope) => {
    fetchMock.mockImplementation(async () => Response.json({ error: "private-token private-cookie", ...envelope }, { status, headers: { "set-cookie": "private-cookie" } }));
    const response = await downloadDocumentLink({ draftId: ids.draft, linkId: ids.link });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: envelope.code, code: envelope.code });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.has("set-cookie")).toBe(false);
  });
  it.each([
    ["an HTML body", { "content-type": "text/html" }],
    ["an inline disposition", { "content-disposition": 'inline; filename="a.pdf"' }],
    ["a missing disposition", { "content-disposition": "" }],
  ])("refuses %s from the backend with 502 unrecognized_response", async (_name, headers) => {
    fetchMock.mockImplementation(async () => file(headers));
    const response = await downloadDocument({ draftId: ids.draft, documentId: ids.document });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "unrecognized_response", code: "unrecognized_response" });
  });
  it("answers 503 no_response when the backend is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("down"));
    const response = await downloadDocument({ draftId: ids.draft, documentId: ids.document });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "no_response", code: "no_response" });
  });
});
