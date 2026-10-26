import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { afterAll, beforeAll, expect, test } from "vitest";
import { publicJobDetailSchema, publicJobsListSchema } from "../../src/features/jobs/schemas";
import { countriesSchema, statesSchema, municipalitiesSchema, postalSchema } from "../../src/features/geo/model";
import { languageCatalogSchema } from "../../src/features/languages/model";
let server: ChildProcess;
let origin: string;
beforeAll(async () => {
  server = spawn(process.execPath, ["tests/fixtures/jobs-server.mjs"], { env: { ...process.env, JOBS_FIXTURE_PORT: "0" }, stdio: ["ignore", "pipe", "pipe"] });
  const [chunk] = await once(server.stdout!, "data");
  origin = `http://127.0.0.1:${String(chunk).match(/listening on (\d+)/)![1]}`;
});
afterAll(async () => { const closed = once(server, "exit"); server.kill("SIGTERM"); await closed; });
const main = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
const rich = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d92";
async function json(path: string) { return (await fetch(`${origin}${path}`)).json(); }
test("live list and every known detail decode with the product's strict v2 schemas", async () => {
  await json("/__reset");
  const list = publicJobsListSchema.parse(await json("/v2/jobs"));
  expect(list.items.map(item => item.id)).toContain(main);
  expect(list.items.map(item => item.id)).toContain(rich);
  for (const id of [main, rich, "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d90", "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d94", "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d96"]) {
    const detail = publicJobDetailSchema.parse(await json(`/v2/jobs/${id}`));
    expect(detail.description_plain).not.toBe("");
    expect(detail.screening_questions).toBe(2);
  }
  expect(publicJobsListSchema.parse(await json("/v2/jobs?cursor=opaque+a%2Bb%2Fc%3D")).next_cursor).toBeNull();
});
test("catalog responses decode with the product's own validators", async () => {
  for (const [path, schema] of [["/v2/catalogs/languages", languageCatalogSchema], ["/v2/geo/countries", countriesSchema], ["/v2/geo/countries/MX/states", statesSchema], ["/v2/geo/countries/MX/states/19/municipalities", municipalitiesSchema], ["/v2/geo/countries/MX/postal-codes/64000", postalSchema]] as const) {
    expect(schema.safeParse(await json(path)).success).toBe(true);
  }
});
test("canonical logs, conjunctive repeated filters and controls retain their semantics", async () => {
  await json("/__reset");
  await json("/v2/jobs");
  expect(await json("/__requests")).toEqual([""]);
  const filtered = publicJobsListSchema.parse(await json("/v2/jobs?work_mode=remote&work_mode=hybrid&seniority=lead"));
  expect(filtered.items.map(item => item.id)).toEqual([rich]);
  await json(`/__visibility?id=${main}&visible=false`);
  expect((await fetch(`${origin}/v2/jobs/${main}`)).status).toBe(404);
  expect(publicJobsListSchema.parse(await json("/v2/jobs")).items.some(item => item.id === main)).toBe(false);
  await json("/__failure?kind=schema");
  expect(publicJobDetailSchema.safeParse(await json(`/v2/jobs/${rich}`)).success).toBe(false);
  await json("/__failure?kind=5xx");
  expect((await fetch(`${origin}/v2/jobs`)).status).toBe(500);
  await json("/__recover");
  expect(publicJobDetailSchema.safeParse(await json(`/v2/jobs/${rich}`)).success).toBe(true);
  await json("/__failure?kind=timeout");
  await expect(fetch(`${origin}/v2/jobs`, { signal: AbortSignal.timeout(100) })).rejects.toThrow();
  expect(await json("/__health")).toEqual({ ok: true });
  await json("/__reset");
  await json("/__visibility?hidden=1");
  expect((await fetch(`${origin}/v2/jobs/${main}`)).status).toBe(404);
  await json("/__reset");
  await json("/__delay?ms=150");
  const start = Date.now();
  await json("/v2/jobs");
  expect(Date.now() - start).toBeGreaterThanOrEqual(140);
  expect((await fetch(`${origin}/__delay?ms=5001`)).status).toBe(400);
  await json("/__reset");
  expect(await json("/__requests")).toEqual([]);
  expect(publicJobDetailSchema.safeParse(await json(`/v2/jobs/${main}`)).success).toBe(true);
});
