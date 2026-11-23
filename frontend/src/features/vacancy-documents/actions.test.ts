import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDocumentLinkAction, deleteDocumentAction, deleteDocumentLinkAction, listDocumentSourcesAction, listDocumentVersionsAction, listParticipationDocumentsAction,
  listVacancyDocumentsAction, loadDocumentOverviewAction,
} from "./actions";
import { ids, linkWire, listWire, overviewWire, scopeWire, sourcesWire, versionsWire } from "./test-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "https://api.example.test", apiTimeoutMs: 1000 } }));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn(async () => "token") }));
import { getActionAccessToken } from "@/lib/auth/action-session";

const fetchMock = vi.fn();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const V = `https://api.example.test/v2/me/company/job-drafts/${ids.draft}`;
const P = `${V}/participations/${ids.participation}`;
const lastCall = () => { const [url, init] = fetchMock.mock.calls.at(-1)!; return { url: String(url), init, headers: Object.fromEntries(new Headers(init.headers)) }; };
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); vi.mocked(getActionAccessToken).mockResolvedValue("token"); });

describe("read actions", () => {
  it("lists the vacancy scope and a participation scope with the session token", async () => {
    fetchMock.mockImplementation(async () => json(listWire()));
    expect(await listVacancyDocumentsAction(ids.draft)).toMatchObject({ ok: true, data: { scope: { can_manage: true } } });
    expect(lastCall()).toMatchObject({ url: `${V}/documents`, headers: { authorization: "Bearer token" } });
    expect(lastCall().init.method).toBe("GET");
    expect(await listParticipationDocumentsAction(ids.draft, ids.participation)).toMatchObject({ ok: true });
    expect(lastCall().url).toBe(`${P}/documents`);
  });
  it("loads the overview with an optional participation filter", async () => {
    fetchMock.mockImplementation(async () => json(overviewWire()));
    expect(await loadDocumentOverviewAction(ids.draft)).toMatchObject({ ok: true, data: { participations: [{}, {}], truncated: false } });
    expect(lastCall().url).toBe(`${V}/document-overview`);
    await loadDocumentOverviewAction(ids.draft, ids.participation);
    expect(lastCall().url).toBe(`${V}/document-overview?participation_id=${ids.participation}`);
  });
  it("reads versions and sources for either scope", async () => {
    fetchMock.mockImplementation(async () => json(versionsWire()));
    expect(await listDocumentVersionsAction({ draftId: ids.draft, documentId: ids.document })).toMatchObject({ ok: true, data: { document_id: ids.document } });
    expect(lastCall().url).toBe(`${V}/documents/${ids.document}/versions`);
    fetchMock.mockImplementation(async () => json(sourcesWire()));
    expect(await listDocumentSourcesAction({ draftId: ids.draft, participationId: ids.participation })).toMatchObject({ ok: true, data: { can_link: true } });
    expect(lastCall().url).toBe(`${P}/document-sources`);
  });
});

describe("write actions", () => {
  it("deletes a document and returns the refreshed scope", async () => {
    fetchMock.mockImplementation(async () => json({ scope: scopeWire({ counts: { documents: 2, links: 1 } }) }));
    expect(await deleteDocumentAction({ draftId: ids.draft, participationId: ids.participation, documentId: ids.document })).toMatchObject({ ok: true, data: { scope: { counts: { documents: 2 } } } });
    expect(lastCall()).toMatchObject({ url: `${P}/documents/${ids.document}` });
    expect(lastCall().init.method).toBe("DELETE");
  });
  it("creates a link from {sourceDocumentId, version?} and unlinks", async () => {
    fetchMock.mockImplementation(async () => json({ link: linkWire(), scope: scopeWire() }, 201));
    expect(await createDocumentLinkAction({ draftId: ids.draft, sourceDocumentId: ids.source, version: 2 })).toMatchObject({ ok: true, data: { link: { state: "available" } } });
    expect(lastCall().url).toBe(`${V}/document-links`);
    expect(lastCall().init.method).toBe("POST");
    expect(JSON.parse(lastCall().init.body)).toEqual({ source_document_id: ids.source, version: 2 });
    await createDocumentLinkAction({ draftId: ids.draft, sourceDocumentId: ids.source });
    expect(JSON.parse(lastCall().init.body)).toEqual({ source_document_id: ids.source });
    fetchMock.mockImplementation(async () => json({ scope: scopeWire() }));
    expect(await deleteDocumentLinkAction({ draftId: ids.draft, linkId: ids.link })).toMatchObject({ ok: true });
    expect(lastCall()).toMatchObject({ url: `${V}/document-links/${ids.link}` });
    expect(lastCall().init.method).toBe("DELETE");
  });
});

describe("failures", () => {
  it("answers unauthenticated without a session and never calls the backend", async () => {
    vi.mocked(getActionAccessToken).mockResolvedValue(null);
    expect(await listVacancyDocumentsAction(ids.draft)).toMatchObject({ ok: false, reason: "unauthenticated", message: "Inicia sesión para continuar." });
    expect(await deleteDocumentAction({ draftId: ids.draft, documentId: ids.document })).toMatchObject({ ok: false, reason: "unauthenticated" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("maps backend errors to Spanish messages without the server text", async () => {
    fetchMock.mockImplementation(async () => json({ error: "private detail", code: "document_already_linked", data: { link_id: ids.link } }, 409));
    const result = await createDocumentLinkAction({ draftId: ids.draft, sourceDocumentId: ids.source });
    expect(result).toMatchObject({ ok: false, reason: "document_already_linked", linkId: ids.link, message: "Ese documento ya está vinculado a este espacio." });
    expect(JSON.stringify(result)).not.toContain("private");
    fetchMock.mockImplementation(async () => json({ error: "x", code: "forbidden" }, 403));
    expect(await deleteDocumentAction({ draftId: ids.draft, documentId: ids.document })).toMatchObject({ ok: false, reason: "forbidden" });
    fetchMock.mockImplementation(async () => json({ error: "x", code: "team_access_ended" }, 404));
    expect(await listVacancyDocumentsAction(ids.draft)).toMatchObject({ ok: false, reason: "team_access_ended" });
  });
  it("maps a malformed answer, a transport error and a thrown session read", async () => {
    fetchMock.mockImplementation(async () => json({ items: "nope" }));
    expect(await listVacancyDocumentsAction(ids.draft)).toMatchObject({ ok: false, reason: "unrecognized_response", uncertain: true });
    fetchMock.mockRejectedValue(new Error("boom"));
    expect(await listVacancyDocumentsAction(ids.draft)).toMatchObject({ ok: false, reason: "no_response" });
    vi.mocked(getActionAccessToken).mockRejectedValue(new Error("session"));
    expect(await listVacancyDocumentsAction(ids.draft)).toMatchObject({ ok: false, reason: "no_response" });
  });
  it("rejects malformed ids as invalid_request without a request", async () => {
    expect(await listParticipationDocumentsAction(ids.draft, "nope")).toMatchObject({ ok: false, reason: "invalid_request" });
    expect(await listDocumentVersionsAction({ draftId: ids.draft, documentId: "nope" })).toMatchObject({ ok: false, reason: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
