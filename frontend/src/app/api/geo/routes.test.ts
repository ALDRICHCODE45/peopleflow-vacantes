import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/features/geo/client", () => ({ getCountries: vi.fn(), getStates: vi.fn(), getMunicipalities: vi.fn(), getPostalCode: vi.fn() }));
import * as client from "@/features/geo/client";
import { GET as countries } from "./countries/route";
import { GET as states } from "./countries/mx/states/route";
import { GET as municipalities } from "./countries/mx/states/[state]/municipalities/route";
import { GET as postal } from "./countries/mx/postal-codes/[cp]/route";
const request = () => new Request("http://localhost/api/geo/countries");
beforeEach(() => vi.resetAllMocks());
it("validates path parameters before any backend call", async () => {
  expect((await municipalities(request(), { params: Promise.resolve({ state: "1/../" }) })).status).toBe(400);
  expect((await postal(request(), { params: Promise.resolve({ cp: "１２３４５" }) })).status).toBe(400);
  expect(client.getMunicipalities).not.toHaveBeenCalled(); expect(client.getPostalCode).not.toHaveBeenCalled();
});
it("forwards all four public successes with a daily cache header", async () => {
  const data = { items: [{ id: "MX", name: "México" }] };
  vi.mocked(client.getCountries).mockResolvedValue({ ok: true, data });
  vi.mocked(client.getStates).mockResolvedValue({ ok: true, data: { items: [{ id: "01", name: "Estado" }] } });
  vi.mocked(client.getMunicipalities).mockResolvedValue({ ok: true, data: { items: [{ id: "01001", name: "Municipio" }] } });
  vi.mocked(client.getPostalCode).mockResolvedValue({ ok: true, data: { postal_code: "01000", matches: [] } });
  const responses = [await countries(request()), await states(request()), await municipalities(request(), { params: Promise.resolve({ state: "01" }) }), await postal(request(), { params: Promise.resolve({ cp: "01000" }) })];
  for (const response of responses) { expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("public, max-age=86400"); }
  expect(await responses[0].json()).toEqual(data);
  expect(client.getMunicipalities).toHaveBeenCalledWith("01"); expect(client.getPostalCode).toHaveBeenCalledWith("01000");
});
it("sanitizes failures and thrown exceptions, never caching errors", async () => {
  vi.mocked(client.getCountries).mockResolvedValue({ ok: false, error: "unrecognized_response" });
  const response = await countries(request());
  expect(response.status).toBe(502); expect(await response.json()).toEqual({ code: "unrecognized_response" });
  expect(response.headers.get("cache-control")).toBe("no-store");
  vi.mocked(client.getCountries).mockRejectedValue(new Error("private backend detail"));
  expect(await (await countries(request())).json()).toEqual({ code: "no_response" });
});
it("rejects unsupported queries without calling the backend", async () => {
  expect((await countries(new Request("http://localhost/api/geo/countries?secret=x"))).status).toBe(400);
  expect(client.getCountries).not.toHaveBeenCalled();
});

it("never caches an empty catalog list, so a later import shows up without a hard reload", async () => {
  // User report: «GET /api/geo/countries con este response: {"items":[]}» kept for 24 h after importing.
  vi.mocked(client.getCountries).mockResolvedValue({ ok: true, data: { items: [] } });
  const response = await countries(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ items: [] });
  expect(response.headers.get("cache-control")).toBe("no-store");
});
