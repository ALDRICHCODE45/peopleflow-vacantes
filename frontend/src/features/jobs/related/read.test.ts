import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080", apiTimeoutMs: 20, sampleJobs: false } }));
vi.mock("@/lib/api/server", async () => ({ requestJson: (await import("@/lib/api/requestJson")).requestJson }));
vi.mock("@/features/company-site/api/client", () => ({ getCompanyProfile: vi.fn() }));
import { serverEnv } from "@/lib/env/server";
import { getCompanyProfile } from "@/features/company-site/api/client";
import { listItem, vacancyDetail, legacyDetail } from "../api/public-fixtures";
import { listJobs } from "../api/listJobs";
import type { PublicJobItem } from "../types";
import { readCompanyVacancies, readSimilarVacancies, readRelatedCompany } from "./read";

const env = serverEnv as { sampleJobs: boolean };
const item = (suffix: number, own = false) => ({ ...listItem(vacancyDetail), id: `0198f5a2-7c1b-7ddd-9c2e-${String(suffix).padStart(12, "0")}`, company: own ? vacancyDetail.company : { ...vacancyDetail.company, id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c80b1" } });
const response = (items: PublicJobItem[]) => new Response(JSON.stringify({ items, next_cursor: null }), { status: 200 });
afterEach(() => { env.sampleJobs = false; vi.unstubAllGlobals(); vi.clearAllMocks(); vi.useRealTimers(); });

it("pins the existing canonical list URL byte-for-byte", async () => {
  const fetch = vi.fn().mockResolvedValue(response([])); vi.stubGlobal("fetch", fetch);
  await listJobs({ q: " Go ", state: ["09", "19", "09"], work_mode: "remote", professional_area: "technology_systems", cursor: "a+b/=" });
  expect(fetch.mock.calls[0][0]).toBe("http://localhost:8080/v2/jobs?q=Go&state=09&state=19&work_mode=remote&professional_area=technology_systems&cursor=a%2Bb%2F%3D");
});
it("reads company limit 4, excludes current and preserves catalog order with a cap of 3", async () => {
  const jobs = [item(4, true), item(3, true), item(2, true), item(1, true)];
  const fetch = vi.fn().mockResolvedValue(response([listItem(vacancyDetail), ...jobs])); vi.stubGlobal("fetch", fetch);
  expect(await readCompanyVacancies(vacancyDetail)).toEqual({ ok: true, data: jobs.slice(0, 3) });
  expect(fetch.mock.calls.map(c => c[0])).toEqual([`http://localhost:8080/v2/jobs?company_id=${vacancyDetail.company.id}&limit=4`]);
});
it("prefers state, excludes current and own company, and fills uniquely from the area", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response([listItem(vacancyDetail), item(1, true), item(2)]))
    .mockResolvedValueOnce(response([item(2), item(3, true), item(4), item(4), item(5), item(6)]));
  vi.stubGlobal("fetch", fetch);
  expect(await readSimilarVacancies(vacancyDetail)).toEqual({ ok: true, data: [item(2), item(4), item(5)] });
  expect(fetch.mock.calls.map(c => c[0])).toEqual([
    "http://localhost:8080/v2/jobs?state=09&professional_area=technology_systems&limit=7",
    "http://localhost:8080/v2/jobs?professional_area=technology_systems&limit=7",
  ]);
});
it("does not fill a full state result and caps at 3", async () => {
  const fetch = vi.fn().mockResolvedValue(response([item(1), item(2), item(3), item(4)])); vi.stubGlobal("fetch", fetch);
  expect(await readSimilarVacancies(vacancyDetail)).toEqual({ ok: true, data: [item(1), item(2), item(3)] });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("without state reads the area just once; without area reads nothing", async () => {
  const fetch = vi.fn().mockResolvedValue(response([])); vi.stubGlobal("fetch", fetch);
  expect(await readSimilarVacancies({ ...vacancyDetail, location: null })).toEqual({ ok: true, data: [] });
  expect(fetch.mock.calls.map(c => c[0])).toEqual(["http://localhost:8080/v2/jobs?professional_area=technology_systems&limit=7"]);
  fetch.mockClear();
  expect(await readSimilarVacancies(legacyDetail)).toEqual({ ok: true, data: [] });
  expect(fetch).not.toHaveBeenCalled();
});
it.each(["company", "state", "fill"])("omits the entire section on %s failure", async (stage) => {
  const fetch = vi.fn();
  if (stage === "fill") fetch.mockResolvedValueOnce(response([item(1)]));
  fetch.mockRejectedValue(new TypeError("offline")); vi.stubGlobal("fetch", fetch);
  const result = await (stage === "company" ? readCompanyVacancies(vacancyDetail) : readSimilarVacancies(vacancyDetail));
  expect(result).toEqual({ ok: false }); expect(result).not.toHaveProperty("data");
});
it("omits a timed out read without throwing", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))))));
  const pending = readCompanyVacancies(vacancyDetail);
  await vi.advanceTimersByTimeAsync(30);
  expect(await pending).toEqual({ ok: false });
});
it("reuses the anonymous company read and projects no private or invented fields", async () => {
  vi.mocked(getCompanyProfile).mockResolvedValue({ ok: true, company: { ...vacancyDetail.company, description: "Descripción publicada", location: null, website: null, linkedin_url: null, instagram_url: null, facebook_url: null, twitter_url: null } });
  expect(await readRelatedCompany(vacancyDetail)).toEqual({ ok: true, data: { ...vacancyDetail.company, description: "Descripción publicada", sector: null, size: null, careersHref: null } });
  expect(getCompanyProfile).toHaveBeenCalledWith(vacancyDetail.company.id);
  vi.mocked(getCompanyProfile).mockResolvedValue({ ok: false });
  expect(await readRelatedCompany(vacancyDetail)).toEqual({ ok: false });
});
it("sample mode is offline, including company filtering and absent legacy area", async () => {
  env.sampleJobs = true; const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const { findSampleJob, SAMPLE_JOBS } = await import("../sample-jobs");
  const job = findSampleJob(SAMPLE_JOBS[2].id)!;
  const result = await readCompanyVacancies(job);
  expect(result.ok && result.data.map(j => j.id)).toEqual([SAMPLE_JOBS[3].id]);
  expect(await readSimilarVacancies(job)).toEqual({ ok: true, data: [] });
  expect(await readRelatedCompany(job)).toEqual({ ok: true, data: { ...job.company, description: null, sector: null, size: null, careersHref: null } });
  expect(fetch).not.toHaveBeenCalled(); expect(getCompanyProfile).not.toHaveBeenCalled();
});
