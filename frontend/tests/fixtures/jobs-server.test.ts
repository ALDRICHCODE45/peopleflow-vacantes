import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { siteStateSchema, decodeFailure, availabilitySchema } from "../../src/features/company-site/api/model";
import { uploadedMediaSchema } from "../../src/features/company-site/media";
import { defaultSiteDraft } from "../../src/features/company-site/defaults";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { afterAll, beforeAll, expect, test } from "vitest";
import { publicJobDetailSchema, publicJobsListSchema } from "../../src/features/jobs/schemas";
import { countriesSchema, statesSchema, municipalitiesSchema, postalSchema, locationReadSchema } from "../../src/features/geo/model";
import { languageCatalogSchema } from "../../src/features/languages/model";
import { publicSiteSchema } from "../../src/features/company-site/public/schema";
import { ICONS, publishIssues, siteDraftSchema } from "../../src/features/company-site/model";
let server: ChildProcess;
let origin: string;
beforeAll(async () => {
  server = spawn(process.execPath, ["tests/fixtures/jobs-server.mjs"], { env: { ...process.env, JOBS_FIXTURE_PORT: "0" }, stdio: ["ignore", "pipe", "pipe"] });
  const [chunk] = await once(server.stdout!, "data");
  origin = `http://127.0.0.1:${String(chunk).match(/listening on (\d+)/)![1]}`;
});
afterAll(async () => { const closed = once(server, "exit"); server.kill("SIGTERM"); await closed; });
const nexo = "b478fb93-71b8-47bf-8eaa-b726d63e01a0";
const main = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
const rich = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d92";
async function json(path: string) { return (await fetch(`${origin}${path}`)).json(); }
const privateSite = "/v2/me/company/site";
const auth = { authorization: "Bearer fixture-review-only" };
async function siteRequest(suffix = "", method = "GET", body?: unknown, tag?: string) {
  return fetch(`${origin}${privateSite}${suffix}`, { method, headers: { ...auth, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(tag === undefined ? {} : { "if-match": tag }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function readDraft() {
  const response = await siteRequest();
  expect(response.status).toBe(200);
  const state = siteStateSchema.parse(await response.json());
  expect(response.headers.get("etag")).toBe(`"${state.draft_version}"`);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return state;
}
test("decoration validation has backend field paths and codes and accepts emoji", async () => {
  await json("/__reset");
  const initial = await readDraft();
  const index = initial.draft.blocks.findIndex(block => block.type === "values");
  for (const [icon, emoji, field, code] of [
    [null, null, "icon", "required"], ["heart", "😀", "emoji", "not_allowed"],
    [null, "ab", "emoji", "invalid"], [null, "😀😀", "emoji", "invalid"],
    [null, "a".repeat(33), "emoji", "too_long"], ["unknown", null, "icon", "invalid"],
  ]) {
    const draft = structuredClone(initial.draft);
    Object.assign((draft.blocks[index].content as { items: object[] }).items[0], { icon, emoji });
    const response = await siteRequest("/draft", "PUT", draft, '"1"');
    expect(response.status).toBe(400);
    expect((await response.json()).fields).toContainEqual({ field: `blocks[${index}].content.items[0].${field}`, code });
  }
  for (const emoji of ["👩‍💻", "🇲🇽", "👍🏽"]) {
    const draft = structuredClone(initial.draft);
    Object.assign((draft.blocks[index].content as { items: object[] }).items[0], { icon: null, emoji });
    const state = await readDraft();
    const response = await siteRequest("/draft", "PUT", draft, `"${state.draft_version}"`);
    expect(response.status).toBe(200);
  }
});

test("all 111 fixture icons save in contract order and missing emoji normalizes", async () => {
  await json("/__reset");
  const state = await readDraft();
  const index = state.draft.blocks.findIndex(block => block.type === "benefits");
  let version = state.draft_version;
  for (let start = 0; start < ICONS.length; start += 24) {
    const draft = structuredClone(state.draft);
    const icons = ICONS.slice(start, start + 24);
    draft.blocks[index].content = { items: icons.map(icon => ({ icon, title: null, description: null })) } as never;
    const response = await siteRequest("/draft", "PUT", draft, `"${version}"`);
    expect(response.status).toBe(200);
    const saved = siteStateSchema.parse(await response.json());
    version = saved.draft_version;
    const block = saved.draft.blocks[index];
    expect(block.type === "benefits" && block.content.items.map(item => [item.icon, item.emoji])).toEqual(icons.map(icon => [icon, null]));
  }
});

test("palette fixture keeps canonical keys across visual controls and legacy writes", async () => {
  await json("/__reset");
  await json("/__site?brand=green");
  const initialRaw = await (await siteRequest()).json();
  expect(initialRaw.draft.theme).toEqual({ brand_color: "#15803D", accent_color: null, background_color: null, font_pair: "modern" });
  const legacy = { ...initialRaw.draft, theme: { brand_color: "#15803D", font_pair: "modern" } };
  const response = await siteRequest("/draft", "PUT", legacy, '"1"');
  expect(response.status).toBe(200);
  expect((await response.json()).draft.theme).toEqual(initialRaw.draft.theme);
});
test("palette fixture validates exact nullable hex with backend paths and uppercase storage", async () => {
  await json("/__reset");
  const initial = await readDraft();
  for (const key of ["accent_color", "background_color"]) {
    for (const value of ["#123", " #abcdef ", "#GGGGGG", false, 42, ""]) {
      const response = await siteRequest("/draft", "PUT", { ...initial.draft, theme: { ...initial.draft.theme, [key]: value } }, '"1"');
      expect(response.status).toBe(400);
      expect(decodeFailure(400, await response.json())).toEqual({ kind: "invalid", fields: [{ field: `theme.${key}`, code: "invalid" }] });
    }
  }
  expect(await readDraft()).toEqual(initial);
  const response = await siteRequest("/draft", "PUT", { ...initial.draft, theme: { ...initial.draft.theme, accent_color: "#abcdef", background_color: "#fedcba" } }, '"1"');
  expect(response.status).toBe(200);
  const state = await response.json();
  expect(state.draft.theme).toMatchObject({ accent_color: "#ABCDEF", background_color: "#FEDCBA" });
  const published = await siteRequest("/publish", "POST", undefined, '"2"');
  expect(published.status).toBe(200);
  expect((await json("/v2/company-sites/nexo-labs")).site.theme).toEqual(state.draft.theme);
});

test("authenticated draft starts from Nexo's snapshot and saves canonically with CAS and no-op", async () => {
  await json("/__reset");
  const initial = await readDraft();
  const snapshot = publicSiteSchema.parse(await json("/v2/company-sites/nexo-labs"));
  expect(initial.draft).toEqual({ ...snapshot.site, slug: snapshot.slug });
  expect(initial.published?.version).toBe(initial.draft_version);
  expect(initial.has_unpublished_changes).toBe(false);
  const draft = structuredClone(initial.draft);
  draft.seo.title = "  Nuevo título  ";
  const saved = await siteRequest("/draft", "PUT", draft, '"1"');
  expect(saved.status).toBe(200);
  expect(saved.headers.get("etag")).toBe('"2"');
  const state = siteStateSchema.parse(await saved.json());
  expect(state.draft.seo.title).toBe("Nuevo título");
  expect(state.has_unpublished_changes).toBe(true);
  expect(state.published).toEqual(initial.published);
  const noop = await siteRequest("/draft", "PUT", draft, '"2"');
  expect(await noop.json()).toEqual(state);
  expect(noop.headers.get("etag")).toBe('"2"');
  const stale = await siteRequest("/draft", "PUT", initial.draft, '"1"');
  expect(stale.status).toBe(412);
  expect(stale.headers.get("etag")).toBe('"2"');
  expect(decodeFailure(412, await stale.json())).toEqual({ kind: "conflict", current: state });
  expect(await readDraft()).toEqual(state);
  expect(await json("/v2/company-sites/nexo-labs")).toEqual(snapshot);
});

test("draft validation and preconditions reject without mutations; slug availability matches saves", async () => {
  await json("/__reset");
  const initial = await readDraft();
  const malformed = await fetch(`${origin}${privateSite}/draft`, { method: "PUT", headers: { ...auth, "if-match": '"1"' }, body: "{" });
  expect(malformed.status).toBe(400);
  expect(decodeFailure(400, await malformed.json())).toEqual({ kind: "error", code: "invalid_request" });
  const oversized = await fetch(`${origin}${privateSite}/draft`, { method: "PUT", headers: { ...auth, "if-match": '"1"' }, body: JSON.stringify({ text: "x".repeat(1024 * 1024) }) });
  expect(oversized.status).toBe(413);
  expect(decodeFailure(413, await oversized.json())).toEqual({ kind: "error", code: "payload_too_large" });
  for (const [tag, status, code] of [[undefined, 428, "precondition_required"], ["1", 400, "invalid_request"]] as const) {
    const response = await siteRequest("/draft", "PUT", initial.draft, tag);
    expect(response.status).toBe(status);
    expect(decodeFailure(status, await response.json())).toMatchObject({ kind: "error", code });
  }
  for (const draft of [{ ...initial.draft, extra: true }, { ...initial.draft, seo: { ...initial.draft.seo, title: "x".repeat(61) } }, { ...initial.draft, blocks: [] }]) {
    const response = await siteRequest("/draft", "PUT", draft, '"1"');
    expect(response.status).toBe(400);
    expect(decodeFailure(400, await response.json())).toMatchObject({ kind: "invalid", fields: expect.arrayContaining([expect.objectContaining({ field: expect.any(String) })]) });
  }
  for (const [slug, available, reason] of [["nexo-labs", true, null], ["nuevo-nexo", true, null], ["admin", false, "reserved"], ["BAD SLUG", false, "invalid"], ["otra-empresa", false, "taken"]] as const) {
    const response = await siteRequest(`/slug-availability?${new URLSearchParams({ slug })}`);
    expect(availabilitySchema.parse(await response.json())).toEqual({ slug, available, reason });
  }
  for (const [slug, status, code] of [["admin", 422, "slug_reserved"], ["otra-empresa", 409, "slug_taken"]] as const) {
    const response = await siteRequest("/draft", "PUT", { ...initial.draft, slug }, '"1"');
    expect(response.status).toBe(status);
    expect(decodeFailure(status, await response.json())).toMatchObject({ kind: "error", code, field: "slug" });
  }
  expect(await readDraft()).toEqual(initial);
});

test("a PUT rechecks its version after consuming a delayed body, preventing a lost update", async () => {
  await json("/__reset");
  const initial = await readDraft();
  const delayedBody = JSON.stringify({ ...initial.draft, seo: { ...initial.draft.seo, title: "Delayed writer" } });
  const delayed = httpRequest(`${origin}${privateSite}/draft`, { method: "PUT", headers: { ...auth, "if-match": '"1"', "content-type": "application/json" } });
  const result = new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    delayed.on("error", reject);
    delayed.on("response", response => {
      const chunks: Buffer[] = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
  });
  delayed.flushHeaders();
  await new Promise<void>(resolve => delayed.write(delayedBody.slice(0, 20), () => resolve()));
  // Let the standalone HTTP server enter its body read before the other writer.
  await new Promise(resolve => setTimeout(resolve, 30));
  await readDraft();
  const winner = await siteRequest("/draft", "PUT", { ...initial.draft, seo: { ...initial.draft.seo, title: "Winning writer" } }, '"1"');
  expect(winner.status).toBe(200);
  const winningState = siteStateSchema.parse(await winner.json());
  delayed.end(delayedBody.slice(20));
  const response = await result;
  expect(response.status).toBe(412);
  expect(decodeFailure(412, response.body)).toEqual({ kind: "conflict", current: winningState });
  expect(await readDraft()).toEqual(winningState);
});

test("owner publication copies the draft, filters hidden blocks, moves slugs and unpublishes idempotently", async () => {
  await json("/__reset");
  const initial = await readDraft();
  const draft = structuredClone(initial.draft);
  draft.slug = "nuevo-nexo";
  draft.blocks.find(block => block.type === "story")!.hidden = true;
  await siteRequest("/draft", "PUT", draft, '"1"');
  expect((await siteRequest("/publish", "POST")).status).toBe(428);
  expect((await siteRequest("/publish", "POST", undefined, '"1"')).status).toBe(412);
  const response = await siteRequest("/publish", "POST", undefined, '"2"');
  expect(response.status).toBe(200);
  const published = siteStateSchema.parse(await response.json());
  expect(published.published).toMatchObject({ version: 2, slug: draft.slug });
  expect(published.has_unpublished_changes).toBe(false);
  const snapshot = publicSiteSchema.parse(await json("/v2/company-sites/nuevo-nexo"));
  expect(snapshot.site.blocks.some(block => block.type === "story")).toBe(false);
  expect(snapshot.media.some(item => item.kind === "story")).toBe(false);
  expect(await json("/v2/company-sites/nexo-labs")).toEqual(snapshot);
  draft.seo.title = "Todavía privado";
  await siteRequest("/draft", "PUT", draft, '"2"');
  expect(await json("/v2/company-sites/nuevo-nexo")).toEqual(snapshot);
  for (let i = 0; i < 2; i++) {
    const response = await siteRequest("/unpublish", "POST");
    expect(response.status).toBe(200);
    expect(siteStateSchema.parse(await response.json()).published).toBeNull();
    for (const slug of ["nexo-labs", "nuevo-nexo", "nexo-equipo"]) expect((await fetch(`${origin}/v2/company-sites/${slug}`)).status).toBe(404);
  }
});

test("draft controls cover recruiter permissions, forbidden/inactive gates and new-site publish issues", async () => {
  await json("/__reset");
  expect((await fetch(`${origin}${privateSite}`)).status).toBe(401);
  await json("/__site-draft?role=recruiter");
  const initial = await readDraft();
  expect((await siteRequest("/draft", "PUT", initial.draft, '"1"')).status).toBe(200);
  for (const suffix of ["/publish", "/unpublish"]) {
    const response = await siteRequest(suffix, "POST", undefined, '"1"');
    expect(response.status).toBe(403);
    expect(decodeFailure(403, await response.json())).toEqual({ kind: "error", code: "forbidden" });
  }
  for (const code of ["forbidden", "company_inactive"]) {
    await json(`/__site-draft?gate=${code}`);
    for (const [suffix, method] of [["", "GET"], ["/draft", "PUT"], ["/publish", "POST"], ["/unpublish", "POST"], ["/media", "POST"], ["/slug-availability?slug=nexo-labs", "GET"]]) {
      const response = await siteRequest(suffix, method);
      expect(response.status).toBe(403);
      expect(decodeFailure(403, await response.json())).toEqual({ kind: "error", code });
    }
  }
  await json("/__reset");
  await json("/__site-draft?mode=new");
  const fresh = await readDraft();
  const defaults = defaultSiteDraft();
  expect(fresh.draft).toEqual({ ...defaults, blocks: defaults.blocks.map((block, i) => ({ ...block, id: fresh.draft.blocks[i].id })) });
  expect(fresh.published).toBeNull();
  expect(fresh.media).toEqual([]);
  expect((await fetch(`${origin}/v2/company-sites/nexo-labs`)).status).toBe(404);
  const blocked = await siteRequest("/publish", "POST", undefined, '"1"');
  expect(blocked.status).toBe(422);
  expect(decodeFailure(422, await blocked.json())).toMatchObject({ kind: "error", code: "publish_blocked", issues: publishIssues(fresh.draft, { name: "Nexo Labs", logo_url: "fixture" }) });
  expect((await fetch(`${origin}/__site-draft?role=invalid&mode=new`)).status).toBe(400);
  await json("/__reset");
  expect((await readDraft()).draft).toEqual(initial.draft);
});

test("one-shot conflict and offline controls preserve server authority and reset clears pending faults", async () => {
  await json("/__reset");
  const initial = await readDraft();
  await json("/__site-draft?conflict=next");
  const conflict = await siteRequest("/draft", "PUT", initial.draft, '"1"');
  expect(conflict.status).toBe(412);
  const failure = decodeFailure(412, await conflict.json());
  expect(failure.kind).toBe("conflict");
  const current = await readDraft();
  expect(current.draft_version).toBe(2);
  expect(current.draft).not.toEqual(initial.draft);
  expect(failure).toEqual({ kind: "conflict", current });
  expect((await siteRequest("/draft", "PUT", current.draft, '"2"')).status).toBe(200);
  await json("/__site-draft?offline=next");
  await expect(siteRequest("/draft", "PUT", initial.draft, '"2"')).rejects.toThrow();
  expect(await readDraft()).toEqual(current);
  expect((await siteRequest("/draft", "PUT", current.draft, '"2"')).status).toBe(200);
  await json("/__site-draft?offline=next&conflict=next&role=recruiter");
  await json("/__reset");
  expect((await siteRequest("/draft", "PUT", initial.draft, '"1"')).status).toBe(200);
  expect((await siteRequest("/publish", "POST", undefined, '"1"')).status).toBe(200);
});

test("multipart media upload returns product-decodable media, serves bytes and resets uploads", async () => {
  await json("/__reset");
  const bytes = readFileSync(new URL("../../public/company/acme-cover.webp", import.meta.url));
  const upload = (extra = false, type = "image/webp", data = bytes) => {
    const body = new FormData();
    body.set("kind", "cover");
    body.set("file", new Blob([new Uint8Array(data)], { type }), "image.webp");
    if (extra) body.set("unexpected", "value");
    return fetch(`${origin}${privateSite}/media`, { method: "POST", headers: auth, body });
  };
  const response = await upload();
  expect(response.status).toBe(201);
  const media = uploadedMediaSchema.parse(await response.json());
  expect(media).toMatchObject({ kind: "cover", content_type: "image/webp", width: 1600, height: 900 });
  const image = await fetch(`${origin}${media.url}`);
  expect(image.status).toBe(200);
  expect(image.headers.get("x-content-type-options")).toBe("nosniff");
  expect(Buffer.from(await image.arrayBuffer())).toEqual(bytes);
  const initial = await readDraft();
  const hero = initial.draft.blocks.find(block => block.type === "hero")!;
  if (hero.type !== "hero") throw new Error("Missing hero");
  hero.content.cover = { media_id: media.id };
  const saved = await siteRequest("/draft", "PUT", initial.draft, '"1"');
  expect(siteStateSchema.parse(await saved.json()).media).toContainEqual(expect.objectContaining({ id: media.id }));
  expect((await siteRequest("/publish", "POST", undefined, '"2"')).status).toBe(200);
  const publicSnapshot = publicSiteSchema.parse(await json("/v2/company-sites/nexo-labs"));
  expect(publicSnapshot.media).toContainEqual(expect.objectContaining({ id: media.id }));
  const badFields = await upload(true);
  expect(badFields.status).toBe(400);
  expect(decodeFailure(400, await badFields.json())).toEqual({ kind: "error", code: "invalid_request" });
  const badImage = await upload(false, "image/webp", Buffer.from("not an image"));
  expect(badImage.status).toBe(415);
  expect(decodeFailure(415, await badImage.json())).toEqual({ kind: "error", code: "unsupported_media_type" });
  const tooBig = await upload(false, "image/webp", Buffer.alloc(5 * 1024 * 1024 + 1));
  expect(tooBig.status).toBe(413);
  expect(decodeFailure(413, await tooBig.json())).toEqual({ kind: "error", code: "payload_too_large" });
  const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1sAAAAASUVORK5CYII=", "base64");
  const tooSmall = await upload(false, "image/png", tinyPng);
  expect(tooSmall.status).toBe(422);
  expect(decodeFailure(422, await tooSmall.json())).toEqual({ kind: "error", code: "image_too_small" });
  const missingFile = new FormData();
  missingFile.set("kind", "cover");
  expect((await fetch(`${origin}${privateSite}/media`, { method: "POST", headers: auth, body: missingFile })).status).toBe(400);
  const sniffed = await upload(false, "text/plain");
  expect(sniffed.status).toBe(201);
  expect(uploadedMediaSchema.parse(await sniffed.json()).content_type).toBe("image/webp");
  await json("/__reset");
  expect((await fetch(`${origin}${media.url}`)).status).toBe(404);
});

test("public careers snapshot decodes, is publishable, and old slugs resolve to the current slug", async () => {
  await json("/__reset");
  const response = await fetch(`${origin}/v2/company-sites/nexo-labs`);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("public, max-age=60");
  const body = await response.json();
  const parsed = publicSiteSchema.parse(body);
  expect(Object.keys(body).sort()).toEqual(["company", "media", "published_at", "site", "slug"]);
  expect(body.site).not.toHaveProperty("slug");
  expect(Object.keys(body.company).sort()).toEqual(["id", "name", "logo_url", "description", "website", "linkedin_url", "instagram_url", "facebook_url", "twitter_url", "location"].sort());
  expect(parsed.company.id).toBe(nexo);
  expect(parsed.company.name).toBe("Nexo Labs");
  expect(new Set(parsed.site.blocks.map(block => block.type)).size).toBe(13);
  expect(parsed.site.blocks.every(block => !block.hidden)).toBe(true);
  expect(new Set(parsed.site.blocks.map(block => block.variant)).size).toBeGreaterThan(1);
  expect(publishIssues(siteDraftSchema.parse({ ...parsed.site, slug: parsed.slug }), parsed.company)).toEqual([]);
  const story = parsed.site.blocks.find(block => block.type === "story")!;
  expect(story.type === "story" && story.content.body?.schema_version).toBe(1);
  expect(await json("/v2/company-sites/nexo-equipo")).toEqual(body);
  const missing = await fetch(`${origin}/v2/company-sites/desconocida`);
  expect(missing.status).toBe(404);
  expect(missing.headers.get("cache-control")).toBe("no-store");
  expect(await missing.json()).toEqual({ error: expect.any(String), code: "site_not_found" });
});

test("site controls change branding and only company jobs; reset restores defaults", async () => {
  await json("/__reset");
  const defaultSite = await json("/v2/company-sites/nexo-labs");
  await json("/__site?brand=green&font=editorial&jobs=empty");
  const green = publicSiteSchema.parse(await json("/v2/company-sites/nexo-labs"));
  expect(green.site.theme).toEqual({ brand_color: "#15803D", accent_color: null, background_color: null, font_pair: "editorial" });
  expect(publicJobsListSchema.parse(await json(`/v2/jobs?company_id=${nexo}`)).items).toEqual([]);
  expect(publicJobsListSchema.parse(await json("/v2/jobs")).items).toHaveLength(2);
  await json("/__site?brand=orange&font=modern&jobs=default");
  expect(publicSiteSchema.parse(await json("/v2/company-sites/nexo-labs")).site.theme).toEqual({ brand_color: "#EA580C", accent_color: null, background_color: null, font_pair: "modern" });
  expect((await fetch(`${origin}/__site?brand=green&font=unknown&jobs=empty`)).status).toBe(400);
  expect(publicSiteSchema.parse(await json("/v2/company-sites/nexo-labs")).site.theme).toEqual({ brand_color: "#EA580C", accent_color: null, background_color: null, font_pair: "modern" });
  expect(publicJobsListSchema.parse(await json(`/v2/jobs?company_id=${nexo}`)).items).toHaveLength(2);
  await json("/__reset");
  expect(await json("/v2/company-sites/nexo-labs")).toEqual(defaultSite);
  expect(publicJobsListSchema.parse(await json(`/v2/jobs?company_id=${nexo}`)).items).toHaveLength(2);
});

test("site media are real immutable images, every reference resolves, and unknown ids are private 404s", async () => {
  await json("/__reset");
  const site = publicSiteSchema.parse(await json("/v2/company-sites/nexo-labs"));
  expect(new Set(site.media.map(media => media.kind))).toEqual(new Set(["cover", "gallery", "portrait", "story"]));
  const refs = [...JSON.stringify(site.site).matchAll(/"media_id":"([^"]+)"/g)].map(match => match[1]);
  expect(refs.every(id => site.media.some(media => media.id === id))).toBe(true);
  for (const media of site.media) {
    expect(media.url).toBe(`/v2/company-sites/media/${media.id}`);
    const response = await fetch(`${origin}${media.url}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 4).toString()).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString()).toBe("WEBP");
    expect(bytes.length).toBeGreaterThan(100);
  }
  for (const id of ["bad-id", main]) {
    const response = await fetch(`${origin}/v2/company-sites/media/${id}`);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
});

test("company filter isolates seven published jobs, composes filters and pagination, and validates UUIDs", async () => {
  await json("/__reset");
  const first = publicJobsListSchema.parse(await json(`/v2/jobs?company_id=${nexo}`));
  expect(first.items).toHaveLength(2);
  expect(first.next_cursor).not.toBeNull();
  const last = publicJobsListSchema.parse(await json(`/v2/jobs?company_id=${nexo}&${new URLSearchParams({ cursor: first.next_cursor! })}`));
  expect(last.next_cursor).toBeNull();
  const all = [...first.items, ...last.items];
  expect(new Set(all.map(item => item.id)).size).toBe(7);
  expect(all.every(item => item.company.id === nexo)).toBe(true);
  expect(new Set(all.map(item => item.work_mode))).toEqual(new Set(["remote", "hybrid", "onsite"]));
  expect(new Set(all.map(item => item.location?.state?.id))).toEqual(new Set(["19", "14"]));
  for (const item of all) expect(publicJobDetailSchema.parse(await json(`/v2/jobs/${item.id}`)).company.id).toBe(nexo);
  const filtered = publicJobsListSchema.parse(await json(`/v2/jobs?company_id=${nexo}&work_mode=hybrid&state=14`));
  expect(filtered.items.length).toBeGreaterThan(0);
  expect(filtered.items.every(item => item.work_mode === "hybrid" && item.location?.state?.id === "14")).toBe(true);
  const foreign = publicJobsListSchema.parse(await json(`/v2/jobs?company_id=0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f`));
  expect(foreign.items.every(item => item.company.id !== nexo)).toBe(true);
  expect(foreign.items.length).toBeGreaterThan(0);
  expect(publicJobsListSchema.parse(await json(`/v2/jobs?company_id=${nexo.toUpperCase()}`))).toEqual(first);
  expect(publicJobsListSchema.parse(await json(`/v2/jobs?company_id=${main}`)).items).toEqual([]);
  expect(publicJobsListSchema.parse(await json(`/v2/jobs?company_id=${nexo}&q=long-content`)).items).toEqual([]);
  for (const value of ["bad", ""]) {
    const response = await fetch(`${origin}/v2/jobs?company_id=${value}`);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.any(String), code: "invalid_filter" });
  }
  await json(`/__visibility?id=${first.items[0].id}&visible=false`);
  expect((await fetch(`${origin}/v2/jobs/${first.items[0].id}`)).status).toBe(404);
  expect(publicJobsListSchema.parse(await json(`/v2/jobs?company_id=${nexo}`)).items.some(item => item.id === first.items[0].id)).toBe(false);
  await json("/__failure?kind=5xx");
  expect((await fetch(`${origin}/v2/jobs?company_id=${nexo}`)).status).toBe(500);
  expect((await fetch(`${origin}/v2/company-sites/nexo-labs`)).status).toBe(200);
  await json("/__recover");
  expect(publicJobsListSchema.safeParse(await json(`/v2/jobs?company_id=${nexo}`)).success).toBe(true);
});

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

test("employer membership follows the draft role control and the auth/gate rules", async () => {
  const membership = async (headers: Record<string, string> = auth) => fetch(`${origin}/me/company`, { headers });
  const me = await fetch(`${origin}/v2/me`, { headers: auth });
  expect(me.status).toBe(200);
  // Same shape the product's server-only identity decoder accepts (strict).
  const identity = await me.json();
  expect(Object.keys(identity).sort()).toEqual(["role", "user"]);
  expect(identity.role).toBe("recruiter");
  expect(Object.keys(identity.user).sort()).toEqual(["email", "full_name", "id"]);
  expect(identity.user.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(identity.user.full_name).toBe("Mariana Cruz");
  expect((await fetch(`${origin}/v2/me`)).status).toBe(401);
  expect((await membership({})).status).toBe(401);
  const owner = await membership();
  expect(owner.status).toBe(200);
  expect(owner.headers.get("cache-control")).toBe("no-store");
  const body = await owner.json();
  expect(body).toMatchObject({ company_id: nexo, role: "owner", company: { id: nexo, name: "Nexo Labs", status: "active" } });
  for (const key of ["rfc", "industry_id", "updated_at"]) expect(typeof body.company[key]).toBe("string");
  expect(locationReadSchema.parse(body.company.location)).not.toBeNull();
  await json("/__site-draft?role=recruiter");
  expect(await (await membership()).json()).toMatchObject({ role: "recruiter" });
  await json("/__reset");
  expect(await (await membership()).json()).toMatchObject({ role: "owner" });
});

test("public company profile serves Nexo's identity in the backend companyPublicResponse shape", async () => {
  const missing = await fetch(`${origin}/companies/00000000-0000-4000-8000-000000000000`);
  expect(missing.status).toBe(404);
  const response = await fetch(`${origin}/companies/${nexo}`);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ id: nexo, name: "Nexo Labs", industry_id: "tecnologia" });
  for (const key of ["logo_url", "website", "linkedin_url", "instagram_url", "facebook_url", "twitter_url"]) expect(body[key]).toMatch(/^https?:\/\//);
  expect(typeof body.description).toBe("string");
  expect(locationReadSchema.parse(body.location)).not.toBeNull();
  expect(Object.keys(body)).not.toContain("rfc");
});
