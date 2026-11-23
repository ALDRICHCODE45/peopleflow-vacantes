import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ids, itemWire, scopeWire } from "../test-fixtures";
import { replaceDocumentFile, uploadDocumentFile } from "./upload-client";

class FakeRequest {
  static last: FakeRequest;
  headers: Record<string, string> = {}; method = ""; url = ""; body: FormData | null = null; status = 0; responseText = "";
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null; onerror: (() => void) | null = null; ontimeout: (() => void) | null = null; onabort: (() => void) | null = null;
  constructor() { FakeRequest.last = this; }
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  send(body: FormData) { this.body = body; }
  abort() { this.onabort?.(); }
  answer(status: number, json: unknown) { this.status = status; this.responseText = JSON.stringify(json); this.onload?.(); }
}
beforeEach(() => { vi.stubGlobal("XMLHttpRequest", FakeRequest); });
afterEach(() => { vi.unstubAllGlobals(); });
const file = new File(["%PDF"], "Oferta.pdf", { type: "application/pdf" });

describe("upload-client", () => {
  it("posts the file to the scope's BFF route with the Idempotency-Key, reports progress and parses {item, scope}", async () => {
    const progress = vi.fn();
    const sent = uploadDocumentFile({ draftId: ids.draft, participationId: ids.participation, file, idempotencyKey: ids.idemToken, onProgress: progress });
    const request = FakeRequest.last;
    expect([request.method, request.url]).toEqual(["POST", `/api/company/job-drafts/${ids.draft}/participations/${ids.participation}/documents`]);
    expect(request.headers["idempotency-key"]).toBe(ids.idemToken);
    expect((request.body as FormData).get("file")).toBeInstanceOf(File);
    request.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 200 });
    expect(progress).toHaveBeenCalledWith(0.25);
    request.answer(201, { item: itemWire(), scope: scopeWire() });
    expect(await sent).toMatchObject({ ok: true, data: { item: { id: ids.document } } });
  });
  it("sends expected_version first when replacing", () => {
    void replaceDocumentFile({ draftId: ids.draft, participationId: null, file, documentId: ids.document, expectedVersion: 2 });
    expect(FakeRequest.last.url).toBe(`/api/company/job-drafts/${ids.draft}/documents/${ids.document}/versions`);
    expect([...(FakeRequest.last.body as FormData).keys()]).toEqual(["expected_version", "file"]);
    expect((FakeRequest.last.body as FormData).get("expected_version")).toBe("2");
  });
  it("maps the error envelope, a broken answer and a network failure to the Spanish failure", async () => {
    const conflict = uploadDocumentFile({ draftId: ids.draft, participationId: null, file, idempotencyKey: ids.idemToken });
    FakeRequest.last.answer(409, { error: "document_version_conflict", code: "document_version_conflict", data: { current_version: 3 } });
    expect(await conflict).toMatchObject({ ok: false, reason: "document_version_conflict", reload: true, currentVersion: 3 });
    const broken = uploadDocumentFile({ draftId: ids.draft, participationId: null, file, idempotencyKey: ids.idemToken });
    FakeRequest.last.answer(201, { item: {} });
    expect(await broken).toMatchObject({ ok: false, reason: "unrecognized_response", uncertain: true });
    const down = uploadDocumentFile({ draftId: ids.draft, participationId: null, file, idempotencyKey: ids.idemToken });
    FakeRequest.last.onerror?.();
    expect(await down).toMatchObject({ ok: false, reason: "no_response", uncertain: true });
  });
});
