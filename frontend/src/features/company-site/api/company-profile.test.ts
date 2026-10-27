import { afterEach, expect, it, vi } from "vitest";
import { getCompanyProfile } from "./client";
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080", apiTimeoutMs: 8000 } }));
const id = "11111111-1111-4111-8111-111111111111";
afterEach(() => vi.unstubAllGlobals());
it("decodes the public profile anonymously, ignores unrelated metadata and supplies null optionals", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ id, name: "Equipo", industry_id: "industry", location: null }), { status: 200 })));
  expect(await getCompanyProfile(id)).toEqual({ ok: true, company: { id, name: "Equipo", location: null, logo_url: null, description: null, website: null, linkedin_url: null, instagram_url: null, facebook_url: null, twitter_url: null } });
  expect(fetch).toHaveBeenCalledWith(`http://localhost:8080/companies/${id}`, expect.objectContaining({ redirect: "error" }));
  const init = vi.mocked(fetch).mock.calls[0][1]!;
  expect(new Headers(init.headers).has("authorization")).toBe(false);
});
it.each([
  { id, name: "Equipo", industry_id: "industry", location: null, logo_url: "javascript:alert(1)" },
  { id, name: "Equipo", industry_id: "industry", location: null, description: 23 },
  { id, name: "Equipo", industry_id: "industry", location: { country: 23 } },
  { id, name: "Equipo", industry_id: "industry", location: null, unexpected: "private-data" },
  { id, name: "Equipo", industry_id: "industry", location: null, founded_year: "yesterday" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Otra", industry_id: "industry", location: null },
])("fails closed for malformed or mismatched profile %j", async body => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })));
  expect(await getCompanyProfile(id)).toEqual({ ok: false });
});
it("rejects non-ids without fetching and sanitizes exceptions", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private-token")));
  expect(await getCompanyProfile("../other")).toEqual({ ok: false }); expect(fetch).not.toHaveBeenCalled();
  expect(await getCompanyProfile(id)).toEqual({ ok: false });
});
