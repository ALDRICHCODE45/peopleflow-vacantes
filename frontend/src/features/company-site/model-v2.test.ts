import { describe, expect, it } from "vitest";

import { PROFESSIONAL_AREAS } from "../jobs/drafts/scalars";
import { siteStateSchema } from "./api/model";
import { draftFieldErrors } from "./api/validation";
import { defaultBlock, defaultBlockV2, defaultSiteDraft } from "./defaults";
import {
  blockSchema, blockSchemaV2, createSiteDraftPayloadSchema, DEFAULT_SECTION_STYLE, HERO_BUTTON_DEFAULTS,
  publishIssuesV2, siteDraftPayloadSchema, siteDraftReadSchema, siteDraftReadSchemaV2, siteDraftSchema, siteDraftSchemaV2,
  type BlockTypeV2,
} from "./model";
import { SECTIONS_V2_ENABLED } from "./sections-v2";

type RecordValue = Record<string, unknown>;
type Candidate = RecordValue & { id: string; hidden: boolean; variant: string; content: RecordValue; style?: RecordValue };
const media = { media_id: "c166f6ce-e0e9-4e20-916a-90828ef36273" };
const company = { name: "Nexo", logo_url: "/logo.png" };
const rich = (text: string) => ({ schema_version: 1, document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] } });
const emoji = (count: number) => "😀".repeat(count);

function v2(type: BlockTypeV2): Candidate { return structuredClone(defaultBlockV2(type)) as unknown as Candidate; }
function heroV2(patch: RecordValue = {}): Candidate {
  const hero = v2("hero");
  hero.content = { ...hero.content, title: "Trabaja en Nexo", ...patch };
  return hero;
}
function draftV2(...extra: unknown[]) {
  return { slug: "nexo-labs", theme: { brand_color: "#7835DB", accent_color: null, background_color: null, font_pair: "classic" }, seo: { title: null, description: null }, blocks: [heroV2(), v2("jobs"), ...extra] };
}
function accepts(candidate: unknown) { return blockSchemaV2.safeParse(candidate).success; }
function errorsOf(draft: unknown) {
  const parsed = siteDraftSchemaV2.safeParse(draft);
  return parsed.success ? [] : draftFieldErrors(parsed.error.issues);
}
function issues(...extra: unknown[]) { return publishIssuesV2(siteDraftSchemaV2.parse(draftV2(...extra)), company); }
function issuesOf(draft: unknown) { return publishIssuesV2(siteDraftSchemaV2.parse(draft), company); }

describe("sections v2 flag", () => {
  it("is off until backend slice A is in main", () => {
    expect(SECTIONS_V2_ENABLED).toBe(false);
  });
});

describe("new variants on existing types", () => {
  const added = {
    hero: ["background_loop", "photo_jobs", "collage"], benefits: ["bento", "big_icons"], values: ["bento", "big_icons"],
    stats: ["brand_band"], testimonials: ["carousel"], gallery: ["photo_strip"],
  } as const;
  for (const [type, variants] of Object.entries(added) as [keyof typeof added, readonly string[]][]) {
    it.each(variants)(`${type} accepts %s in v2 and the legacy write schema keeps rejecting it`, variant => {
      const candidate = { ...v2(type), variant };
      expect(accepts(candidate)).toBe(true);
      const { style: _style, ...legacy } = candidate;
      void _style;
      expect(blockSchema.safeParse({ ...legacy, content: structuredClone(defaultBlock(type).content) }).success).toBe(false);
    });
  }
  it("hero collage holds at most three non-null images", () => {
    const hero = heroV2();
    for (const [images, ok] of [[[], true], [[media], true], [[media, media, media], true], [[media, media, media, media], false], [[null], false], [[{ media_id: "bad" }], false]] as const) {
      hero.content.images = images;
      expect(accepts({ ...hero, variant: "collage" })).toBe(ok);
    }
  });
  it("testimonial items accept an optional YouTube/Vimeo video_url through the existing video URL parser", () => {
    const candidate = v2("testimonials");
    const item = { quote: "Excelente", name: "Ana", role: null, photo: null, consent: true };
    for (const [video_url, ok] of [
      [null, true], ["https://youtu.be/dQw4w9WgXcQ", true], ["https://vimeo.com/123456", true], ["  ", true],
      ["https://example.com/video", false], ["javascript:alert(1)", false], ["https://youtu.be/short", false],
    ] as const) {
      candidate.content.items = [{ ...item, video_url }];
      expect(accepts({ ...candidate, variant: "carousel" })).toBe(ok);
    }
    candidate.content.items = [item];
    const parsed = blockSchemaV2.parse(candidate);
    expect(parsed.type === "testimonials" && parsed.content.items[0].video_url).toBeNull();
  });
});

describe("new section types", () => {
  const teamItem = { name: "Ana López", role: "Directora", photo: media, consent: true };
  const logoItem = { name: "Great Place to Work", image: media, caption: null };
  it.each([
    ["team", "title", 80], ["team", "intro", 200], ["logos", "title", 80], ["areas", "title", 80], ["areas", "intro", 200],
    ["talent_cta", "title", 80], ["talent_cta", "text", 240], ["talent_cta", "button_label", 24],
  ] as const)("%s.%s: %d code points inclusive", (type, field, max) => {
    const candidate = v2(type);
    candidate.content[field] = ` ${emoji(max)} `;
    expect(accepts(candidate)).toBe(true);
    candidate.content[field] = emoji(max + 1);
    expect(accepts(candidate)).toBe(false);
  });
  it.each([
    ["team", "name", 80, teamItem], ["team", "role", 80, teamItem],
    ["logos", "name", 80, logoItem], ["logos", "caption", 80, logoItem],
  ] as const)("%s item %s: %d code points inclusive", (type, field, max, item) => {
    const candidate = v2(type);
    candidate.content.items = [{ ...item, [field]: emoji(max) }];
    expect(accepts(candidate)).toBe(true);
    candidate.content.items = [{ ...item, [field]: emoji(max + 1) }];
    expect(accepts(candidate)).toBe(false);
  });
  it.each([["team", teamItem], ["logos", logoItem]] as const)("%s holds 0–12 items with strict keys", (type, item) => {
    const candidate = v2(type);
    candidate.content.items = [];
    expect(accepts(candidate)).toBe(true);
    candidate.content.items = Array.from({ length: 12 }, () => ({ ...item }));
    expect(accepts(candidate)).toBe(true);
    candidate.content.items = Array.from({ length: 13 }, () => ({ ...item }));
    expect(accepts(candidate)).toBe(false);
    candidate.content.items = [{ ...item, extra: true }];
    expect(accepts(candidate)).toBe(false);
  });
  it.each([
    ["team", ["grid", "portraits"]], ["logos", ["strip", "grid"]], ["areas", ["icon_cards", "photo_cards"]], ["talent_cta", ["banner", "split"]],
  ] as const)("%s accepts exactly its variants, defaults to the first and rejects unknown content keys", (type, variants) => {
    const candidate = v2(type);
    expect(candidate.variant).toBe(variants[0]);
    for (const variant of variants) expect(accepts({ ...candidate, variant })).toBe(true);
    expect(accepts({ ...candidate, variant: "other" })).toBe(false);
    expect(accepts({ ...candidate, content: { ...candidate.content, extra: true } })).toBe(false);
  });
  it("team consent is a boolean saved unchecked and required to publish, exactly like testimonials", () => {
    const team = v2("team");
    for (const consent of [false, true, null, undefined, "yes"]) {
      team.content.items = [{ ...teamItem, consent }];
      expect(accepts(team)).toBe(typeof consent === "boolean");
    }
    team.content.items = [{ ...teamItem, consent: false }];
    expect(issues(team)).toEqual([{ code: "block_incomplete", field: "blocks[2]" }]);
    team.content.items = [];
    expect(issues(team)).toEqual([{ code: "block_incomplete", field: "blocks[2]" }]);
    team.content.items = [{ ...teamItem, name: null }];
    expect(issues(team)).toEqual([{ code: "block_incomplete", field: "blocks[2]" }]);
    team.content.items = [{ ...teamItem, photo: null }];
    expect(issues(team)).toEqual([]);
  });
  it("logos publish with at least one named logo with an image", () => {
    const logos = v2("logos");
    expect(issues(logos)).toEqual([{ code: "block_incomplete", field: "blocks[2]" }]);
    logos.content.items = [{ ...logoItem, image: null }];
    expect(issues(logos)).toEqual([{ code: "block_incomplete", field: "blocks[2]" }]);
    logos.content.items = [logoItem];
    expect(issues(logos)).toEqual([]);
  });
  it("areas overrides use catalog keys, unique, with exactly one of icon / photo", () => {
    const areas = v2("areas");
    const override = (key: string, icon: string | null, photo: typeof media | null) => ({ key, icon, photo });
    areas.content.overrides = PROFESSIONAL_AREAS.map((key, index) => override(key, index % 2 ? "rocket" : null, index % 2 ? null : media));
    expect(accepts(areas)).toBe(true);
    for (const overrides of [
      [override("astrology", "rocket", null)],
      [override("engineering", "rocket", null), override("engineering", null, media)],
      [override("engineering", "rocket", media)],
      [override("engineering", null, null)],
      [override("engineering", "not-an-icon", null)],
      [{ ...override("engineering", "rocket", null), extra: true }],
    ]) expect(accepts({ ...areas, content: { ...areas.content, overrides } })).toBe(false);
    const both = errorsOf(draftV2({ ...areas, content: { ...areas.content, overrides: [override("engineering", "rocket", media)] } }));
    expect(both).toContainEqual({ field: "blocks[2].content.overrides[0].photo", code: "not_allowed" });
  });
  it("areas and talent_cta publish needs only the title", () => {
    for (const type of ["areas", "talent_cta"] as const) {
      const candidate = v2(type);
      candidate.content.title = null;
      expect(issues(candidate)).toEqual([{ code: "block_incomplete", field: "blocks[2]" }]);
      candidate.content.title = "Encuentra tu lugar";
      expect(issues(candidate)).toEqual([]);
    }
  });
});

describe("per-block style", () => {
  it("defaults when missing and normalizes partial style objects", () => {
    const story = v2("story");
    delete story.style;
    expect(blockSchemaV2.parse(story).style).toEqual({ background: "default", spacing: "airy", align: "start", overlay: null, image: null });
    expect(blockSchemaV2.parse({ ...story, style: { spacing: "compact" } }).style).toEqual({ ...DEFAULT_SECTION_STYLE, spacing: "compact" });
  });
  it("defaults are independent objects", () => {
    const first = blockSchemaV2.parse({ ...v2("story"), style: undefined });
    const second = blockSchemaV2.parse({ ...v2("story"), style: undefined });
    expect(first.style).not.toBe(second.style);
  });
  it.each([
    [{ background: "tint", spacing: "compact", align: "center", overlay: null, image: null }, []],
    [{ background: "brand", spacing: "airy", align: "start", overlay: null, image: null }, []],
    [{ background: "image", spacing: "airy", align: "start", overlay: "strong", image: media }, []],
    [{ background: "image", spacing: "airy", align: "start", overlay: null, image: media }, []],
    // Saving "Imagen" before uploading it is allowed; publication asks for the image.
    [{ background: "image", spacing: "airy", align: "start", overlay: "soft", image: null }, []],
    [{ background: "default", spacing: "airy", align: "start", overlay: null, image: media }, [{ field: "blocks[2].style.image", code: "not_allowed" }]],
    [{ background: "tint", spacing: "airy", align: "start", overlay: "medium", image: null }, [{ field: "blocks[2].style.overlay", code: "not_allowed" }]],
    [{ background: "video", spacing: "airy", align: "start", overlay: null, image: null }, [{ field: "blocks[2].style.background", code: "invalid" }]],
    [{ background: "default", spacing: "loose", align: "start", overlay: null, image: null }, [{ field: "blocks[2].style.spacing", code: "invalid" }]],
    [{ background: "default", spacing: "airy", align: "right", overlay: null, image: null }, [{ field: "blocks[2].style.align", code: "invalid" }]],
    [{ background: "default", spacing: "airy", align: "start", overlay: null, image: null, color: "#000000" }, [{ field: "blocks[2].style.color", code: "unknown_key" }]],
  ])("style %o → %o", (style, expected) => {
    expect(errorsOf(draftV2({ ...v2("story"), style }))).toEqual(expected);
  });
  it("cross-field issues point at the offending style key", () => {
    const parsed = blockSchemaV2.safeParse({ ...v2("story"), style: { ...DEFAULT_SECTION_STYLE, overlay: "soft" } });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0].path).toEqual(["style", "overlay"]);
  });
  it("a visible section with background Imagen and no image blocks publication with style_image_missing", () => {
    const story = v2("story");
    story.content.body = rich("Historia");
    const draft = draftV2({ ...story, style: { ...DEFAULT_SECTION_STYLE, background: "image" } });
    expect(siteDraftSchemaV2.safeParse(draft).success).toBe(true);
    expect(issuesOf(draft)).toEqual([{ code: "style_image_missing", field: "blocks[2].style.image" }]);
    draft.blocks[2] = { ...(draft.blocks[2] as Candidate), hidden: true };
    expect(issuesOf(draft).map(issue => issue.code)).not.toContain("style_image_missing");
  });
});

describe("hero buttons", () => {
  it("default when missing", () => {
    const hero = heroV2();
    const content = { title: "Trabaja en Nexo", subtitle: null, cover: null };
    const parsed = blockSchemaV2.parse({ ...hero, content });
    expect(parsed.type === "hero" && parsed.content).toEqual({ ...content, images: [], primary_label: "Ver vacantes", secondary_visible: true, secondary_label: "Conoce la empresa", secondary_target: null });
    expect(HERO_BUTTON_DEFAULTS).toEqual({ primary_label: "Ver vacantes", secondary_visible: true, secondary_label: "Conoce la empresa", secondary_target: null });
  });
  it.each(["primary_label", "secondary_label"])("%s: 24 code points inclusive, blank → null", field => {
    expect(accepts(heroV2({ [field]: emoji(24) }))).toBe(true);
    expect(accepts(heroV2({ [field]: emoji(25) }))).toBe(false);
    const parsed = blockSchemaV2.parse(heroV2({ [field]: "  " }));
    expect(parsed.content).toHaveProperty(field, null);
  });
  it("secondary_visible is a boolean", () => {
    for (const value of [true, false, "true", null]) expect(accepts(heroV2({ secondary_visible: value }))).toBe(typeof value === "boolean");
  });
  it("secondary_target must be an existing block id", () => {
    const story = v2("story");
    story.content.body = rich("Historia");
    const draft = draftV2(story);
    draft.blocks[0] = heroV2({ secondary_target: story.id });
    expect(siteDraftSchemaV2.safeParse(draft).success).toBe(true);
    draft.blocks[0] = heroV2({ secondary_target: crypto.randomUUID() });
    expect(errorsOf(draft)).toEqual([{ field: "blocks[0].content.secondary_target", code: "invalid" }]);
    const hero = heroV2();
    draft.blocks[0] = { ...hero, content: { ...hero.content, secondary_target: hero.id } };
    expect(errorsOf(draft)).toEqual([{ field: "blocks[0].content.secondary_target", code: "invalid" }]);
    draft.blocks[0] = heroV2({ secondary_target: "not-a-uuid" });
    expect(siteDraftSchemaV2.safeParse(draft).success).toBe(false);
  });
  it("a hidden secondary_target blocks publication; a hidden secondary button does not need a visible target", () => {
    const story = v2("story");
    story.content.body = rich("Historia");
    const hiddenStory = { ...v2("story"), hidden: true, content: { title: null, body: rich("Oculta"), image: null } };
    const draft = draftV2(story, hiddenStory);
    draft.blocks[0] = heroV2({ secondary_target: hiddenStory.id });
    expect(issuesOf(draft)).toEqual([{ code: "secondary_target_hidden", field: "blocks[0].content.secondary_target" }]);
    draft.blocks[0] = heroV2({ secondary_target: hiddenStory.id, secondary_visible: false });
    expect(issuesOf(draft)).toEqual([]);
    draft.blocks[0] = heroV2({ secondary_target: story.id });
    expect(issuesOf(draft)).toEqual([]);
  });
});

describe("v2 publication rules", () => {
  const story = () => ({ ...v2("story"), content: { title: null, body: rich("Historia"), image: null } });
  it("background_loop is publish-blocked until hero video upload (slice B) exists", () => {
    const draft = draftV2(story());
    draft.blocks[0] = { ...heroV2(), variant: "background_loop" };
    expect(issuesOf(draft)).toEqual([{ code: "hero_video_missing", field: "blocks[0]" }]);
  });
  it("collage needs at least two images to publish", () => {
    const draft = draftV2(story());
    for (const [images, expected] of [[[], 1], [[media], 1], [[media, media], 0], [[media, media, media], 0]] as const) {
      draft.blocks[0] = { ...heroV2({ images }), variant: "collage" };
      expect(issuesOf(draft)).toHaveLength(expected);
      if (expected) expect(issuesOf(draft)).toEqual([{ code: "hero_collage_images_missing", field: "blocks[0]" }]);
    }
  });
  it("legacy publication rules still apply through publishIssuesV2", () => {
    const draft = draftV2();
    draft.slug = null as never;
    draft.blocks[0] = { ...heroV2({ title: null }) };
    expect(publishIssuesV2(siteDraftSchemaV2.parse(draft), { name: null, logo_url: null })).toEqual([
      { code: "slug_missing", field: "slug" }, { code: "hero_title_missing", field: "blocks[0]" },
      { code: "no_content_block", field: null }, { code: "company_logo_missing", field: null }, { code: "company_name_missing", field: null },
    ]);
  });
  it("new section types count as content blocks and hidden ones are skipped", () => {
    const areas = { ...v2("areas"), content: { title: "Áreas", intro: null, overrides: [] } };
    expect(issues(areas)).toEqual([]);
    expect(issues({ ...areas, hidden: true })).toEqual([{ code: "no_content_block", field: null }]);
  });
});

describe("legacy documents read through the v2 schemas", () => {
  function legacyDraft() {
    const draft = defaultSiteDraft();
    const hero = draft.blocks[0];
    if (hero.type === "hero") hero.content.title = "Trabaja en Nexo";
    const benefits = defaultBlock("benefits");
    // Read tolerates undecorated legacy items, like siteDraftReadSchema.
    (benefits.content as { items: unknown[] }).items = [{ icon: null, emoji: null, title: "Bono", description: null }];
    const testimonials = defaultBlock("testimonials");
    (testimonials.content as { items: unknown[] }).items = [{ quote: "Gran lugar", name: "Ana", role: null, photo: null, consent: true }];
    draft.slug = "nexo-labs";
    draft.blocks.push(benefits, testimonials);
    return draft;
  }
  it("parse and normalize every new key to the contract defaults", () => {
    const parsed = siteDraftReadSchemaV2.parse(legacyDraft());
    for (const block of parsed.blocks) expect(block.style).toEqual(DEFAULT_SECTION_STYLE);
    const hero = parsed.blocks[0];
    expect(hero.type === "hero" && hero.content).toMatchObject({ images: [], ...HERO_BUTTON_DEFAULTS });
    const testimonials = parsed.blocks[3];
    expect(testimonials.type === "testimonials" && testimonials.content.items[0].video_url).toBeNull();
  });
  it("the strict legacy read still rejects new keys while the editor state decodes them through the v2 read", () => {
    const draft = legacyDraft();
    const withStyle = { ...draft, blocks: draft.blocks.map(block => ({ ...block, style: DEFAULT_SECTION_STYLE })) };
    const state = { draft: withStyle, draft_version: 1, published: null, has_unpublished_changes: false, media: [], updated_at: "2026-01-01T00:00:00Z" };
    expect(siteDraftReadSchema.safeParse(withStyle).success).toBe(false);
    const decoded = siteStateSchema.safeParse(state);
    expect(decoded.success).toBe(true);
    if (decoded.success) expect(decoded.data.draft).toEqual(siteDraftReadSchemaV2.parse(withStyle));
    expect(siteDraftReadSchemaV2.safeParse(withStyle).success).toBe(true);
  });
});

describe("flag-off write payload", () => {
  function todayDraft() {
    const draft = defaultSiteDraft();
    const hero = draft.blocks[0];
    if (hero.type === "hero") hero.content = { title: " Trabaja en Nexo ", subtitle: null, cover: media };
    const values = defaultBlock("values");
    (values.content as RecordValue).items = [{ icon: "heart", emoji: null, title: "Valor", description: null }];
    const testimonials = defaultBlock("testimonials");
    (testimonials.content as RecordValue).items = [{ quote: "Excelente", name: "Ana", role: null, photo: null, consent: false }];
    const story = defaultBlock("story");
    (story.content as RecordValue).body = rich("Historia");
    draft.slug = "nexo-labs";
    draft.blocks.splice(1, 0, values, testimonials, story, defaultBlock("gallery"), defaultBlock("closing"));
    return draft;
  }
  const legacyBody = (draft: unknown) => JSON.stringify(siteDraftSchema.parse(draft));
  it("a draft built today produces the same PUT body", () => {
    for (const draft of [defaultSiteDraft(), todayDraft()]) {
      expect(JSON.stringify(siteDraftPayloadSchema.parse(draft))).toBe(legacyBody(draft));
    }
  });
  it("a v2-normalized draft (read defaults) writes back today's exact body", () => {
    const draft = todayDraft();
    const normalized = siteDraftReadSchemaV2.parse(draft);
    expect(normalized.blocks[0].style).toEqual(DEFAULT_SECTION_STYLE);
    expect(JSON.stringify(siteDraftPayloadSchema.parse(normalized))).toBe(legacyBody(draft));
    expect(JSON.stringify(siteDraftPayloadSchema.parse(siteDraftSchemaV2.parse(draft)))).toBe(legacyBody(draft));
  });
  it("rejects anything slice A would add instead of dropping it", () => {
    const off = createSiteDraftPayloadSchema(false);
    const base = siteDraftSchemaV2.parse(todayDraft());
    const cases: [unknown, string][] = [
      [{ ...base, blocks: [...base.blocks, v2("team")] }, `blocks[${base.blocks.length}]`],
      [{ ...base, blocks: base.blocks.map((b, i) => i === 1 ? { ...b, variant: "bento" } : b) }, "blocks[1]"],
      [{ ...base, blocks: base.blocks.map((b, i) => i === 1 ? { ...b, style: { ...DEFAULT_SECTION_STYLE, spacing: "compact" } } : b) }, "blocks[1].style"],
      [{ ...base, blocks: base.blocks.map((b, i) => i === 0 ? { ...b, content: { ...b.content, primary_label: "Únete" } } : b) }, "blocks[0].content.primary_label"],
      [{ ...base, blocks: base.blocks.map((b, i) => i === 0 ? { ...b, content: { ...b.content, images: [media] } } : b) }, "blocks[0].content.images"],
      [{ ...base, blocks: base.blocks.map((b, i) => i === 2 ? { ...b, content: { items: [{ quote: "Hola", name: "Ana", role: null, photo: null, consent: true, video_url: "https://youtu.be/dQw4w9WgXcQ" }] } } : b) }, "blocks[2].content.items[0].video_url"],
    ];
    for (const [draft, field] of cases) {
      const parsed = off.safeParse(draft);
      expect(parsed.success).toBe(false);
      if (!parsed.success) expect(draftFieldErrors(parsed.error.issues)).toContainEqual({ field, code: "not_allowed" });
    }
  });
  it("still validates like the legacy write schema", () => {
    const draft = todayDraft();
    draft.blocks[1].id = draft.blocks[0].id;
    expect(siteDraftPayloadSchema.safeParse(draft).success).toBe(false);
  });
  it("emits the full v2 document only when the flag is on", () => {
    const on = createSiteDraftPayloadSchema(true);
    const team = v2("team");
    const parsed = on.parse(draftV2(team)) as ReturnType<typeof siteDraftSchemaV2.parse>;
    expect(parsed.blocks.map(block => block.type)).toEqual(["hero", "jobs", "team"]);
    expect(parsed.blocks.every(block => "style" in block)).toBe(true);
    expect(parsed.blocks[0].content).toHaveProperty("primary_label", "Ver vacantes");
  });
});

describe("backend §2.3 normalization rules", () => {
  const readBlocks = (...extra: unknown[]) => siteDraftReadSchemaV2.parse(draftV2(...extra)).blocks;
  it("style: null is dropped like an absent style (defaults) on write and read", () => {
    const story = { ...v2("story"), style: null };
    expect(blockSchemaV2.parse(story).style).toEqual(DEFAULT_SECTION_STYLE);
    expect(readBlocks(story)[2].style).toEqual(DEFAULT_SECTION_STYLE);
    expect(errorsOf(draftV2(story))).toEqual([]);
  });
  it("a present style is filled to all five keys on read", () => {
    expect(readBlocks({ ...v2("story"), style: { background: "tint" } })[2].style).toEqual({ ...DEFAULT_SECTION_STYLE, background: "tint" });
    expect(readBlocks({ ...v2("story"), style: {} })[2].style).toEqual(DEFAULT_SECTION_STYLE);
  });
  it("style that is not an object is still invalid", () => {
    expect(errorsOf(draftV2({ ...v2("story"), style: "brand" }))).toEqual([{ field: "blocks[2].style", code: "invalid" }]);
  });
  it("hero images: null reads and writes as []", () => {
    const hero = heroV2({ images: null });
    const parsed = blockSchemaV2.parse(hero);
    expect(parsed.type === "hero" && parsed.content.images).toEqual([]);
    const draft = draftV2();
    draft.blocks[0] = hero;
    const read = siteDraftReadSchemaV2.parse(draft).blocks[0];
    expect(read.type === "hero" && read.content.images).toEqual([]);
  });
  it.each([
    ["team", { variant: "grid", content: {} }, { title: null, intro: null, items: [] }],
    ["logos", { variant: "strip", content: {} }, { title: null, items: [] }],
    ["areas", { variant: "icon_cards", content: {} }, { title: null, intro: null, overrides: [] }],
    ["talent_cta", { variant: "banner", content: {} }, { title: null, text: null, button_label: null }],
  ] as const)("%s: absent strings read as null and absent lists as []", (type, patch, expected) => {
    const block = { id: crypto.randomUUID(), type, hidden: false, ...patch };
    const read = readBlocks(block)[2];
    expect(read.content).toEqual(expected);
  });
  it("team and logos items: absent strings and media refs read as null", () => {
    const team = { ...v2("team"), content: { items: [{ name: "Ana", consent: true }] } };
    const logos = { ...v2("logos"), content: { items: [{ name: "GPTW" }] } };
    const [, , readTeam, readLogos] = readBlocks(team, logos);
    expect(readTeam.content).toEqual({ title: null, intro: null, items: [{ name: "Ana", role: null, photo: null, consent: true }] });
    expect(readLogos.content).toEqual({ title: null, items: [{ name: "GPTW", image: null, caption: null }] });
  });
  it("team consent stays required (non-boolean is invalid, never defaulted)", () => {
    const team = { ...v2("team"), content: { items: [{ name: "Ana" }] } };
    expect(siteDraftReadSchemaV2.safeParse(draftV2(team)).success).toBe(false);
  });
  it("a stored secondary_target that no longer matches a block reads as null; writes still reject it", () => {
    const story = { ...v2("story"), content: { title: null, body: rich("Historia"), image: null } };
    const draft = draftV2(story);
    draft.blocks[0] = heroV2({ secondary_target: crypto.randomUUID() });
    const hero = siteDraftReadSchemaV2.parse(draft).blocks[0];
    expect(hero.type === "hero" && hero.content.secondary_target).toBeNull();
    expect(errorsOf(draft)).toEqual([{ field: "blocks[0].content.secondary_target", code: "invalid" }]);
    draft.blocks[0] = heroV2({ secondary_target: story.id.toUpperCase() });
    const existing = siteDraftReadSchemaV2.parse(draft).blocks[0];
    expect(existing.type === "hero" && existing.content.secondary_target).toBe(story.id);
  });
  it("a stored secondary_target naming the hero itself reads as null; writes reject it", () => {
    const hero = heroV2();
    const draft = draftV2();
    draft.blocks[0] = { ...hero, content: { ...hero.content, secondary_target: hero.id } };
    const read = siteDraftReadSchemaV2.parse(draft).blocks[0];
    expect(read.type === "hero" && read.content.secondary_target).toBeNull();
    expect(errorsOf(draft)).toEqual([{ field: "blocks[0].content.secondary_target", code: "invalid" }]);
  });
  it("secondary_target is compared and stored lower-case", () => {
    const story = { ...v2("story"), content: { title: null, body: rich("Historia"), image: null } };
    const draft = draftV2(story);
    draft.blocks[0] = heroV2({ secondary_target: story.id.toUpperCase() });
    const parsed = siteDraftSchemaV2.parse(draft).blocks[0];
    expect(parsed.type === "hero" && parsed.content.secondary_target).toBe(story.id);
  });
  it.each([
    "https://youtu.be:443/dQw4w9WgXcQ", "http://youtu.be:80/dQw4w9WgXcQ", "https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ",
    "https://vimeo.com:443/123456", "https://user@youtu.be/dQw4w9WgXcQ",
  ])("testimonial video_url %s is invalid (explicit port or credentials)", video_url => {
    const testimonials = v2("testimonials");
    testimonials.content.items = [{ quote: "Excelente", name: "Ana", role: null, photo: null, consent: true, video_url }];
    expect(errorsOf(draftV2(testimonials))).toEqual([{ field: "blocks[2].content.items[0].video_url", code: "invalid" }]);
    expect(siteDraftReadSchemaV2.safeParse(draftV2(testimonials)).success).toBe(false);
  });
  it("testimonial video_url accepts the host case-insensitively and caps at 500 code points", () => {
    const testimonials = v2("testimonials");
    const item = { quote: "Excelente", name: "Ana", role: null, photo: null, consent: true };
    testimonials.content.items = [{ ...item, video_url: "https://YOUTU.BE/dQw4w9WgXcQ" }];
    expect(errorsOf(draftV2(testimonials))).toEqual([]);
    testimonials.content.items = [{ ...item, video_url: `https://youtu.be/dQw4w9WgXcQ?t=${"1".repeat(500)}` }];
    expect(errorsOf(draftV2(testimonials))).toEqual([{ field: "blocks[2].content.items[0].video_url", code: "too_long" }]);
  });
  it("publish issues follow the §2.3 order: per block (hero codes, block_incomplete, style_image_missing), then document-level", () => {
    const team = { ...v2("team"), style: { ...DEFAULT_SECTION_STYLE, background: "image" } };
    const story = { ...v2("story"), content: { title: null, body: rich("Historia"), image: null } };
    const draft = draftV2(team, story);
    draft.blocks[0] = { ...heroV2({ title: null, images: [] }), variant: "collage", style: { ...DEFAULT_SECTION_STYLE, background: "image" } };
    expect(issuesOf(draft)).toEqual([
      { code: "hero_title_missing", field: "blocks[0]" }, { code: "hero_collage_images_missing", field: "blocks[0]" },
      { code: "style_image_missing", field: "blocks[0].style.image" },
      { code: "block_incomplete", field: "blocks[2]" }, { code: "style_image_missing", field: "blocks[2].style.image" },
    ]);
  });
});
