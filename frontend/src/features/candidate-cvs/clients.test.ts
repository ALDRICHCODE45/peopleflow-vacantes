import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "https://api.example.test", apiTimeoutMs: 1000 } }));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { deleteCv, loadCvs, renameCv } from "./client";
import { deleteCvAction, loadCvsAction, renameCvAction } from "./actions";
import { cv, library } from "./test-fixtures";
import { cvFailure } from "./failure";
import { downloadFile, uploadFile } from "./file-client";
import { uploadCv } from "./upload";
const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); vi.mocked(getActionAccessToken).mockResolvedValue("private-token"); });
afterEach(() => vi.unstubAllGlobals());
describe("CV contracts", () => {
  it("loads strict metadata with server credentials and no redirects/cache", async () => {
    fetchMock.mockResolvedValue(Response.json(library));
    expect(await loadCvs({ token: "private-token" })).toEqual({ ok: true, data: library });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.test/v2/me/cvs");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store", redirect: "error" });
    expect(fetchMock.mock.calls[0][1].headers.get("authorization")).toBe("Bearer private-token");
  });
  it.each([
    { ...library, extra: true }, { ...library, items: [{ ...cv, extra: true }] },
    { ...library, items: [{ ...cv, size: 1.5 }] }, { ...library, items: [{ ...cv, size: -1 }] },
    { ...library, items: [{ ...cv, uploaded_at: "2026-02-30T12:00:00Z" }] },
    { ...library, items: [{ ...cv, uploaded_at: "2026-01-01" }] },
    { ...library, items: [{ ...cv, content_type: "text/html" }] },
    { ...library, limits: { ...library.limits, content_types: ["text/html"] } },
    { ...library, limits: { ...library.limits, max_bytes: 1.2 } },
    { ...library, limits: { ...library.limits, extra: true } },
    { ...library, items: [cv, cv] },
  ])("rejects malformed list %j", async data => {
    fetchMock.mockResolvedValue(Response.json(data));
    expect(await loadCvs({ token: "private-token" })).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
  });
  it("uses content types and size limits from the response", async () => {
    fetchMock.mockResolvedValue(Response.json({ ...library, limits: { ...library.limits, content_types: [library.limits.content_types[1]] } }));
    expect(await loadCvs({ token: "private-token" })).toMatchObject({ ok: false });
  });
  it("normalizes names by Unicode code points before PATCH", async () => {
    fetchMock.mockResolvedValue(Response.json({ ...cv, name: "CV Ágil" }));
    expect(await renameCv({ token: "private-token", id: cv.id, body: { name: "  CV\u00a0A\u0301gil  " } })).toMatchObject({ ok: true });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "PATCH", body: JSON.stringify({ name: "CV Ágil" }) });
  });
  it.each([{ name: " " }, { name: "x".repeat(121) }, { name: "a\u0000b" }, { name: "ok", extra: true }])("rejects bad rename locally %j", async body => {
    expect(await renameCv({ token: "private-token", id: cv.id, body })).toMatchObject({ ok: false, error: { kind: "invalid_request" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["../secret", "x", "%2e%2e"])('rejects unsafe id %s', async id => {
    expect(await deleteCv({ token: "private-token", id })).toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects a rename response for a different CV", async () => {
    fetchMock.mockResolvedValue(Response.json({ ...cv, id: "b12b3456-1234-4234-8234-123456789abc" }));
    expect(await renameCv({ token: "private-token", id: cv.id, body: { name: "CV" } })).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
  });
  it.each(["", "bad token", "\nsecret"])("rejects unusable credentials %j without networking", async token => {
    expect(await loadCvs({ token })).toMatchObject({ ok: false, error: { kind: "missing_token" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("accepts only 204 for DELETE", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await deleteCv({ token: "private-token", id: cv.id })).toEqual({ ok: true, data: null });
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 200 }));
    expect(await deleteCv({ token: "private-token", id: cv.id })).toMatchObject({ ok: false });
  });
});
describe("CV action boundary", () => {
  it.each([[503, "cv_storage_unavailable", "storage_unavailable"], [503, "other_code", "server_error"], [500, "cv_storage_unavailable", "server_error"], [403, "wrong_role", "wrong_role"], [400, "wrong_role", "unrecognized_response"]] as const)("classifies %i %s across every CV transport", async (status, code, reason) => {
    fetchMock.mockImplementation(() => Promise.resolve(Response.json({ error: "private-token", code }, { status })));
    const reference = { status, ...(["cv_storage_unavailable", "wrong_role"].includes(code) ? { code } : {}) };
    for (const result of [await loadCvsAction(), await renameCvAction(cv.id, { name: "Nuevo" }), await deleteCvAction(cv.id)])
      expect(result).toEqual({ ok: false, reason, reference });
    for (const result of [await downloadFile("private-token", cv.id), await uploadFile("private-token", new FormData(), library.limits)]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(cvFailure(result)).toEqual({ ok: false, reason, reference });
    }
    expect(await uploadCv(new File(["pdf"], "cv.pdf", { type: "application/pdf" }), library.limits)).toEqual({ ok: false, reason, reference });
  });
  it("fails closed without a session", async () => {
    vi.mocked(getActionAccessToken).mockResolvedValue(null);
    for (const result of [await loadCvsAction(), await renameCvAction(cv.id, { name: "CV" }), await deleteCvAction(cv.id)])
      expect(result).toEqual({ ok: false, reason: "unauthenticated", reference: {} });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([[413, "cv_too_large"], [415, "cv_unsupported_type"], [400, "cv_content_mismatch"], [409, "cv_library_full"], [400, "invalid_request"], [401, "unauthenticated"], [403, "forbidden"], [404, "not_found"], [500, "server_error"]])("sanitizes %i %s", async (status, code) => {
    fetchMock.mockResolvedValue(Response.json({ error: "private-token", code }, { status: Number(status) }));
    const result = await loadCvsAction();
    expect(result).toEqual({ ok: false, reason: code, reference: { status, code } });
    expect(JSON.stringify(result)).not.toContain("private-token");
  });
  it("does not reflect arbitrary backend codes or messages", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "private-token", code: "private-token" }, { status: 400 }));
    expect(await loadCvsAction()).toEqual({ ok: false, reason: "unrecognized_response", reference: { status: 400 } });
  });
  it("maps network and thrown session failures without exposing diagnostics", async () => {
    fetchMock.mockRejectedValue(new Error("private-token"));
    expect(await loadCvsAction()).toEqual({ ok: false, reason: "no_response", reference: {} });
    vi.mocked(getActionAccessToken).mockRejectedValue(new Error("private-token"));
    expect(await loadCvsAction()).toEqual({ ok: false, reason: "no_response", reference: {} });
  });
  it("returns decoded rename/delete results only", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(cv)).mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await renameCvAction(cv.id, { name: "CV" })).toEqual({ ok: true, data: cv });
    expect(await deleteCvAction(cv.id)).toEqual({ ok: true, data: null });
  });
});
