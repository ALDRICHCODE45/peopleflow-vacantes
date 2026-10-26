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
test("first pages advertise a cursor only for further rows, and emitted continuations are disjoint", async () => {
  await json("/__reset");
  for (const query of ["q=missing-vacancy", "q=frontend", "work_mode=hybrid"]) {
    const page = publicJobsListSchema.parse(await json(`/v2/jobs?${query}`));
    expect(page.items.length).toBeLessThanOrEqual(2);
    expect(page.next_cursor).toBeNull();
    const final = publicJobsListSchema.parse(await json(`/v2/jobs?${query}&cursor=opaque+a%2Bb%2Fc%3D`));
    expect(final.items).toEqual(page.items);
    expect(final.next_cursor).toBeNull();
  }
  const first = publicJobsListSchema.parse(await json("/v2/jobs"));
  expect(first.items).toHaveLength(2);
  expect(first.next_cursor).toBe("opaque a+b/c=");
  const final = publicJobsListSchema.parse(await json(`/v2/jobs?${new URLSearchParams({ cursor: first.next_cursor! })}`));
  expect(final.items.length).toBeGreaterThan(0);
  expect(final.next_cursor).toBeNull();
  expect(final.items.every(item => !first.items.some(prior => prior.id === item.id))).toBe(true);
});
test("pending-search matches real data and preserves its observable response delay", async () => {
  await json("/__reset");
  const start = Date.now();
  const page = publicJobsListSchema.parse(await json("/v2/jobs?q=pending-search"));
  expect(Date.now() - start).toBeGreaterThanOrEqual(280);
  expect(page.items).toHaveLength(1);
  expect(`${page.items[0].title} ${page.items[0].excerpt}`.toLowerCase()).toContain("pending");
  expect(page.next_cursor).toBeNull();
  expect(publicJobDetailSchema.parse(await json(`/v2/jobs/${page.items[0].id}`)).id).toBe(page.items[0].id);
});
test("six active v2 predicates yield distinct React pages ending with the main vacancy", async () => {
  await json("/__reset");
  const query = "q=react&state=19&work_mode=remote&seniority=senior&work_schedule=full_time&salary_min=1&salary_currency=MXN&salary_period=monthly&salary_basis=gross";
  const first = publicJobsListSchema.parse(await json(`/v2/jobs?${query}`));
  expect(first.items).toHaveLength(2);
  expect(first.next_cursor).toBe("opaque a+b/c=");
  const final = publicJobsListSchema.parse(await json(`/v2/jobs?${query}&${new URLSearchParams({ cursor: first.next_cursor! })}`));
  expect(final.items.map(item => item.id)).toEqual([main]);
  expect(final.next_cursor).toBeNull();
  for (const item of [...first.items, ...final.items]) {
    expect(item.work_mode).toBe("remote");
    expect(item.seniority).toBe("senior");
    expect(item.work_schedule).toBe("full_time");
    expect(item.location?.state?.id).toBe("19");
    expect(item.compensation?.currency).toBe("MXN");
    const detail = publicJobDetailSchema.parse(await json(`/v2/jobs/${item.id}`));
    expect(`${detail.title} ${detail.description_plain}`.toLowerCase()).toContain("react");
  }
  expect(first.items.some(item => item.id === main)).toBe(false);
});
test("every USD decoy fails an active predicate, including the contract decoy's v2 work schedule", async () => {
  await json("/__reset");
  const query = new URLSearchParams("q=conjuntiva&state=19&work_mode=remote&seniority=senior&work_schedule=full_time&salary_min=1&salary_currency=USD&salary_period=monthly&salary_basis=gross");
  const exact = publicJobsListSchema.parse(await json(`/v2/jobs?${query}`));
  expect(exact.items.map(item => item.title)).toEqual(["Analista Conjuntiva de Datos"]);
  expect(exact.next_cursor).toBeNull();
  query.delete("work_schedule");
  const relaxed = publicJobsListSchema.parse(await json(`/v2/jobs?${query}`));
  expect(relaxed.items.map(item => item.title)).toEqual(["Analista Conjuntiva de Datos", "Scrum Master Conjuntiva"]);
  expect(relaxed.items[1].work_schedule).toBe("part_time");
  expect(relaxed.items[1].contract_type).toBe("professional_services");
  expect(relaxed.next_cursor).toBeNull();
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
