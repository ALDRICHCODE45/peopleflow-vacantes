// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "https://api.example.test", apiTimeoutMs: 1000 } }));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { cv, library } from "@/features/candidate-cvs/test-fixtures";
import { POST } from "./route";
import { GET } from "./[id]/file/route";
const fetchMock = vi.fn();
const request = (data: FormData) => new Request("https://app.example.test/api/candidate/cvs", { method: "POST", body: data });
function form() { const data = new FormData(); data.append("file", new File(["%PDF-document"], "cv.pdf", { type: "application/pdf" })); return data; }
const ctx = (id = cv.id) => ({ params: Promise.resolve({ id }) });
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); vi.mocked(getActionAccessToken).mockResolvedValue("secret-bearer");
  fetchMock.mockImplementation((url: string) => {
    if (url.endsWith("/v2/me")) return Promise.resolve(Response.json({ role: "candidate", user: { id: cv.id, email: "candidate@example.test", full_name: "Candidate" } }));
    if (url.endsWith("/v2/me/cvs")) return Promise.resolve(Response.json(library));
    return Promise.resolve(new Response("%PDF-content", { headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="cv.pdf"', "set-cookie": "secret-bearer" } }));
  });
});
afterEach(() => vi.unstubAllGlobals());
describe("CV route authentication", () => {
  it("returns safe 401 no-store without consuming the upload", async () => {
    vi.mocked(getActionAccessToken).mockResolvedValue(null);
    const req = request(form());
    const response = await POST(req);
    expect(response.status).toBe(401); expect(req.bodyUsed).toBe(false);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "unauthenticated", code: "unauthenticated" });
    expect((await GET(new Request("https://app.example.test"), ctx())).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects recruiter sessions before reading or forwarding files", async () => {
    fetchMock.mockResolvedValue(Response.json({ role: "recruiter", user: { id: cv.id, email: "staff@example.test", full_name: "Staff" } }));
    const response = await GET(new Request("https://app.example.test"), ctx());
    expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: "wrong_role", code: "wrong_role" });
  });
});
describe("bounded multipart upload", () => {
  it.each([[503, "cv_storage_unavailable"], [403, "wrong_role"]] as const)("preserves %i %s from the library gate without reading the upload", async (status, code) => {
    fetchMock.mockResolvedValue(Response.json({ error: "secret-bearer", code }, { status }));
    const req = request(form()); const response = await POST(req);
    expect(response.status).toBe(status); expect(req.bodyUsed).toBe(false);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: code, code });
  });
  it.each([[503, "cv_storage_unavailable"], [403, "wrong_role"]] as const)("preserves %i %s from upload and download", async (status, code) => {
    fetchMock.mockImplementation((url, init) => {
      if (url.endsWith("/v2/me")) return Promise.resolve(Response.json({ role: "candidate", user: { id: cv.id, email: "candidate@example.test", full_name: "Candidate" } }));
      if (url.endsWith("/v2/me/cvs") && init.method === "GET") return Promise.resolve(Response.json(library));
      return Promise.resolve(Response.json({ error: "secret-bearer", code }, { status }));
    });
    for (const response of [await POST(request(form())), await GET(new Request("https://app.example.test"), ctx())]) {
      expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: code, code });
    }
  });
  it("forwards only one file and normalized optional name with Bearer, no browser cookie", async () => {
    fetchMock.mockImplementation((url, init) => init?.method === "POST" ? Promise.resolve(Response.json(cv, { status: 201, headers: { "set-cookie": "secret-bearer" } })) : Promise.resolve(Response.json(library)));
    const data = form(); data.append("name", "  Mi CV  ");
    const req = request(data); req.headers.set("cookie", "private-cookie");
    const response = await POST(req);
    expect(response.status).toBe(201); expect(await response.json()).toEqual(cv);
    const [, init] = fetchMock.mock.calls.find(([, init]) => init.method === "POST")!;
    expect([...init.body.keys()]).toEqual(["file", "name"]); expect(init.body.get("name")).toBe("Mi CV");
    expect(init.headers.get("authorization")).toBe("Bearer secret-bearer");
    expect(init.headers.has("cookie")).toBe(false); expect(init.redirect).toBe("error"); expect(init.cache).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
  });
  it.each(["unknown", "duplicate", "missing"])("rejects %s parts without forwarding", async kind => {
    const data = kind === "missing" ? new FormData() : form();
    if (kind === "unknown") data.append("unknown", "secret-bearer");
    if (kind === "duplicate") data.append("file", new File(["pdf"], "second.pdf"));
    expect((await POST(request(data))).status).toBe(400);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
  it("enforces the advertised body cap on actual streamed bytes and stops reading early", async () => {
    let pulls = 0; const cancel = vi.fn();
    const body = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(65536)); }, cancel }, { highWaterMark: 0 });
    const req = new Request("https://app.example.test/api/candidate/cvs", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=test" }, body, duplex: "half" } as RequestInit);
    const response = await POST(req);
    expect(response.status).toBe(413); expect((await response.json()).code).toBe("cv_too_large");
    expect(pulls).toBeLessThanOrEqual(82); expect(cancel).toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
  it("rejects declared oversized bodies without a single body read", async () => {
    const pull = vi.fn();
    const req = new Request("https://app.example.test/api/candidate/cvs", { method: "POST", headers: { "content-length": "99999999", "content-type": "multipart/form-data; boundary=test" }, body: new ReadableStream({ pull }, { highWaterMark: 0 }), duplex: "half" } as RequestInit);
    expect((await POST(req)).status).toBe(413); expect(pull).not.toHaveBeenCalled();
  });
  it.each([[413, "cv_too_large"], [415, "cv_unsupported_type"], [400, "cv_content_mismatch"], [409, "cv_library_full"], [500, "server_error"]])("maps backend status %i safely", async (status, code) => {
    fetchMock.mockImplementation((url, init) => init?.method === "POST" ? Promise.resolve(Response.json({ error: "secret-bearer", code }, { status: Number(status) })) : Promise.resolve(Response.json(library)));
    const response = await POST(request(form()));
    expect(response.status).toBe(status); const body = await response.text(); expect(body).not.toContain("secret-bearer"); expect(JSON.parse(body).code).toBe(code);
  });
  it.each(["", "application/octet-stream"])("forwards a .docx whose browser MIME type is %j (the backend verifies real content)", async type => {
    fetchMock.mockImplementation((_url, init) => init?.method === "POST" ? Promise.resolve(Response.json(cv, { status: 201 })) : Promise.resolve(Response.json(library)));
    const data = new FormData(); data.append("file", new File(["PK-docx"], "cv.docx", { type }));
    expect((await POST(request(data))).status).toBe(201);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true);
  });
  it("still rejects an unknown extension when the browser MIME type is empty", async () => {
    const data = new FormData(); data.append("file", new File(["<html>"], "cv.html", { type: "" }));
    expect((await POST(request(data))).status).toBe(415);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
  it("allows a full 5 MiB file plus bounded multipart overhead", async () => {
    const data = new FormData(); data.append("file", new File([new Uint8Array(library.limits.max_bytes)], "full.pdf", { type: "application/pdf" }));
    fetchMock.mockImplementation((_url, init) => init?.method === "POST" ? Promise.resolve(Response.json({ ...cv, size: library.limits.max_bytes }, { status: 201 })) : Promise.resolve(Response.json(library)));
    expect((await POST(request(data))).status).toBe(201);
  });
  it("rejects a file one byte over max_bytes, even inside the multipart envelope budget", async () => {
    const data = new FormData(); data.append("file", new File([new Uint8Array(library.limits.max_bytes + 1)], "big.pdf", { type: "application/pdf" }));
    expect((await POST(request(data))).status).toBe(413);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
  it.each(["empty-name", "long-name", "duplicate-name", "file-name", "empty-file", "bad-type", "malformed"])("rejects malformed multipart %s", async kind => {
    const data = form();
    if (kind === "empty-name") data.append("name", " ");
    if (kind === "long-name") data.append("name", "x".repeat(121));
    if (kind === "duplicate-name") { data.append("name", "one"); data.append("name", "two"); }
    if (kind === "file-name") data.append("name", new File(["bad"], "bad.txt"));
    if (kind === "empty-file") data.set("file", new File([], "empty.pdf", { type: "application/pdf" }));
    if (kind === "bad-type") data.set("file", new File(["bad"], "bad.html", { type: "text/html" }));
    const req = kind === "malformed" ? new Request("https://app.example.test/api/candidate/cvs", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x" }, body: "invalid" }) : request(data);
    expect((await POST(req)).status).toBe(kind === "bad-type" ? 415 : 400);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
  it.each([401, 403])("respects candidate-only library auth gate %i before body consumption", async status => {
    fetchMock.mockResolvedValue(Response.json({ error: "secret-bearer", code: status === 401 ? "unauthenticated" : "forbidden" }, { status }));
    const req = request(form()); const response = await POST(req);
    expect(response.status).toBe(status); expect(req.bodyUsed).toBe(false); expect(await response.text()).not.toContain("secret-bearer");
  });
  it.each([200, 202, 204])("never treats an unexpected backend upload status %i as success", async status => {
    fetchMock.mockImplementation((_url, init) => init?.method === "POST" ? Promise.resolve(status === 204 ? new Response(null, { status }) : Response.json(cv, { status })) : Promise.resolve(Response.json(library)));
    const response = await POST(request(form())); expect(response.status).toBe(502); expect(await response.json()).toEqual({ error: "unrecognized_response", code: "unrecognized_response" });
  });
  it("rejects unknown success bodies instead of leaking extra fields", async () => {
    fetchMock.mockImplementation((url, init) => init?.method === "POST" ? Promise.resolve(Response.json({ ...cv, token: "secret-bearer" }, { status: 201 })) : Promise.resolve(Response.json(library)));
    const response = await POST(request(form())); expect(response.status).toBe(502); expect(await response.text()).not.toContain("secret-bearer");
  });
  it("rejects cross-origin POSTs before forwarding", async () => {
    const req = request(form()); req.headers.set("origin", "https://evil.example.test");
    expect((await POST(req)).status).toBe(403); expect(fetchMock).not.toHaveBeenCalled();
  });
});
describe("private download", () => {
  it.each(["../secret", "%2e%2e", "bad-id"])("returns 404 for unsafe UUID %s", async id => {
    expect((await GET(new Request("https://app.example.test"), ctx(id))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("streams only the stored type/attachment, never cookies or bearer", async () => {
    const response = await GET(new Request("https://app.example.test"), ctx());
    expect(response.status).toBe(200); expect(await response.text()).toBe("%PDF-content");
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="cv.pdf"');
    expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(fetchMock.mock.calls.at(-1)?.[1].headers.get("authorization")).toBe("Bearer secret-bearer");
  });
  it.each([
    { "content-type": "text/html", "content-disposition": 'attachment; filename="cv.html"' },
    { "content-type": "application/pdf", "content-disposition": "inline" },
    { "content-type": "application/pdf" },
  ])("rejects unsafe file headers %j", async headers => {
    fetchMock.mockImplementation(url => url.endsWith("/v2/me") ? Promise.resolve(Response.json({ role: "candidate", user: { id: cv.id, email: "candidate@example.test", full_name: "Candidate" } })) : Promise.resolve(new Response("secret-bearer", { headers: headers as Record<string, string> })));
    const response = await GET(new Request("https://app.example.test"), ctx()); expect(response.status).toBe(502); expect(await response.text()).not.toContain("secret-bearer");
  });
  it("passes through a safe 404 rather than backend text", async () => {
    fetchMock.mockImplementation(url => url.endsWith("/v2/me") ? Promise.resolve(Response.json({ role: "candidate", user: { id: cv.id, email: "candidate@example.test", full_name: "Candidate" } })) : Promise.resolve(Response.json({ error: "secret-bearer", code: "not_found" }, { status: 404 })));
    const response = await GET(new Request("https://app.example.test"), ctx()); expect(response.status).toBe(404); expect(await response.text()).not.toContain("secret-bearer");
  });
});
