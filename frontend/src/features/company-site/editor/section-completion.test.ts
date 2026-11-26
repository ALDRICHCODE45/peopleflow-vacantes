import { describe, expect, it } from "vitest";
import { defaultBlockV2 } from "../defaults";
import { publishIssuesV2, type SiteBlockV2 } from "../model";
import { missingContent } from "./section-completion";

const media = { media_id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d94" };
function block(type: SiteBlockV2["type"], patch: Record<string, unknown> = {}, rest: Partial<SiteBlockV2> = {}): SiteBlockV2 {
  const base = defaultBlockV2(type);
  return { ...base, ...rest, content: { ...base.content, ...patch } } as SiteBlockV2;
}
const person = (patch: Record<string, unknown> = {}) => ({ name: "Ana", role: null, photo: null, consent: true, ...patch });

describe("missingContent: what the «Incompleta» chip and «Completar sección» point at", () => {
  it.each([
    ["team, no people", block("team", { title: "Líderes" }), { hint: "Falta: al menos 1 persona con permiso", group: "content", target: "items-add" }],
    ["team, a person without permission", block("team", { items: [person({ consent: false })] }), { hint: "Falta: el permiso (persona 1)", group: "content", target: "item:consent", item: 0 }],
    ["team, the second person without a name", block("team", { items: [person(), person({ name: null })] }), { hint: "Falta: el nombre (persona 2)", group: "content", target: "item:name", item: 1 }],
    ["logos, a logo without its image", block("logos", { items: [{ name: "ISO 9001", image: null, caption: null }] }), { hint: "Falta: el logo (logo 1)", group: "content", target: "item:image", item: 0 }],
    ["process, one step of two", block("process", { items: [{ title: "Llamada", description: null, duration: null }] }), { hint: "Falta: al menos 2 pasos", group: "content", target: "items-add" }],
    ["gallery, no photos", block("gallery"), { hint: "Falta: al menos 2 fotos con texto alternativo", group: "content", target: "items-add" }],
    ["offices, no country", block("offices", { items: [{ name: "CDMX", location: null, address: null, map_url: null }] }), { hint: "Falta: el país (oficina 1)", group: "content", target: "item:location", item: 0 }],
    ["story", block("story", { title: "Así empezamos" }), { hint: "Falta: el texto de la historia", group: "content", target: "story-body" }],
    ["video", block("video", { title: "Conócenos" }), { hint: "Falta: el enlace del video", group: "content", target: "video" }],
    ["closing", block("closing", { text: "Te esperamos" }), { hint: "Falta: el título", group: "content", target: "title" }],
    ["areas", block("areas"), { hint: "Falta: el título", group: "content", target: "title" }],
    ["hero without title", block("hero"), { hint: "Falta: el título principal", group: "content", target: "title" }],
    ["hero collage with one photo", block("hero", { title: "Hola", images: [media] }, { variant: "collage" } as Partial<SiteBlockV2>), { hint: "Falta: al menos 2 fotos para el collage", group: "content", target: "collage" }],
    ["hero background video, nothing uploaded", block("hero", { title: "Hola" }, { variant: "background_loop" } as Partial<SiteBlockV2>), { hint: "Falta: el video de fondo", group: "content", target: "background-video" }],
    ["hero background video without its poster", block("hero", { title: "Hola", background_video: media }, { variant: "background_loop" } as Partial<SiteBlockV2>), { hint: "Falta: la imagen de portada (póster del video)", group: "content", target: "cover" }],
    ["image background without image", block("faq", { items: [{ question: "¿Q?", answer: "R" }] }, { style: { background: "image", spacing: "airy", align: "start", overlay: "medium", image: null } }), { hint: "Falta: la imagen de fondo", group: "style", target: "style-image" }],
  ])("%s", (_, target, expected) => {
    expect(missingContent(target)).toEqual(expected);
  });
  it("a complete or hidden section misses nothing", () => {
    expect(missingContent(block("hero", { title: "Hola", background_video: media, cover: media }, { variant: "background_loop" } as Partial<SiteBlockV2>))).toBeNull();
    expect(missingContent(block("team", { items: [person()] }))).toBeNull();
    expect(missingContent(block("team", {}, { hidden: true }))).toBeNull();
  });
  it("a hero button that leads to a hidden section", () => {
    const story = block("story", {}, { hidden: true });
    const hero = block("hero", { title: "Hola", secondary_target: story.id });
    expect(missingContent(hero, [hero, story])).toEqual({ hint: "Falta: el botón secundario lleva a una sección oculta", group: "buttons", target: "secondary-target" });
  });
  it("agrees with the publish rules for every default section (no chip without a hint)", () => {
    const blocks = (["story", "values", "benefits", "stats", "process", "gallery", "testimonials", "video", "offices", "faq", "closing", "team", "logos", "areas", "talent_cta"] as const).map(type => block(type));
    const draft = { slug: "x", theme: { brand_color: "#7835DB", accent_color: null, background_color: null, font_pair: "classic" as const }, seo: { title: null, description: null }, blocks: [block("hero", { title: "Hola" }), ...blocks, block("jobs")] };
    const flagged = new Set(publishIssuesV2(draft, { name: "x", logo_url: "x" }).flatMap(issue => /^blocks\[(\d+)\]/.exec(issue.field ?? "")?.[1] ?? []).map(Number));
    draft.blocks.forEach((item, index) => expect(missingContent(item, draft.blocks) !== null).toBe(flagged.has(index)));
  });
});
