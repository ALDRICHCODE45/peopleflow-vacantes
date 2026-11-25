import { describe, expect, it } from "vitest";

import { DEFAULT_SECTION_STYLE, HERO_BUTTON_DEFAULTS } from "../model";
import { publishedFixture } from "./fixtures.test-support";
import { publicSiteSchema, publicSiteSchemaV2 } from "./schema";

const logoId = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d95";

describe("public site read schema v2", () => {
  it("reads a published legacy document and normalizes the slice A keys", () => {
    const parsed = publicSiteSchemaV2.parse(publishedFixture());
    for (const block of parsed.site.blocks) expect(block.style).toEqual(DEFAULT_SECTION_STYLE);
    const hero = parsed.site.blocks[0];
    expect(hero.type === "hero" && hero.content).toMatchObject({ title: "Trabaja con Nexo", images: [], ...HERO_BUTTON_DEFAULTS });
    expect(parsed).not.toHaveProperty("site.slug");
  });
  it("reads new section types, variants and logo media", () => {
    const fixture = publishedFixture();
    const site = structuredClone(fixture.site) as unknown as { blocks: Record<string, unknown>[] };
    site.blocks.push({ id: crypto.randomUUID(), type: "logos", variant: "strip", hidden: false, content: { title: null, items: [{ name: "ESR", image: { media_id: logoId }, caption: null }] }, style: { ...DEFAULT_SECTION_STYLE, background: "tint" } });
    site.blocks[0] = { ...site.blocks[0], variant: "photo_jobs" };
    const parsed = publicSiteSchemaV2.parse({ ...fixture, site, media: [...fixture.media, { id: logoId, kind: "logo", url: `/v2/company-sites/media/${logoId}`, width: 64, height: 64 }] });
    expect(parsed.site.blocks.map(block => block.type)).toEqual(["hero", "jobs", "logos"]);
    expect(parsed.site.blocks[2].style.background).toBe("tint");
    expect(publicSiteSchema.safeParse({ ...fixture, site }).success).toBe(false);
  });
  it("rejects invalid v2 documents as an invalid published site", () => {
    const fixture = publishedFixture();
    const site = structuredClone(fixture.site) as unknown as { blocks: Record<string, unknown>[] };
    site.blocks[1] = { ...site.blocks[1], style: { ...DEFAULT_SECTION_STYLE, background: "image" } };
    const parsed = publicSiteSchemaV2.safeParse({ ...fixture, site });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.map(issue => issue.path)).toContainEqual(["site"]);
  });
  it("the legacy public schema output is unchanged", () => {
    const parsed = publicSiteSchema.parse(publishedFixture());
    expect(parsed.site.blocks[0]).not.toHaveProperty("style");
    expect(Object.keys(parsed.site.blocks[0].content)).toEqual(["title", "subtitle", "cover"]);
  });
});
