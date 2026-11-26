import { describe, expect, it } from "vitest";

import { BLOCK_LIBRARY, BLOCK_LIBRARY_V2, defaultBlock, defaultBlockV2, NEW_VARIANT_LABELS, SECTION_STYLE_LABELS } from "./defaults";
import { LOGO_MEDIA_TYPES, LOGO_MIN_PX, mediaKindSchema, mediaKindSchemaV2 } from "./media";
import { blockSchemaV2, DEFAULT_SECTION_STYLE, HERO_BUTTON_DEFAULTS, SECTION_BACKGROUNDS, SECTION_OVERLAYS, type BlockTypeV2 } from "./model";

const v2Types = Object.keys(BLOCK_LIBRARY_V2) as BlockTypeV2[];

describe("v2 templates", () => {
  it("cover every v2 block type, legacy library unchanged", () => {
    expect(v2Types).toEqual([...Object.keys(BLOCK_LIBRARY), "team", "logos", "areas", "talent_cta"]);
    expect(BLOCK_LIBRARY_V2.team.label).toBe("Equipo / Líderes");
    expect(BLOCK_LIBRARY_V2.logos.label).toBe("Logos / Reconocimientos");
    expect(BLOCK_LIBRARY_V2.areas.label).toBe("Áreas de trabajo");
    expect(BLOCK_LIBRARY_V2.talent_cta.label).toBe("Llamado a talento");
  });
  it.each(v2Types)("%s template saves, carries the default style and has library copy", type => {
    const block = defaultBlockV2(type);
    expect(blockSchemaV2.parse(block)).toEqual(block);
    expect(block.style).toEqual(DEFAULT_SECTION_STYLE);
    expect(BLOCK_LIBRARY_V2[type].description).toBeTruthy();
  });
  it("templates own their ids, arrays and style", () => {
    const first = defaultBlockV2("team"), second = defaultBlockV2("team");
    expect(first.id).not.toBe(second.id);
    expect(first.style).not.toBe(second.style);
    expect(first.content).not.toBe(second.content);
  });
  it("hero template carries the button defaults and talent_cta a button label", () => {
    const hero = defaultBlockV2("hero");
    expect(hero.type === "hero" && hero.content).toMatchObject({ images: [], ...HERO_BUTTON_DEFAULTS });
    const cta = defaultBlockV2("talent_cta");
    expect(cta.type === "talent_cta" && cta.content.button_label).toBe("Dejar mi CV");
  });
  it("legacy templates keep today's exact shape", () => {
    const hero = defaultBlock("hero");
    expect(hero).not.toHaveProperty("style");
    expect(Object.keys(hero.content)).toEqual(["title", "subtitle", "cover"]);
  });
  it("labels every new variant and every style choice", () => {
    const variants = new Set(blockSchemaV2.options.flatMap(option => option.shape.variant.options));
    for (const variant of ["background_loop", "photo_jobs", "collage", "bento", "big_icons", "brand_band", "photo_strip", "portraits", "strip", "icon_cards", "photo_cards"]) {
      expect(variants.has(variant as never)).toBe(true);
      expect(NEW_VARIANT_LABELS[variant as keyof typeof NEW_VARIANT_LABELS]).toBeTruthy();
    }
    for (const background of SECTION_BACKGROUNDS) expect(SECTION_STYLE_LABELS.background[background]).toBeTruthy();
    for (const overlay of SECTION_OVERLAYS) expect(SECTION_STYLE_LABELS.overlay[overlay]).toBeTruthy();
    expect(SECTION_STYLE_LABELS.spacing).toEqual({ compact: "Compacto", airy: "Amplio" });
    expect(SECTION_STYLE_LABELS.align).toEqual({ center: "Centrado", start: "Izquierda" });
  });
});

describe("logo media kind", () => {
  it("exists only in the v2 kinds with its PNG/WebP and 64 px constraints", () => {
    expect(mediaKindSchemaV2.safeParse("logo").success).toBe(true);
    expect(mediaKindSchema.safeParse("logo").success).toBe(false);
    for (const kind of mediaKindSchema.options) expect(mediaKindSchemaV2.safeParse(kind).success).toBe(true);
    expect(LOGO_MEDIA_TYPES).toEqual(["image/png", "image/webp"]);
    expect(LOGO_MIN_PX).toBe(64);
  });
});
