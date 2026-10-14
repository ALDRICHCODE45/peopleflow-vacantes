import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const env = vi.hoisted(() => ({ reads: 0 }));
vi.mock("@/lib/env/server", () => ({ get serverEnv() { env.reads++; return { apiBaseUrl: "https://api.example.test", apiTimeoutMs: 50 }; } }));
import { createCompany, getMyCompany, listIndustries } from "./company-client";
const company = { id: "c", name: "Empresa", rfc: "ABC123456789", industry_id: "i", status: "active" };
const industry = { id: "i", label_es: "Tecnología", label_en: "Technology", sort_order: 1 };
const fetchMock = vi.fn();
beforeEach(() => { env.reads = 0; fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it("uses exact public and authenticated paths, headers, body and rejects redirects", async () => {
  fetchMock.mockResolvedValueOnce(Response.json([industry])).mockResolvedValueOnce(Response.json({ company_id: "c", role: "owner", company })).mockResolvedValueOnce(Response.json({ ...company, extra: true }, { status: 201 }));
  expect(await listIndustries()).toEqual({ ok: true, data: [industry] });
  expect(await getMyCompany({ token: " secret " })).toEqual({ ok: true, data: { company_id: "c", role: "owner", company } });
  expect(await createCompany({ token: "secret", body: { name: company.name, rfc: company.rfc, industry_id: "i" } })).toEqual({ ok: true, data: company });
  for (const [index, path] of ["/industries", "/me/company", "/companies"].entries()) {
    const [url, init] = fetchMock.mock.calls[index];
    expect(url).toBe(`https://api.example.test${path}`);
    expect(init.redirect).toBe("error"); expect(init.cache).toBe("no-store");
    expect(init.method).toBe(index === 2 ? "POST" : "GET");
    expect(new Headers(init.headers).get("authorization")).toBe(index ? "Bearer secret" : null);
    expect([...new Headers(init.headers).keys()].sort()).toEqual(index === 2 ? ["accept", "authorization", "content-type"] : index ? ["accept", "authorization"] : ["accept"]);
    expect(init.credentials).toBeUndefined();
    expect(init.body).toBe(index === 2 ? JSON.stringify({ name: company.name, rfc: company.rfc, industry_id: "i" }) : undefined);
  }
});
it.each([undefined, "", "  "])("fails closed before env for token %s", async token => {
  for (const call of [() => getMyCompany({ token: token as string }), () => createCompany({ token: token as string, body: {} })])
    expect(await call()).toEqual({ ok: false, error: { kind: "missing_token", retryable: false } });
  expect(env.reads).toBe(0); expect(fetchMock).not.toHaveBeenCalled();
});
it.each([null, {}, [{ ...industry, sort_order: 1.5 }], [{ id: "i" }]])("rejects invalid industry DTO %j", async body => {
  fetchMock.mockResolvedValue(Response.json(body)); expect(await listIndustries()).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
});
it.each([{}, { ...company, status: "unknown" }, { ...company, rfc: undefined }])("requires company fields %j", async body => {
  fetchMock.mockResolvedValue(Response.json(body, { status: 201 })); expect(await createCompany({ token: "secret", body: {} })).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
});
it("keeps the create method and 201 contract even with an absent runtime body", async () => {
  fetchMock.mockResolvedValue(Response.json(company));
  expect(await createCompany({ token: "secret", body: undefined })).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
  expect(fetchMock.mock.calls[0][1].method).toBe("POST");
});
it("rejects malformed membership and unexpected success status", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ company_id: "c", role: "admin", company })).mockResolvedValueOnce(Response.json(company));
  expect(await getMyCompany({ token: "secret" })).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
  expect(await createCompany({ token: "secret", body: {} })).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
});
it.each([400, 401, 403, 409, 413, 503, 302])("bounds and decodes status %s without retry or leaking extra keys", async status => {
  fetchMock.mockResolvedValue(Response.json({ error: "Mensaje", code: "invalid_request", token: "secret" }, { status }));
  const result = await createCompany({ token: "secret", body: {} });
  expect(result).toEqual({ ok: false, error: { kind: "status", status, retryable: false }, envelope: { error: "Mensaje", code: "invalid_request" } });
  expect(fetchMock).toHaveBeenCalledTimes(1); expect(JSON.stringify(result)).not.toContain("secret");
});
it("drops oversized and malformed error envelopes", async () => {
  for (const body of [{ error: "x".repeat(9000), code: "bad" }, { error: "x" }]) {
    fetchMock.mockResolvedValue(Response.json(body, { status: 400 }));
    expect(await createCompany({ token: "secret", body: {} })).toEqual({ ok: false, error: { kind: "status", status: 400, retryable: false } });
  }
});
it("network/redirect rejection never retries", async () => {
  fetchMock.mockRejectedValue(new TypeError("redirect"));
  expect(await createCompany({ token: "secret", body: {} })).toEqual({ ok: false, error: { kind: "network", retryable: false } }); expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("classifies timeout without retry", async () => {
  vi.useFakeTimers(); fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("abort")))));
  const pending = createCompany({ token: "secret", body: {} }); await vi.advanceTimersByTimeAsync(60);
  expect(await pending).toEqual({ ok: false, error: { kind: "timeout", retryable: false } });
});
