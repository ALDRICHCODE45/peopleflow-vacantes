import { afterEach, expect, it, vi } from "vitest";
import { getPublicSite, listCompanyJobs } from "./read";
import { companyId, publishedFixture } from "./fixtures.test-support";
import { listItem, vacancyDetail } from "@/features/jobs/api/public-fixtures";
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080", apiTimeoutMs: 50 } }));
const respond = (data: unknown, status = 200) => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(data), { status })));
afterEach(() => vi.unstubAllGlobals());
it("decodes the published projection including media with anonymous no-store transport", async () => {
  const data = publishedFixture(); respond(data);
  expect(await getPublicSite(data.slug)).toEqual({ kind: "found", data });
  expect(fetch).toHaveBeenCalledWith("http://localhost:8080/v2/company-sites/nexo-labs", expect.objectContaining({ cache: "no-store", redirect: "error" }));
  const headers = new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers);
  expect(headers.has("authorization")).toBe(false); expect(headers.has("cookie")).toBe(false);
});
it.each(["../admin", "ab", "UPPER", "empresa", "nexo/labs", ""])('invalid slug "%s" is not fetched', async slug => {
  respond({}); expect(await getPublicSite(slug)).toEqual({ kind: "notFound" }); expect(fetch).not.toHaveBeenCalled();
});
it("maps only 404 site_not_found to notFound", async () => {
  respond({ code: "site_not_found", error: "Missing" }, 404); expect(await getPublicSite("nexo-labs")).toEqual({ kind: "notFound" });
  respond({ code: "other" }, 404); expect(await getPublicSite("nexo-labs")).toEqual({ kind: "unavailable" });
});
it("old slug returns moved using the current slug in the full 200 projection", async () => {
  respond(publishedFixture()); expect(await getPublicSite("old-nexo")).toEqual({ kind: "moved", slug: "nexo-labs" });
});
it.each([{}, { ...publishedFixture(), media: null }, { ...publishedFixture(), slug: "../evil" }, { code: "moved", slug: "nexo-labs" }])("malformed 200 is unavailable", async data => {
  respond(data); expect(await getPublicSite("nexo-labs")).toEqual({ kind: "unavailable" });
});
it.each([403, 500, 503])("HTTP %s is unavailable", async status => {
  respond({}, status); expect(await getPublicSite("nexo-labs")).toEqual({ kind: "unavailable" });
});
it("network failure and timeout are unavailable", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline"))); expect(await getPublicSite("nexo-labs")).toEqual({ kind: "unavailable" });
  vi.stubGlobal("fetch", vi.fn((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))));
  expect(await getPublicSite("nexo-labs")).toEqual({ kind: "unavailable" });
});
it("company jobs reuse the strict public v2 decoder and company_id filter", async () => {
  const data = { items: [listItem(vacancyDetail)], next_cursor: null }; respond(data);
  expect(await listCompanyJobs(companyId)).toEqual({ ok: true, data });
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`http://localhost:8080/v2/jobs?company_id=${companyId}`);
  respond({ items: [{ id: companyId, title: "Malformed" }] }); expect(await listCompanyJobs(companyId)).toMatchObject({ ok: false });
});
