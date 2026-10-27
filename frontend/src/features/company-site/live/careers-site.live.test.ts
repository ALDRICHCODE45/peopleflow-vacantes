// @vitest-environment node
import { deflateSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateServerEnv } from "@/lib/env/validate";
import { getSite, publishSite, putDraft, unpublishSite } from "../api/client";
import { uploadMediaFile } from "../api/file-client";
import type { SiteResult } from "../api/model";
import { defaultBlock } from "../defaults";
import { siteDraftSchema } from "../model";
import { getPublicSite, listCompanyJobs } from "../public/read";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/server", async () => {
  const { validateServerEnv } = await import("@/lib/env/validate");
  return { serverEnv: validateServerEnv(process.env) };
});

// Same canonical rich-text fixture as model.test.ts (its helper is not exported).
const rich = (text: string) => ({ schema_version: 1, document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] } });

function required(name: string): string {
  const value = process.env[name];
  // Never attach environment values (especially Bearer tokens) to assertions.
  if (!value) throw new Error(`Missing required live environment variable: ${name}`);
  return value;
}
function success(result: SiteResult) {
  expect(result.kind).toBe("success");
  if (result.kind !== "success") throw new Error(`Expected site success, received ${result.kind}`);
  expect(result.etag).toBe(`"${result.data.draft_version}"`);
  return result;
}

// Minimal real RGB PNG, generated entirely in memory: filter-byte rows + zlib + CRC32.
function png(): Uint8Array<ArrayBuffer> {
  function chunk(type: string, data: Buffer) {
    const content = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of content) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, content, checksum]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(400, 0); header.writeUInt32BE(225, 4);
  header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc((400 * 3 + 1) * 225, 120);
  for (let row = 0; row < 225; row++) pixels[row * (400 * 3 + 1)] = 0;
  return new Uint8Array(Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0)),
  ]));
}
function multipart(file: File): FormData {
  const body = new FormData(); body.set("kind", "cover"); body.set("file", file); return body;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe.skipIf(!process.env.PF_LIVE_API)("careers site: isolated live backend", () => {
  it("exercises the ordered private, media, publication and public contract", async () => {
    const api = required("PF_LIVE_API");
    // Restrict this mutating opt-in test to the explicitly supplied isolated server.
    expect(api).toBe("http://127.0.0.1:8090");
    vi.stubEnv("PEOPLEFLOW_API_BASE_URL", api);
    vi.stubEnv("PEOPLEFLOW_SITE_URL", "http://127.0.0.1:8090");
    vi.stubEnv("PEOPLEFLOW_LOCAL_PREVIEW", "true");
    vi.stubEnv("PEOPLEFLOW_SAMPLE_JOBS", "false");
    vi.stubEnv("PEOPLEFLOW_API_TIMEOUT_MS", "8000");
    expect(validateServerEnv(process.env).apiBaseUrl).toBe(api);
    const recruiter = required("PF_LIVE_RECRUITER");
    const owner = required("PF_LIVE_OWNER");
    const foreignOwner = required("PF_LIVE_FOREIGN_OWNER");
    const companyId = required("PF_LIVE_COMPANY_ID");
    const foreignCompanyId = required("PF_LIVE_FOREIGN_COMPANY_ID");
    const jobId = required("PF_LIVE_JOB_ID");
    const slug = `nexo-e2e-${Date.now()}`;
    const newSlug = `${slug}-moved`;

    // Pass through to the real transport. Retain only statuses, never request headers/tokens.
    const fetchReal = globalThis.fetch;
    const statuses: number[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (...args) => {
      const response = await fetchReal(...args);
      statuses.push(response.status);
      return response;
    });
    const status = (expected: number) => expect(statuses.at(-1)).toBe(expected);
    const observed = (step: number, outcome: string) => console.info(`Live step ${step}: ${outcome}`);

    let current = success(await getSite(recruiter)); status(200);
    const heroes = current.data.draft.blocks.filter(block => block.type === "hero");
    const jobsBlocks = current.data.draft.blocks.filter(block => block.type === "jobs");
    expect(heroes).toHaveLength(1);
    expect(jobsBlocks).toHaveLength(1);
    observed(1, "GET 200, matching current ETag, exactly one hero + one jobs");

    const story = { ...defaultBlock("story"), type: "story" as const, variant: "text" as const,
      content: { title: "Nuestra historia", body: rich("Construimos oportunidades reales."), image: null } };
    const testimonial = { ...defaultBlock("testimonials"), type: "testimonials" as const, variant: "cards" as const,
      content: { items: [{ quote: "Un gran equipo", name: "Persona E2E", role: null, photo: null, consent: false }] } };
    const hidden = { ...defaultBlock("closing"), hidden: true };
    // Keep the current document/theme/SEO and required block identities, replacing
    // optional blocks with this run's controlled consent/visibility fixtures.
    let draft = siteDraftSchema.parse({ ...current.data.draft, slug, blocks: [
      { ...heroes[0], type: "hero", variant: "photo", content: { title: "Trabaja en Nexo Labs", subtitle: null, cover: null } },
      jobsBlocks[0], story, testimonial, hidden,
    ] });
    const staleTag = current.etag;
    const initialVersion = current.data.draft_version;
    current = success(await putDraft(recruiter, { body: draft, ifMatch: current.etag })); status(200);
    expect(current.data.draft_version).toBe(initialVersion + 1);
    const saved = current;
    current = success(await putDraft(recruiter, { body: current.data.draft, ifMatch: current.etag })); status(200);
    expect(current).toEqual(saved);
    draft = current.data.draft;
    observed(2, "PUT 200 version +1; identical PUT 200 same state/ETag");

    const conflict = await putDraft(recruiter, { body: draft, ifMatch: staleTag }); status(412);
    expect(conflict).toEqual({ kind: "conflict", current: current.data });
    observed(3, "stale PUT 412 with current");
    const tooLong = { ...draft, blocks: draft.blocks.map(block => block.type === "hero" ? { ...block, content: { ...block.content, title: "x".repeat(81) } } : block) };
    fetchSpy.mockClear();
    expect(await putDraft(recruiter, { body: tooLong, ifMatch: current.etag })).toEqual({ kind: "invalid_request" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await putDraft(recruiter, { body: { ...draft, slug: "admin" }, ifMatch: current.etag })).toEqual({ kind: "invalid_request" });
    expect(fetchSpy).not.toHaveBeenCalled();
    observed(3, "too-long title and admin rejected locally as invalid_request; zero fetch calls");

    const uploaded = await uploadMediaFile(recruiter, multipart(new File([png()], "cover.png", { type: "image/png" })), "cover"); status(201);
    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) throw new Error(`Upload failed: ${uploaded.code}`);
    expect(uploaded.data).toMatchObject({ kind: "cover", width: 400, height: 225, content_type: "image/png" });
    expect(uploaded.data.url).toBe(`/v2/company-sites/media/${uploaded.data.id}`);
    expect(await uploadMediaFile(recruiter, multipart(new File(["not an image"], "unsupported.txt", { type: "text/plain" })), "cover"))
      .toEqual({ ok: false, status: 415, code: "unsupported_media_type" }); status(415);
    observed(4, "PNG 201 (400×225), unsupported file 415");

    // Persist the uploaded cover before publishing; keep consent false for the gate check.
    draft = { ...current.data.draft, blocks: current.data.draft.blocks.map(block => block.type === "hero" ? { ...block, content: { ...block.content, cover: { media_id: uploaded.data.id } } } : block) };
    current = success(await putDraft(recruiter, { body: draft, ifMatch: current.etag })); status(200);
    expect(await publishSite(recruiter, current.etag)).toEqual({ kind: "error", code: "forbidden" }); status(403);
    expect(await publishSite(owner, current.etag)).toEqual({ kind: "error", code: "publish_blocked", issues: [{ code: "block_incomplete", field: "blocks[3]" }] }); status(422);
    draft = { ...current.data.draft, blocks: current.data.draft.blocks.map(block => block.type === "testimonials" ? { ...block, content: { items: block.content.items.map(item => ({ ...item, consent: true })) } } : block) };
    current = success(await putDraft(recruiter, { body: draft, ifMatch: current.etag })); status(200);
    current = success(await publishSite(owner, current.etag)); status(200);
    expect(current.data.published).toMatchObject({ version: current.data.draft_version, slug });
    observed(5, "recruiter 403; owner 422 consent gate; consent save + owner publish 200");

    const publicSite = await getPublicSite(slug); status(200);
    expect(publicSite.kind).toBe("found");
    if (publicSite.kind !== "found") throw new Error(`Public read: ${publicSite.kind}`);
    expect(publicSite.data.company.id).toBe(companyId);
    expect(publicSite.data.site.blocks.map(block => block.id)).toEqual(draft.blocks.filter(block => !block.hidden).map(block => block.id));
    expect(publicSite.data.site.blocks.every(block => !block.hidden)).toBe(true);
    expect(publicSite.data.media).toContainEqual(expect.objectContaining({ id: uploaded.data.id, kind: "cover" }));
    const jobs = await listCompanyJobs(companyId); status(200);
    expect(jobs.ok).toBe(true);
    if (!jobs.ok) throw new Error("Company jobs decode failed");
    expect(jobs.data.items.map(job => job.id)).toContain(jobId);
    const foreignJobs = await listCompanyJobs(foreignCompanyId); status(200);
    expect(foreignJobs).toMatchObject({ ok: true, data: { items: [] } });
    observed(6, "public found 200, hidden omitted, cover present; own jobs present, foreign empty");

    draft = { ...current.data.draft, slug: newSlug };
    current = success(await putDraft(recruiter, { body: draft, ifMatch: current.etag })); status(200);
    current = success(await publishSite(owner, current.etag)); status(200);
    expect(await getPublicSite(slug)).toEqual({ kind: "moved", slug: newSlug }); status(200);
    observed(7, "slug saved/republished 200; old slug moved to new slug");

    const foreign = success(await getSite(foreignOwner)); status(200);
    expect(foreign.data.draft.blocks.map(block => block.id)).not.toEqual(current.data.draft.blocks.map(block => block.id));
    expect(foreign.data.draft.slug).not.toBe(newSlug);
    const foreignPublish = await publishSite(foreignOwner, foreign.etag); status(422);
    expect(foreignPublish).toMatchObject({ kind: "error", code: "publish_blocked", issues: expect.arrayContaining([{ code: "company_logo_missing", field: null }]) });
    observed(8, "foreign GET 200 distinct site; publish 422 company_logo_missing");

    current = success(await unpublishSite(owner)); status(200);
    expect(current.data.published).toBeNull();
    expect(await getPublicSite(newSlug)).toEqual({ kind: "notFound" }); status(404);
    observed(9, "owner unpublish 200; public notFound 404");
  }, 120_000);
});
