import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://geo.test", apiTimeoutMs: 1000 } }));
import { getCountries, getStates, getMunicipalities, getPostalCode } from "./client";
afterEach(() => vi.unstubAllGlobals());
it("uses public server transport with strict decoders and preserves zeroes in paths", async () => {
  const fetcher = vi.fn(async () => Response.json({ items: [] }));
  vi.stubGlobal("fetch", fetcher);
  await getCountries(); await getStates(); await getMunicipalities("01");
  fetcher.mockResolvedValue(Response.json({ postal_code: "01000", matches: [] }));
  expect(await getPostalCode("01000")).toEqual({ ok: true, data: { postal_code: "01000", matches: [] } });
  expect(fetcher.mock.calls.map(call => (call as unknown as [string])[0])).toEqual([
    "http://geo.test/v2/geo/countries", "http://geo.test/v2/geo/countries/MX/states", "http://geo.test/v2/geo/countries/MX/states/01/municipalities", "http://geo.test/v2/geo/countries/MX/postal-codes/01000",
  ]);
  for (const call of fetcher.mock.calls) expect(new Headers((call as unknown as [string, RequestInit])[1].headers).has("authorization")).toBe(false);
});
it("sanitizes malformed, network and known backend errors without retries", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ items: [], private: "detail" })).mockRejectedValueOnce(new Error("private"))
    .mockResolvedValueOnce(Response.json({ code: "postal_code_not_found", error: "private" }, { status: 404 }));
  vi.stubGlobal("fetch", fetcher);
  expect(await getCountries()).toEqual({ ok: false, error: "unrecognized_response" });
  expect(await getStates()).toEqual({ ok: false, error: "no_response" });
  expect(await getPostalCode("99999")).toEqual({ ok: false, error: "postal_code_not_found" });
  expect(fetcher).toHaveBeenCalledTimes(3);
  await getMunicipalities("../"); await getPostalCode("1");
  expect(fetcher).toHaveBeenCalledTimes(3);
});
