import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDocumentLink, deleteDocument, deleteDocumentLink, getDocumentOverview, getDocumentSources, getDocumentVersions, listDocuments,
} from "./client";
import { ids, linkWire, listWire, overviewWire, scopeWire, sourcesWire, versionsWire } from "./test-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "https://api.example.test/", apiTimeoutMs: 1000 } }));
const fetchMock = vi.fn();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });

const V = `https://api.example.test/v2/me/company/job-drafts/${ids.draft}`;
const P = `${V}/participations/${ids.participation}`;
const base = { token: " tok ", draftId: ids.draft };
const lastCall = () => { const [url, init] = fetchMock.mock.calls.at(-1)!; return { url: String(url), init, headers: Object.fromEntries(new Headers(init.headers)) }; };

describe("reads", () => {
  it("lists the vacancy scope: GET V/documents with only the trimmed Bearer", async () => {
    fetchMock.mockImplementation(async () => json(listWire()));
    const result = await listDocuments(base);
    expect(result).toMatchObject({ ok: true, data: { items: [{ name: "Contrato marco" }] } });
    const { url, init, headers } = lastCall();
    expect(url).toBe(`${V}/documents`);
    expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
    expect(headers).toEqual({ accept: "application/json", authorization: "Bearer tok" });
  });
  it("lists a participation scope: GET V/participations/{pid}/documents", async () => {
    fetchMock.mockImplementation(async () => json(listWire()));
    await listDocuments({ ...base, participationId: ids.participation });
    expect(lastCall().url).toBe(`${P}/documents`);
  });
  it("reads the overview, with and without participation_id (lower-cased canonical uuid)", async () => {
    fetchMock.mockImplementation(async () => json(overviewWire()));
    expect(await getDocumentOverview(base)).toMatchObject({ ok: true, data: { truncated: false, vacancy: { title: "Analista contable" } } });
    expect(lastCall().url).toBe(`${V}/document-overview`);
    await getDocumentOverview({ ...base, participationId: ids.participation.toUpperCase() });
    expect(lastCall().url).toBe(`${V}/document-overview?participation_id=${ids.participation}`);
    expect(lastCall().init.method).toBe("GET");
  });
  it("reads versions and sources in both scopes", async () => {
    fetchMock.mockImplementation(async () => json(versionsWire()));
    expect(await getDocumentVersions({ ...base, documentId: ids.document })).toMatchObject({ ok: true, data: { versions: [{ version: 2 }, { version: 1 }] } });
    expect(lastCall().url).toBe(`${V}/documents/${ids.document}/versions`);
    await getDocumentVersions({ ...base, participationId: ids.participation, documentId: ids.document });
    expect(lastCall().url).toBe(`${P}/documents/${ids.document}/versions`);
    fetchMock.mockImplementation(async () => json(sourcesWire()));
    expect(await getDocumentSources(base)).toMatchObject({ ok: true, data: { can_link: true } });
    expect(lastCall().url).toBe(`${V}/document-sources`);
    await getDocumentSources({ ...base, participationId: ids.participation });
    expect(lastCall().url).toBe(`${P}/document-sources`);
  });
  it("fails closed on an unknown key, an unknown enum or a non-200 success", async () => {
    fetchMock.mockResolvedValueOnce(json({ ...listWire(), cursor: "x" }));
    expect(await listDocuments(base)).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
    const wire = listWire(); wire.items[0].format = "doc";
    fetchMock.mockResolvedValueOnce(json(wire));
    expect(await listDocuments(base)).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
    fetchMock.mockResolvedValueOnce(json(listWire(), 201));
    expect(await listDocuments(base)).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
  });
  it("attaches the decoded envelope of an error and never the raw text of an unknown one", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "x", code: "team_access_ended" }, 404));
    expect(await listDocuments(base)).toMatchObject({ ok: false, error: { kind: "status", status: 404 }, envelope: { code: "team_access_ended" } });
    fetchMock.mockResolvedValueOnce(json({ error: "private", code: "mystery" }, 409));
    const result = await listDocuments(base);
    expect(result).toMatchObject({ ok: false, error: { kind: "status", status: 409 } });
    expect("envelope" in result).toBe(false);
  });
});

describe("writes", () => {
  it("deletes a document: DELETE V/documents/{doc} → 200 {scope}", async () => {
    fetchMock.mockImplementation(async () => json({ scope: scopeWire() }));
    expect(await deleteDocument({ ...base, documentId: ids.document })).toMatchObject({ ok: true, data: { scope: { can_manage: true } } });
    const { url, init, headers } = lastCall();
    expect(url).toBe(`${V}/documents/${ids.document}`);
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeUndefined();
    expect(headers).toEqual({ accept: "application/json", authorization: "Bearer tok" });
    await deleteDocument({ ...base, participationId: ids.participation, documentId: ids.document });
    expect(lastCall().url).toBe(`${P}/documents/${ids.document}`);
  });
  it("rejects a delete answered 204 or 201 as an invalid response", async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
    expect(await deleteDocument({ ...base, documentId: ids.document })).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
  });
  it("creates a link: POST …/document-links with a JSON body, no Idempotency-Key and no If-Match", async () => {
    fetchMock.mockImplementation(async () => json({ link: linkWire(), scope: scopeWire() }, 201));
    expect(await createDocumentLink({ ...base, body: { source_document_id: ids.source, version: 1 } })).toMatchObject({ ok: true, data: { link: { id: ids.link } } });
    const { url, init, headers } = lastCall();
    expect(url).toBe(`${V}/document-links`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ source_document_id: ids.source, version: 1 });
    expect(headers).toEqual({ accept: "application/json", authorization: "Bearer tok", "content-type": "application/json" });
    await createDocumentLink({ ...base, participationId: ids.participation, body: { source_document_id: ids.source } });
    expect(lastCall().url).toBe(`${P}/document-links`);
    expect(JSON.parse(lastCall().init.body)).toEqual({ source_document_id: ids.source });
  });
  it("unlinks: DELETE …/document-links/{link} → 200 {scope}", async () => {
    fetchMock.mockImplementation(async () => json({ scope: scopeWire() }));
    expect(await deleteDocumentLink({ ...base, linkId: ids.link })).toMatchObject({ ok: true });
    expect(lastCall().url).toBe(`${V}/document-links/${ids.link}`);
    expect(lastCall().init.method).toBe("DELETE");
    await deleteDocumentLink({ ...base, participationId: ids.participation, linkId: ids.link });
    expect(lastCall().url).toBe(`${P}/document-links/${ids.link}`);
  });
  it("surfaces the envelope of a 409 on create-link for the failure decoder", async () => {
    fetchMock.mockImplementation(async () => json({ error: "x", code: "document_already_linked", data: { link_id: ids.link } }, 409));
    expect(await createDocumentLink({ ...base, body: { source_document_id: ids.source } })).toMatchObject({
      ok: false, error: { kind: "status", status: 409 }, envelope: { code: "document_already_linked", data: { link_id: ids.link } },
    });
  });
});

describe("input validation happens before any request", () => {
  it.each([
    ["a blank token", () => listDocuments({ ...base, token: "  " }), "missing_token"],
    ["a malformed draft id", () => listDocuments({ ...base, draftId: `${ids.draft}\n` }), "invalid_request"],
    ["a malformed participation id", () => listDocuments({ ...base, participationId: "nope" }), "invalid_request"],
    ["a malformed overview filter", () => getDocumentOverview({ ...base, participationId: "nope" }), "invalid_request"],
    ["a non-string draft id", () => listDocuments({ ...base, draftId: [ids.draft] as unknown as string }), "invalid_request"],
    ["a malformed document id", () => deleteDocument({ ...base, documentId: "../x" }), "invalid_request"],
    ["a malformed link id", () => deleteDocumentLink({ ...base, linkId: "nope" }), "invalid_request"],
    ["a link body with an unknown key", () => createDocumentLink({ ...base, body: { source_document_id: ids.source, extra: 1 } as never }), "invalid_request"],
    ["a link body with version 0", () => createDocumentLink({ ...base, body: { source_document_id: ids.source, version: 0 } }), "invalid_request"],
  ])("%s", async (_name, call, kind) => {
    expect(await call()).toMatchObject({ ok: false, error: { kind } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("maps a network failure and a timeout to retryable transport errors", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    expect(await listDocuments(base)).toMatchObject({ ok: false, error: { kind: "network" } });
  });
});
