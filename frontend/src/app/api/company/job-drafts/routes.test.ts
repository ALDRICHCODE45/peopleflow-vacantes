// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn().mockResolvedValue("server-token") }));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080", apiTimeoutMs: 1000 } }));
import { POST as upload } from "./[draftId]/documents/route";
import { POST as replace } from "./[draftId]/documents/[documentId]/versions/route";
import { GET as file } from "./[draftId]/documents/[documentId]/file/route";
import { GET as versionFile } from "./[draftId]/documents/[documentId]/versions/[version]/file/route";
import { GET as linkFile } from "./[draftId]/document-links/[linkId]/file/route";
import { POST as pUpload } from "./[draftId]/participations/[participationId]/documents/route";
import { POST as pReplace } from "./[draftId]/participations/[participationId]/documents/[documentId]/versions/route";
import { GET as pFile } from "./[draftId]/participations/[participationId]/documents/[documentId]/file/route";
import { GET as pVersionFile } from "./[draftId]/participations/[participationId]/documents/[documentId]/versions/[version]/file/route";
import { GET as pLinkFile } from "./[draftId]/participations/[participationId]/document-links/[linkId]/file/route";
import * as uploadModule from "./[draftId]/documents/route";
import * as fileModule from "./[draftId]/documents/[documentId]/file/route";
import { itemWire, scopeWire } from "@/features/vacancy-documents/test-fixtures";

const draftId = "123e4567-e89b-42d3-a456-426614174000";
const participationId = "123e4567-e89b-42d3-a456-426614174001";
const documentId = "123e4567-e89b-42d3-a456-426614174002";
const linkId = "123e4567-e89b-42d3-a456-426614174003";
const V = `http://localhost:8080/v2/me/company/job-drafts/${draftId}`;
const P = `${V}/participations/${participationId}`;
const fetchMock = vi.fn();
const post = () => new Request("http://localhost/api/company/job-drafts/x", {
  method: "POST", body: "x", headers: { "content-type": "multipart/form-data; boundary=b" }, duplex: "half",
} as RequestInit);
const get = () => new Request("http://localhost/api/company/job-drafts/x");
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (_url, init) => {
    if (init.method === "POST") { for await (const _chunk of init.body as AsyncIterable<Uint8Array>) void _chunk; return Response.json({ item: itemWire(), scope: scopeWire() }, { status: 201 }); }
    return new Response("%PDF-", { headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="a.pdf"' } });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

it.each([
  ["vacancy upload", () => upload(post(), ctx({ draftId })), `${V}/documents`, "POST"],
  ["vacancy replace", () => replace(post(), ctx({ draftId, documentId })), `${V}/documents/${documentId}/versions`, "POST"],
  ["vacancy download", () => file(get(), ctx({ draftId, documentId })), `${V}/documents/${documentId}/file`, "GET"],
  ["vacancy version download", () => versionFile(get(), ctx({ draftId, documentId, version: "3" })), `${V}/documents/${documentId}/versions/3/file`, "GET"],
  ["vacancy link download", () => linkFile(get(), ctx({ draftId, linkId })), `${V}/document-links/${linkId}/file`, "GET"],
  ["participation upload", () => pUpload(post(), ctx({ draftId, participationId })), `${P}/documents`, "POST"],
  ["participation replace", () => pReplace(post(), ctx({ draftId, participationId, documentId })), `${P}/documents/${documentId}/versions`, "POST"],
  ["participation download", () => pFile(get(), ctx({ draftId, participationId, documentId })), `${P}/documents/${documentId}/file`, "GET"],
  ["participation version download", () => pVersionFile(get(), ctx({ draftId, participationId, documentId, version: "3" })), `${P}/documents/${documentId}/versions/3/file`, "GET"],
  ["participation link download", () => pLinkFile(get(), ctx({ draftId, participationId, linkId })), `${P}/document-links/${linkId}/file`, "GET"],
])("%s mirrors its backend path", async (_name, call, url, method) => {
  const response = await call();
  expect(response.status).toBe(method === "POST" ? 201 : 200);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [calledUrl, init] = fetchMock.mock.calls[0];
  expect(String(calledUrl)).toBe(url);
  expect(init.method).toBe(method);
  expect(Object.fromEntries(new Headers(init.headers)).authorization).toBe("Bearer server-token");
});

it("runs on the Node runtime and is never statically cached", () => {
  expect(uploadModule.runtime).toBe("nodejs");
  expect(uploadModule.dynamic).toBe("force-dynamic");
  expect(fileModule.runtime).toBe("nodejs");
  expect(fileModule.dynamic).toBe("force-dynamic");
});
