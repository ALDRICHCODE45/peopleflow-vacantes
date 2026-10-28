import { describe, expect, it } from "vitest";
import { draftFieldErrors } from "./api/validation";
import { siteStateSchema } from "./api/model";

import { defaultBlock, defaultSiteDraft, BLOCK_LIBRARY, STANDARD_BENEFITS } from "./defaults";
import { blockSchema, siteDraftSchema, publishIssues, testimonialsBlockSchema, ICONS } from "./model";

type RecordValue = Record<string, unknown>;

it("reads office locations the API returns with null state, municipality and postal code", () => {
  const draft = defaultSiteDraft();
  const offices = defaultBlock("offices");
  (offices.content as { items: RecordValue[] }).items = [{ name: "Oficina Principal", address: null, map_url: null, location: { country: "MX", state: null, municipality: null, postal_code: null } }];
  draft.blocks.splice(1, 0, offices);
  const parsed = siteDraftSchema.safeParse(draft);
  expect(parsed.success).toBe(true);
  const block = parsed.success ? parsed.data.blocks[1] : undefined;
  expect(block?.type === "offices" && block.content.items[0].location).toEqual({ country: "MX" });
  const state = siteStateSchema.safeParse({ draft, draft_version: 89, published: null, has_unpublished_changes: true, media: [], updated_at: "2026-10-27T00:00:00Z" });
  expect(state.success).toBe(true);
});
const rich = (text: string) => ({ schema_version: 1, document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] } });
const media = { media_id: "c166f6ce-e0e9-4e20-916a-90828ef36273" };
const items = {
  values: { icon: "heart", emoji: null, title: "Valor", description: null },
  benefits: { icon: "heart", emoji: null, title: "Beneficio", description: null },
  stats: { value: "10", label: "Personas" },
  process: { title: "Entrevista", description: null, duration: null },
  gallery: { image: media, alt: "Equipo", caption: null },
  testimonials: { quote: "Excelente", name: "Ana", role: null, photo: null, consent: true },
  offices: { name: "Oficina", location: { country: "US" }, address: null, map_url: null },
  faq: { question: "¿Cómo?", answer: "Así" },
};
const limits = [
  ["hero", "title", 80], ["hero", "subtitle", 200], ["story", "title", 80],
  ["values", "mission", 300], ["values", "title", 60], ["values", "description", 240],
  ["benefits", "title", 60], ["benefits", "description", 160], ["stats", "value", 12], ["stats", "label", 60],
  ["process", "title", 60], ["process", "description", 200], ["process", "duration", 30],
  ["gallery", "alt", 160], ["gallery", "caption", 120], ["testimonials", "quote", 400],
  ["testimonials", "name", 80], ["testimonials", "role", 80], ["video", "title", 80], ["video", "description", 200],
  ["offices", "name", 80], ["offices", "address", 200], ["jobs", "title", 80], ["jobs", "intro", 200],
  ["faq", "question", 160], ["faq", "answer", 1000], ["closing", "title", 80], ["closing", "text", 240],
] as const;
const counts = [["values", 1, 8], ["benefits", 1, 24], ["stats", 1, 6], ["process", 2, 8], ["gallery", 2, 12], ["testimonials", 1, 6], ["offices", 1, 20], ["faq", 1, 20]] as const;
function block(type: keyof typeof BLOCK_LIBRARY) { return structuredClone(defaultBlock(type)) as unknown as RecordValue & { content: RecordValue }; }
function siteWith(candidate: unknown) {
  const draft = defaultSiteDraft();
  return { ...draft, slug: "nexo-labs", blocks: [{ ...draft.blocks[0], content: { title: "Nexo", subtitle: null, cover: null } }, draft.blocks[1], candidate] };
}
const company = { name: "Nexo", logo_url: "/logo.png" };
function issues(candidate: unknown) { return publishIssues(siteDraftSchema.parse(siteWith(candidate)), company); }

describe("icon or emoji contract", () => {
  for (const type of ["values", "benefits"] as const) {
    it.each(["😀", "❤️", "👍🏽", "👩‍💻", "👨‍👩‍👧‍👦", "🇲🇽", "🏳️‍🌈", "1️⃣", "♡", "♡‍🔥", "🇲🇽‍🇺🇸", "🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}"])(`${type} accepts one sequence %s`, emoji => {
      const candidate = block(type);
      candidate.content.items = [{ icon: null, emoji, title: null, description: null }];
      expect(blockSchema.safeParse(candidate).success).toBe(true);
    });
    it.each([
      [null, null, "icon", "required"], ["heart", "😀", "emoji", "not_allowed"],
      ["unknown", null, "icon", "invalid"], [null, "ab", "emoji", "invalid"],
      [null, "😀😀", "emoji", "invalid"], [null, "a".repeat(33), "emoji", "too_long"],
      [null, "😀\u0301", "emoji", "invalid"], [null, "🇲", "emoji", "invalid"],
      [null, "😀\u200d", "emoji", "invalid"], [null, " 😀", "emoji", "invalid"],
      [null, "1", "emoji", "invalid"], [null, "", "emoji", "invalid"],
      [null, "👩‍💻\n", "emoji", "invalid"], [null, "👩‍💻\r", "emoji", "invalid"],
    ])(`${type} maps %s / %s to %s %s`, (icon, emoji, field, code) => {
      const candidate = block(type);
      candidate.content.items = [{ icon, emoji, title: null, description: null }];
      const parsed = siteDraftSchema.safeParse(siteWith(candidate));
      expect(parsed.success).toBe(false);
      if (!parsed.success) expect(draftFieldErrors(parsed.error.issues)).toContainEqual({ field: `blocks[2].content.items[0].${field}`, code });
    });
    it(`${type} normalizes legacy read keys without allowing unknown write keys`, () => {
      const candidate = block(type);
      candidate.content.items = [{ icon: "heart", title: null, description: null }];
      const draft = siteWith(candidate);
      // PUT treats a missing nullable decoration as null, like the backend.
      expect(siteDraftSchema.safeParse(draft).success).toBe(true);
      expect(blockSchema.safeParse({ ...candidate, content: { ...candidate.content, extra: true } }).success).toBe(false);
      const state = siteStateSchema.parse({ draft, draft_version: 1, published: null, has_unpublished_changes: false, media: [], updated_at: "2026-01-01T00:00:00Z" });
      const content = state.draft.blocks[2].content as unknown as { items: { emoji: string | null }[] };
      expect(content.items[0].emoji).toBeNull();
    });
  }
});

describe("draft limits", () => {
  for (const [type, field, max] of limits) it(`${type}.${field}: ${max} code points inclusive`, () => {
    const candidate = block(type);
    const isItem = type in items && !(type === "values" && field === "mission");
    const target: RecordValue = isItem ? { ...items[type as keyof typeof items] } : candidate.content;
    if (isItem) candidate.content.items = [target];
    target[field] = ` ${"😀".repeat(max)} `;
    expect(blockSchema.safeParse(candidate).success).toBe(true);
    target[field] = "😀".repeat(max + 1);
    expect(blockSchema.safeParse(candidate).success).toBe(false);
    target[field] = "  ";
    const parsed = blockSchema.parse(candidate);
    const content = parsed.content as RecordValue;
    expect(isItem ? (content.items as RecordValue[])[0][field] : content[field]).toBeNull();
  });
  for (const [type, min, max] of counts) {
    it(`${type}: draft list maximum ${max} and empty accepted`, () => {
      const candidate = block(type);
      candidate.content.items = [];
      expect(blockSchema.safeParse(candidate).success).toBe(true);
      candidate.content.items = Array.from({ length: max }, () => ({ ...items[type] }));
      expect(blockSchema.safeParse(candidate).success).toBe(true);
      candidate.content.items = Array.from({ length: max + 1 }, () => ({ ...items[type] }));
      expect(blockSchema.safeParse(candidate).success).toBe(false);
    });
    it(`${type}: publish list minimum ${min}`, () => {
      const candidate = block(type);
      candidate.content.items = Array.from({ length: min - 1 }, () => ({ ...items[type] }));
      expect(issues(candidate)).toContainEqual({ code: "block_incomplete", field: "blocks[2]" });
      candidate.content.items = Array.from({ length: min }, () => ({ ...items[type] }));
      expect(issues(candidate)).toEqual([]);
    });
  }
  for (const [field, max] of [["title", 60], ["description", 160]] as const) it(`seo.${field} boundary`, () => {
    const draft = defaultSiteDraft();
    draft.seo[field] = "😀".repeat(max);
    expect(siteDraftSchema.safeParse(draft).success).toBe(true);
    draft.seo[field] += "a";
    expect(siteDraftSchema.safeParse(draft).success).toBe(false);
  });
  it("story body uses the canonical envelope and 5,000 plain code points", () => {
    const candidate = block("story");
    candidate.content.body = rich("😀".repeat(5000));
    expect(blockSchema.safeParse(candidate).success).toBe(true);
    candidate.content.body = rich("😀".repeat(5001));
    expect(blockSchema.safeParse(candidate).success).toBe(false);
    candidate.content.body = { type: "doc", content: [] };
    expect(blockSchema.safeParse(candidate).success).toBe(false);
    candidate.content.body = { ...rich("text"), unknown: true };
    expect(blockSchema.safeParse(candidate).success).toBe(false);
  });
  it("rich-text budget rejection remains a Zod failure, not an exception", () => {
    const candidate = block("story");
    candidate.content.body = rich("a".repeat(70000));
    expect(() => blockSchema.safeParse(candidate)).not.toThrow();
    expect(blockSchema.safeParse(candidate).success).toBe(false);
  });
  it("trims normalized video IDs", () => {
    const candidate = block("video");
    candidate.content.video = { provider: "youtube", video_id: " dQw4w9WgXcQ " };
    const parsed = blockSchema.parse(candidate);
    expect(parsed.type === "video" && parsed.content.video?.video_id).toBe("dQw4w9WgXcQ");
  });
  it("office map HTTPS, valid URL and 500-code-point maximum", () => {
    const candidate = block("offices");
    const item = { ...items.offices, map_url: `https://example.com/${"a".repeat(480)}` };
    candidate.content.items = [item];
    expect(item.map_url.length).toBe(500);
    expect(blockSchema.safeParse(candidate).success).toBe(true);
    item.map_url += "a";
    expect(blockSchema.safeParse(candidate).success).toBe(false);
    for (const url of ["http://example.com", "javascript:alert(1)", "https://"]) {
      item.map_url = url;
      expect(blockSchema.safeParse(candidate).success).toBe(false);
    }
  });
});

describe("palette wire contract", () => {
  it("normalizes legacy missing colors to null and writes canonical strict themes", () => {
    const draft = defaultSiteDraft();
    const parsed = siteDraftSchema.parse({ ...draft, theme: { brand_color: "#7835DB", font_pair: "classic" } });
    expect(parsed.theme).toEqual({ brand_color: "#7835DB", accent_color: null, background_color: null, font_pair: "classic" });
    expect(siteDraftSchema.parse(parsed)).toEqual(parsed);
  });
  it.each(["accent_color", "background_color"])("validates exact nullable hex and uppercases %s", key => {
    const draft = defaultSiteDraft();
    for (const value of [null, "#abcdef", "#000000", "#FFFFFF"]) {
      expect(siteDraftSchema.parse({ ...draft, theme: { ...draft.theme, [key]: value } }).theme).toHaveProperty(key, typeof value === "string" ? value.toUpperCase() : null);
    }
    for (const value of ["#123", "#GGGGGG", " #abcdef ", "", 123, false]) expect(siteDraftSchema.safeParse({ ...draft, theme: { ...draft.theme, [key]: value } }).success).toBe(false);
  });
});

describe("wire invariants", () => {
  const variants = {
    hero: ["photo", "split", "centered"], story: ["text", "text_image"], values: ["grid", "list"],
    benefits: ["grid", "compact"], stats: ["row", "cards"], process: ["steps", "timeline"],
    gallery: ["grid", "mosaic", "carousel"], testimonials: ["cards", "quote"], video: ["wide", "split"],
    offices: ["list", "cards"], jobs: ["list", "cards", "by_area"], faq: ["accordion", "two_columns"], closing: ["banner", "simple"],
  } as const;
  for (const type of Object.keys(variants) as (keyof typeof variants)[]) {
    it(`${type} accepts exactly its contract variants and defaults to the first`, () => {
      const candidate = block(type);
      expect(candidate.variant).toBe(variants[type][0]);
      for (const variant of variants[type]) expect(blockSchema.safeParse({ ...candidate, variant }).success).toBe(true);
      expect(blockSchema.safeParse({ ...candidate, variant: "other" }).success).toBe(false);
    });
    it(`${type} content rejects unknown keys`, () => {
      const candidate = block(type);
      candidate.content.extra = true;
      expect(blockSchema.safeParse(candidate).success).toBe(false);
    });
  }
  for (const type of Object.keys(items) as (keyof typeof items)[]) it(`${type} items reject unknown keys`, () => {
    const candidate = block(type);
    candidate.content.items = [{ ...items[type], extra: true }];
    expect(blockSchema.safeParse(candidate).success).toBe(false);
  });
  it("normalizes blank strings, whitespace and hex case", () => {
    const draft = defaultSiteDraft();
    draft.slug = "  nexo-labs  "; draft.seo.title = "   "; draft.theme.brand_color = "#abcdef";
    const parsed = siteDraftSchema.parse(draft);
    expect(parsed.slug).toBe("nexo-labs"); expect(parsed.seo.title).toBeNull(); expect(parsed.theme.brand_color).toBe("#ABCDEF");
  });
  it("has 2–30 blocks, including repeatable optional types", () => {
    const draft = defaultSiteDraft();
    expect(siteDraftSchema.safeParse({ ...draft, blocks: [draft.blocks[0]] }).success).toBe(false);
    const blocks = [...draft.blocks, ...Array.from({ length: 28 }, () => defaultBlock("story"))];
    expect(siteDraftSchema.safeParse({ ...draft, blocks }).success).toBe(true);
    expect(siteDraftSchema.safeParse({ ...draft, blocks: [...blocks, defaultBlock("story")] }).success).toBe(false);
  });
  it.each(["hero", "jobs"] as const)("exactly one visible %s", type => {
    const draft = defaultSiteDraft();
    for (const blocks of [draft.blocks.filter(b => b.type !== type), [...draft.blocks, defaultBlock(type)], draft.blocks.map(b => b.type === type ? { ...b, hidden: true } : b)]) {
      expect(siteDraftSchema.safeParse({ ...draft, blocks }).success).toBe(false);
    }
  });
  it("UUID ids are unique", () => {
    const draft = defaultSiteDraft();
    draft.blocks[1].id = draft.blocks[0].id;
    expect(siteDraftSchema.safeParse(draft).success).toBe(false);
    draft.blocks[1].id = "bad";
    expect(siteDraftSchema.safeParse(draft).success).toBe(false);
  });
  it("rejects unknown keys at every site/block/content/item nesting", () => {
    const draft = defaultSiteDraft();
    for (const value of [{ ...draft, extra: true }, { ...draft, theme: { ...draft.theme, extra: true } }, { ...draft, seo: { ...draft.seo, extra: true } }, { ...draft, blocks: [{ ...draft.blocks[0], extra: true }, draft.blocks[1]] }]) expect(siteDraftSchema.safeParse(value).success).toBe(false);
    const candidate = block("benefits");
    candidate.content.extra = true;
    expect(blockSchema.safeParse(candidate).success).toBe(false);
    delete candidate.content.extra;
    candidate.content.items = [{ ...items.benefits, extra: true }];
    expect(blockSchema.safeParse(candidate).success).toBe(false);
  });
  it("rejects invalid hex, font, slug, type, variant and hidden format", () => {
    const draft = defaultSiteDraft();
    for (const theme of [{ brand_color: "#123", font_pair: "classic" }, { brand_color: "#GGGGGG", font_pair: "classic" }, { ...draft.theme, font_pair: "other" }]) expect(siteDraftSchema.safeParse({ ...draft, theme }).success).toBe(false);
    for (const slug of ["ab", "a".repeat(61), "admin", "Nexo", "-nexo"]) expect(siteDraftSchema.safeParse({ ...draft, slug }).success).toBe(false);
    for (const patch of [{ type: "unknown" }, { variant: "unknown" }, { hidden: "false" }]) expect(blockSchema.safeParse({ ...draft.blocks[0], ...patch }).success).toBe(false);
  });
  it("all 111 icons accepted; arbitrary icons rejected", () => {
    expect(ICONS).toHaveLength(111);
    const candidate = block("benefits");
    for (const icon of [...ICONS, "invalid"]) {
      candidate.content.items = [{ ...items.benefits, icon }];
      expect(blockSchema.safeParse(candidate).success).toBe(icon !== "invalid");
    }
  });
  it("a draft testimonial saves with consent still unchecked; consent must be a boolean", () => {
    const candidate = block("testimonials");
    for (const consent of [false, true, null, undefined, "yes"]) {
      candidate.content.items = [{ ...items.testimonials, consent }];
      expect(blockSchema.safeParse(candidate).success).toBe(typeof consent === "boolean");
    }
  });
  it("publishing needs consent on every visible testimonial", () => {
    const draft = siteDraftSchema.parse({ ...defaultSiteDraft(), slug: "nexo-labs" });
    draft.blocks[0].content = { ...draft.blocks[0].content, title: "Trabaja con nosotros" } as never;
    const testimonial = { ...block("testimonials"), content: { items: [{ ...items.testimonials, consent: false }] } };
    draft.blocks.push(testimonialsBlockSchema.parse(testimonial));
    const company = { name: "Nexo Labs", logo_url: "https://cdn.example/logo.png" };
    expect(publishIssues(draft, company)).toEqual([{ code: "block_incomplete", field: "blocks[2]" }]);
    (draft.blocks[2].content as { items: { consent: boolean }[] }).items[0].consent = true;
    expect(publishIssues(draft, company)).toEqual([]);
  });
  it("media references are nullable strict UUID objects", () => {
    const candidate = block("hero");
    for (const cover of [null, media, { media_id: "invalid" }, { ...media, url: "x" }, "url"]) {
      candidate.content.cover = cover;
      expect(blockSchema.safeParse(candidate).success).toBe(cover === null || cover === media);
    }
  });
  it("reuses strict location write shape, including null for incomplete items", () => {
    const candidate = block("offices");
    for (const location of [null, { country: "MX", state: "19", municipality: "19039" }, { country: "US" }, { country: "mx" }, { country: "US", name: "USA" }]) {
      candidate.content.items = [{ ...items.offices, location }];
      expect(blockSchema.safeParse(candidate).success).toBe(location === null || location.country === "MX" || (location.country === "US" && !("name" in location)));
    }
  });
  it("video stores normalized provider-specific IDs, never URLs", () => {
    const candidate = block("video");
    for (const video of [null, { provider: "youtube", video_id: "dQw4w9WgXcQ" }, { provider: "vimeo", video_id: "123456789012" }]) { candidate.content.video = video; expect(blockSchema.safeParse(candidate).success).toBe(true); }
    for (const video of [{ provider: "youtube", video_id: "short" }, { provider: "vimeo", video_id: "1234567890123" }, { provider: "vimeo", video_id: "abc" }, { provider: "other", video_id: "123" }, { provider: "youtube", video_id: "dQw4w9WgXcQ", extra: true }, "https://youtu.be/dQw4w9WgXcQ"]) { candidate.content.video = video; expect(blockSchema.safeParse(candidate).success).toBe(false); }
  });
});

describe("publication and defaults", () => {
  it("fresh defaults are independent, saveable and have the expected publish issues", () => {
    const draft = defaultSiteDraft();
    expect(siteDraftSchema.parse(draft)).toEqual(draft);
    expect(draft.theme).toEqual({ brand_color: "#7835DB", accent_color: null, background_color: null, font_pair: "classic" });
    expect(draft.seo).toEqual({ title: null, description: null });
    expect(draft.blocks.map(b => b.type)).toEqual(["hero", "jobs"]);
    expect(defaultSiteDraft().blocks[0].id).not.toBe(draft.blocks[0].id);
    expect(publishIssues(draft, { name: null, logo_url: null })).toEqual([
      { code: "slug_missing", field: "slug" }, { code: "hero_title_missing", field: "blocks[0]" },
      { code: "no_content_block", field: null }, { code: "company_logo_missing", field: null }, { code: "company_name_missing", field: null },
    ]);
    expect(publishIssues(draft, { name: "  ", logo_url: " " })).toContainEqual({ code: "company_name_missing", field: null });
    expect(STANDARD_BENEFITS.map(item => item.title)).toEqual([
      "Seguro de gastos médicos", "Equipo de cómputo", "Horario flexible", "Apoyo para trabajo remoto",
      "Presupuesto de capacitación", "Días libres adicionales", "Bienestar", "Bono anual",
    ]);
    for (const item of STANDARD_BENEFITS) {
      const candidate = block("benefits");
      candidate.content.items = [item];
      expect(blockSchema.safeParse(candidate).success).toBe(true);
    }
    const first = defaultBlock("benefits"), second = defaultBlock("benefits");
    expect(first.content).not.toBe(second.content);
  });
  for (const type of ["hero", "story", "values", "benefits", "stats", "process", "gallery", "testimonials", "video", "offices", "jobs", "faq", "closing"] as const) it(`${type} default saves and has library metadata`, () => {
    expect(blockSchema.safeParse(defaultBlock(type)).success).toBe(true);
    expect(BLOCK_LIBRARY[type].label).toBeTruthy(); expect(BLOCK_LIBRARY[type].description).toBeTruthy();
  });
  const required = { values: ["title"], benefits: ["title"], stats: ["value", "label"], process: ["title"], gallery: ["image", "alt"], testimonials: ["quote", "name"], offices: ["name", "location"], faq: ["question", "answer"] } as const;
  for (const [type, fields] of Object.entries(required)) for (const field of fields) it(`${type}.${field} required only to publish`, () => {
    const key = type as keyof typeof items;
    const candidate = block(key);
    const min = counts.find(([t]) => t === type)![1];
    candidate.content.items = Array.from({ length: min }, () => ({ ...items[key], [field]: null }));
    expect(blockSchema.safeParse(candidate).success).toBe(true);
    expect(issues(candidate)).toEqual([{ code: "block_incomplete", field: "blocks[2]" }]);
    candidate.hidden = true;
    expect(issues(candidate)).toEqual([{ code: "no_content_block", field: null }]);
  });
  it.each(["story", "video", "closing"] as const)("%s requires its publish content but no other optional fields", type => {
    const candidate = block(type);
    expect(issues(candidate)).toEqual([{ code: "block_incomplete", field: "blocks[2]" }]);
    if (type === "story") { candidate.content.body = rich("   "); expect(issues(candidate)).toHaveLength(1); candidate.content.body = rich("Historia"); }
    if (type === "video") candidate.content.video = { provider: "vimeo", video_id: "1" };
    if (type === "closing") candidate.content.title = "Únete";
    expect(issues(candidate)).toEqual([]);
  });
});
