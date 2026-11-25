import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { blockSchema, siteDraftReadSchemaV2, type BlockType, type SiteBlock } from "../model";
import { defaultBlock } from "../defaults";
import { vacancyDetail, legacyDetail, listItem } from "@/features/jobs/api/public-fixtures";
import { CompanySitePresentation } from "./company-site-presentation";
import { publishedFixture, mediaId } from "./fixtures.test-support";
vi.mock("next/font/google", () => ({ Fraunces: () => ({ variable: "editorial" }), Plus_Jakarta_Sans: () => ({ variable: "modern" }) }));

/* Golden pin (captured from the pre-sections-v2 presentation, 616b3934): a legacy
 * document — and the same document normalized by the v2 read, whose style is the
 * default — must keep producing byte-identical public and editor markup. */
const image = { media_id: mediaId };
const content: Record<BlockType, unknown> = {
  hero: { title: "Nuestro siguiente capítulo", subtitle: "Creamos juntos", cover: image },
  story: { title: "Nuestra historia", body: vacancyDetail.description, image },
  values: { mission: "Hacemos equipo", items: [{ icon: "rocket", emoji: null, title: "Curiosidad", description: "Exploramos juntos" }, { icon: null, emoji: "🌱", title: "Cuidado", description: null }] },
  benefits: { items: [{ icon: "coffee", emoji: null, title: "Café compartido", description: "Tiempo para conectar" }, { icon: "home", emoji: null, title: "Remoto", description: null }, { icon: "gift", emoji: null, title: "Bono", description: "Anual" }] },
  stats: { items: [{ value: "+15", label: "Años" }, { value: "Monterrey", label: "Nuestra casa" }] },
  process: { items: [{ title: "Conversación", description: "Conócenos", duration: "30 minutos" }, { title: "Entrevista", description: null, duration: null }] },
  gallery: { items: [{ image, alt: "Equipo conversando", caption: "Primera foto" }, { image, alt: "Oficina luminosa", caption: null }] },
  testimonials: { items: [{ quote: "Mis ideas importan", name: "Ana", role: "Diseño", photo: image, consent: true }, { quote: "Sin permiso", name: "Luis", role: null, photo: null, consent: false }] },
  video: { video: { provider: "youtube", video_id: "dQw4w9WgXcQ" }, title: "Conoce el equipo", description: "Así trabajamos" },
  offices: { items: [{ name: "Oficina central", address: "Calle Real", location: null, map_url: "https://maps.example.com/x" }] },
  jobs: { title: "Oportunidades", intro: "Encuentra tu lugar" },
  faq: { items: [{ question: "¿Cómo empiezo?", answer: "Abre una vacante" }] },
  closing: { title: "Construyamos juntos", text: "Te esperamos" },
};
const variants: Record<BlockType, string[]> = { hero: ["photo", "split", "centered"], story: ["text", "text_image"], values: ["grid", "list"], benefits: ["grid", "compact"], stats: ["row", "cards"], process: ["steps", "timeline"], gallery: ["grid", "mosaic", "carousel"], testimonials: ["cards", "quote"], video: ["wide", "split"], offices: ["list", "cards"], jobs: ["list", "cards", "by_area"], faq: ["accordion", "two_columns"], closing: ["banner", "simple"] };
const id = (index: number) => `0198f5a2-7c1b-7ddd-9c2e-${String(index).padStart(12, "0")}`;
const jobs = [listItem(vacancyDetail), listItem(legacyDetail)];

/** One page per variant (hero and jobs are unique), with a story so the hero shows both buttons. */
function legacyPages(): { label: string; site: ReturnType<typeof publishedFixture>["site"] }[] {
  return Object.entries(variants).flatMap(([type, names]) => names.map(variant => {
    const data = publishedFixture();
    const block = blockSchema.parse({ ...defaultBlock(type as BlockType), id: id(1), variant, content: content[type as BlockType] }) as SiteBlock;
    const hero = { ...data.site.blocks.find(b => b.type === "hero")!, id: id(10) };
    const story = blockSchema.parse({ ...defaultBlock("story"), id: id(11), content: content.story }) as SiteBlock;
    const jobsBlock = { ...data.site.blocks.find(b => b.type === "jobs")!, id: id(12) };
    const base: SiteBlock[] = [hero, story, jobsBlock];
    const replaced = base.findIndex(b => b.type === type);
    const blocks = replaced >= 0 ? base.map((b, index) => index === replaced ? block : b) : [...base, block];
    return { label: `${type}/${variant}`, site: { ...data.site, blocks } };
  }));
}
/** Full page once, then the hero and the tested section of every variant (public and editor), keyed by variant. */
function markup(normalize: boolean): Record<string, string> {
  const company = publishedFixture().company;
  const section = (html: string, blockId: string) => new DOMParser().parseFromString(html, "text/html").getElementById(`bloque-${blockId}`)?.outerHTML ?? "(missing)";
  return Object.fromEntries(legacyPages().map(({ label, site }, index) => {
    const read = normalize ? siteDraftReadSchemaV2.parse({ ...site, slug: "nexo-labs" }) : site;
    const props = { site: read as typeof site, company, jobs, officeLabels: new Map<string, string>() };
    const pub = renderToStaticMarkup(<CompanySitePresentation {...props} />);
    const editor = renderToStaticMarkup(<CompanySitePresentation {...props} selectedBlockId={id(1)} onSelectBlock={() => {}} />);
    if (index === 0) return [label, `${pub}\n${editor}`];
    const hero = site.blocks[0].id;
    return [label, `${section(pub, hero)}${hero === id(1) ? "" : section(pub, id(1))}\n${section(editor, id(1))}`];
  }));
}
/** React `useId` values («…») depend on provider depth, not on the markup; number them by first use. */
const stableIds = (html: string) => { const ids = new Map<string, string>(); return html.replace(/«[^»]*»/g, id => ids.get(id) ?? (ids.set(id, `«id${ids.size}»`), `«id${ids.size - 1}»`)); };
const digest = (pages: Record<string, string>) => Object.fromEntries(Object.entries(pages).map(([label, html]) => [label, createHash("sha256").update(stableIds(html)).digest("hex").slice(0, 16)]));

it("legacy documents keep their pre-v2 public and editor markup (golden)", () => {
  // Per-variant digests keep the pin small; a mismatch names the variant whose markup changed.
  expect(digest(markup(false))).toMatchSnapshot();
});
it("the v2 read of a legacy document (default style, default hero buttons) renders the same markup", () => {
  expect(markup(true)).toEqual(markup(false));
});
