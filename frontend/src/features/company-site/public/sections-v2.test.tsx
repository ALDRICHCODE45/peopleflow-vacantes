import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import "@testing-library/jest-dom/vitest";
import { blockSchemaV2, siteDraftReadSchemaV2, type BlockTypeV2, type SectionStyle, type SiteBlockV2 } from "../model";
import { BLOCK_LIBRARY_V2, defaultBlockV2 } from "../defaults";
import { listItem, vacancyDetail } from "@/features/jobs/api/public-fixtures";
import type { PublicJobItem } from "@/features/jobs/types";
import { CompanySitePresentation } from "./company-site-presentation";
import { CompanySitePage } from "./company-site-page";
import { publishedFixture, mediaId } from "./fixtures.test-support";
import { SCRIM_ALPHA } from "./section-style";
vi.mock("next/font/google", () => ({ Fraunces: () => ({ variable: "editorial" }), Plus_Jakarta_Sans: () => ({ variable: "modern" }) }));
vi.mock("@/features/geo/client", () => ({ getCountries: async () => ({ ok: true, data: { items: [] } }), getStates: async () => ({ ok: true, data: { items: [] } }), getMunicipalities: async () => ({ ok: true, data: { items: [] } }) }));

const image = { media_id: mediaId };
const otherImage = { media_id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d95" };
const id = (index: number) => `0198f5a2-7c1b-7ddd-9c2e-${String(index).padStart(12, "0")}`;
const job = (index: number, patch: Partial<PublicJobItem> = {}) => ({ ...listItem(vacancyDetail), id: id(500 + index), title: `Vacante ${index}`, ...patch }) as PublicJobItem;
let reduced = false;
beforeEach(() => {
  reduced = false;
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query.includes("reduce") && reduced, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), onchange: null, dispatchEvent: vi.fn() })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

/** A normalized v2 public site (hero + story + jobs) plus the given blocks. */
function site(...extra: SiteBlockV2[]) {
  const data = publishedFixture();
  const read = siteDraftReadSchemaV2.parse({ ...data.site, slug: data.slug });
  const { slug: _slug, ...document } = read; void _slug;
  const blocks = [...document.blocks.map((block, index) => ({ ...block, id: id(900 + index) }))];
  for (const block of extra) {
    const at = blocks.findIndex(existing => existing.type === block.type && (block.type === "hero" || block.type === "jobs"));
    if (at >= 0) blocks[at] = block; else blocks.push(block);
  }
  return { ...document, blocks };
}
function block(type: BlockTypeV2, patch: { variant?: string; content?: Record<string, unknown>; style?: Partial<SectionStyle> } = {}, index = 1): SiteBlockV2 {
  const base = defaultBlockV2(type);
  return blockSchemaV2.parse({ ...base, id: id(index), ...(patch.variant ? { variant: patch.variant } : {}), content: { ...base.content, ...patch.content }, style: { ...base.style, ...patch.style } });
}
function draw(document: ReturnType<typeof site>, jobs: PublicJobItem[] = [job(1)], editor = false) {
  const company = publishedFixture().company;
  return render(<CompanySitePresentation site={document} company={{ ...company, location: { country: { id: "MX", name: "México" }, state: null, municipality: null, postal_code: null, label: "Monterrey, Nuevo León" } }} jobs={jobs} officeLabels={new Map()} {...(editor ? { onSelectBlock: vi.fn(), selectedBlockId: id(1) } : {})} />).container;
}
const section = (container: HTMLElement, blockId = id(1)) => container.querySelector<HTMLElement>(`[id="bloque-${blockId}"]`)!;
const benefits = (count: number) => Array.from({ length: count }, (_, index) => ({ icon: "gift", emoji: null, title: `Beneficio ${index + 1}`, description: index === 0 ? "El primero" : null }));

describe("per-block style (S3)", () => {
  const values = (style: Partial<SectionStyle>) => block("values", { content: { mission: "Hacemos equipo", items: [{ icon: "rocket", emoji: null, title: "Curiosidad", description: null }] }, style });
  it("default style keeps the section's legacy surface and spacing", () => {
    const container = draw(site(values({})));
    const element = section(container);
    expect(element.className).not.toContain("bg-(--site-band)");
    expect(element).not.toHaveAttribute("data-site-surface");
    expect(element.firstElementChild).toHaveClass("py-10", "lg:py-16");
  });
  it("tint paints its own brand-tinted surface, apart from the band even on banded sections; brand re-themes the section for on-brand ink", () => {
    const tinted = section(draw(site(values({ background: "tint" }))));
    expect(tinted).toHaveAttribute("data-site-surface", "tint");
    expect(tinted.className).not.toContain("bg-(--site-band)");
    expect(tinted.style.getPropertyValue("--site-tint-light")).toMatch(/^#[\dA-F]{6}$/);
    expect(tinted.style.getPropertyValue("--site-tint-dark")).toMatch(/^#[\dA-F]{6}$/);
    cleanup();
    // Historia sits on the alternating band by default: «Normal» and «Tinte suave» must still differ.
    // Editor preview: the empty Historia still draws its surface.
    const story = (style: Partial<SectionStyle>) => draw(site(block("story", { style })), [job(1)], true);
    const normal = section(story({}));
    expect(normal).toHaveClass("bg-(--site-band)");
    expect(normal).not.toHaveAttribute("data-site-surface");
    expect(normal.style.getPropertyValue("--site-tint-light")).toBe("");
    cleanup();
    const tintedStory = section(story({ background: "tint" }));
    expect(tintedStory).toHaveAttribute("data-site-surface", "tint");
    expect(tintedStory.className).not.toContain("bg-(--site-band)");
    cleanup();
    const element = section(draw(site(values({ background: "brand" }))));
    expect(element).toHaveAttribute("data-site-surface", "brand");
    expect(element.className).not.toContain("bg-(--site-band)");
  });
  it.each(["soft", "medium", "strong"] as const)("image background %s draws the photo under a contrast scrim", overlay => {
    const element = section(draw(site(values({ background: "image", image, overlay }))));
    expect(element).toHaveAttribute("data-site-surface", "scrim");
    const layer = element.querySelector("[data-section-background]")!;
    expect(layer).toHaveAttribute("aria-hidden", "true");
    expect(layer.querySelector("img")).toHaveAttribute("src", `/media/sitios/${mediaId}`);
    expect(layer.querySelector("img")).toHaveAttribute("alt", "");
    expect((layer.querySelector("[data-scrim]") as HTMLElement).style.backgroundColor).toContain(String(SCRIM_ALPHA[overlay]));
  });
  it("an image background without its image yet stays a dark readable surface, never a broken image", () => {
    const element = section(draw(site(values({ background: "image", image: null }))));
    expect(element).toHaveAttribute("data-site-surface", "scrim");
    expect(element.querySelector("img")).toBeNull();
  });
  it("compact spacing and centered alignment", () => {
    const element = section(draw(site(values({ spacing: "compact", align: "center" }))));
    expect(element.firstElementChild).toHaveClass("py-6", "lg:py-10");
    expect(element.querySelector("h2")!.parentElement).toHaveClass("mx-auto", "items-center", "text-center");
  });
});

describe("hero v2", () => {
  const hero = (variant: string, content: Record<string, unknown> = {}) => block("hero", { variant, content: { title: "Talento que mueve", subtitle: "Conectamos personas", ...content } });
  it("background_loop without a video draws the brand gradient (or the poster), a pause control and meta chips, never a <video>", () => {
    const container = draw(site(hero("background_loop")), [job(1), job(2)]);
    const element = section(container);
    expect(element.querySelector("video")).toBeNull();
    expect(element.querySelector("[data-hero-loop]")).not.toBeNull();
    expect(within(element).getByRole("heading", { level: 1, name: "Talento que mueve" })).toBeVisible();
    expect(within(element).getByText("Monterrey, Nuevo León")).toBeVisible();
    expect(within(element).getByText("2 vacantes abiertas")).toBeVisible();
    const pause = within(element).getByRole("button", { name: "Pausar fondo animado" });
    fireEvent.click(pause);
    expect(within(element).getByRole("button", { name: "Reanudar fondo animado" })).toBeVisible();
    expect(element.querySelector("[data-hero-loop]")).toHaveAttribute("data-paused", "true");
    cleanup();
    const poster = section(draw(site(hero("background_loop", { cover: image }))));
    expect(poster.querySelector("video")).toBeNull();
    expect(poster.querySelector("img")).toHaveAttribute("src", `/media/sitios/${mediaId}`);
  });
  it("background_loop hides the pause control under reduced motion", () => {
    reduced = true;
    const element = section(draw(site(hero("background_loop"))));
    expect(within(element).queryByRole("button", { name: /fondo animado/ })).toBeNull();
  });
  describe("background video (slice B)", () => {
    const clip = { media_id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d96" };
    let play: ReturnType<typeof vi.fn>;
    let pause: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      play = vi.fn().mockResolvedValue(undefined); pause = vi.fn();
      vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
      vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause);
    });
    afterEach(() => vi.restoreAllMocks());
    const loop = (content: Record<string, unknown> = {}) => section(draw(site(hero("background_loop", { cover: image, background_video: clip, ...content }))));
    it("renders a muted, looped, inline, autoplaying <video> with the cover as poster, under the scrim", () => {
      const element = loop();
      const video = element.querySelector("video")!;
      expect(video).toHaveAttribute("src", `/media/sitios/${clip.media_id}`);
      expect(video).toHaveAttribute("poster", `/media/sitios/${mediaId}`);
      expect(video.muted).toBe(true);
      expect(video).toHaveAttribute("loop");
      expect(video).toHaveAttribute("playsinline");
      expect(video.autoplay).toBe(true);
      expect(video).toHaveAttribute("preload", "metadata");
      expect(video).toHaveClass("object-cover");
      expect(video.compareDocumentPosition(element.querySelector("[data-scrim]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(video.closest("[aria-hidden='true']")).not.toBeNull();
      expect(element.querySelector("[data-hero-loop]")).toBeNull();
    });
    it("server markup is muted and plays inline (iOS autoplay needs both attributes)", () => {
      const markup = renderToStaticMarkup(<CompanySitePresentation site={site(hero("background_loop", { cover: image, background_video: clip }))} company={publishedFixture().company} jobs={[]} officeLabels={new Map()} />);
      expect(markup).toMatch(/<video[^>]*muted=""/);
      expect(markup).toMatch(/<video[^>]*playsInline=""|<video[^>]*playsinline=""/);
    });
    it("«Pausar fondo animado» pauses and «Reproducir» resumes (aria-pressed follows)", () => {
      const element = loop();
      const toggle = within(element).getByRole("button", { name: "Pausar fondo animado" });
      expect(toggle).toHaveAttribute("aria-pressed", "false");
      fireEvent.click(toggle);
      expect(pause).toHaveBeenCalled();
      const resume = within(element).getByRole("button", { name: "Reproducir" });
      expect(resume).toHaveAttribute("aria-pressed", "true");
      play.mockClear();
      fireEvent.click(resume);
      expect(play).toHaveBeenCalled();
      expect(within(element).getByRole("button", { name: "Pausar fondo animado" })).toHaveAttribute("aria-pressed", "false");
    });
    it("reduced motion: no autoplay, the poster only, and the control offers «Reproducir»", () => {
      reduced = true;
      const element = loop();
      const video = element.querySelector("video")!;
      expect(video.autoplay).toBe(false);
      expect(play).not.toHaveBeenCalled();
      expect(pause).toHaveBeenCalled();
      fireEvent.click(within(element).getByRole("button", { name: "Reproducir" }));
      expect(play).toHaveBeenCalled();
    });
    it("a video error falls back to the cover (or the brand gradient) and drops the control", () => {
      const element = loop();
      fireEvent.error(element.querySelector("video")!);
      expect(element.querySelector("video")).toBeNull();
      expect(element.querySelector("img")).toHaveAttribute("src", `/media/sitios/${mediaId}`);
      expect(within(element).queryByRole("button", { name: /Pausar fondo animado|Reproducir/ })).toBeNull();
      cleanup();
      const gradient = loop({ cover: null });
      fireEvent.error(gradient.querySelector("video")!);
      expect(gradient.querySelector("video")).toBeNull();
      expect(gradient.querySelector("[data-hero-loop]")).not.toBeNull();
    });
    it("plays in the editor preview too", () => {
      const element = section(draw(site(hero("background_loop", { cover: image, background_video: clip })), [job(1)], true));
      expect(element.querySelector("video")!.autoplay).toBe(true);
    });
  });
  it("custom button labels, secondary target anchor, and a hidden secondary", () => {
    const team = block("team", { content: { title: "Equipo", items: [{ name: "Ana", role: "Directora", photo: null, consent: true }] } }, 7);
    const container = draw(site(hero("photo", { cover: image, primary_label: "Únete", secondary_label: "Conoce al equipo", secondary_target: id(7) }), team));
    const element = section(container);
    const jobs = container.querySelector('section[data-block-type="jobs"]')!;
    expect(within(element).getByRole("link", { name: "Únete" })).toHaveAttribute("href", `#${jobs.id}`);
    expect(within(element).getByRole("link", { name: "Conoce al equipo" })).toHaveAttribute("href", `#bloque-${id(7)}`);
    cleanup();
    const hidden = section(draw(site(hero("photo", { secondary_visible: false }))));
    expect(within(hidden).queryByRole("link", { name: "Conoce la empresa" })).toBeNull();
    expect(within(hidden).getByRole("link", { name: "Ver vacantes" })).toBeVisible();
  });
  it("photo_jobs shows the three newest vacancies linking to them, and all vacancies", () => {
    const jobs = [job(1, { published_at: "2026-10-01T00:00:00Z" }), job(2, { published_at: "2026-11-20T00:00:00Z" }), job(3, { published_at: "2026-11-01T00:00:00Z" }), job(4, { published_at: "2026-11-24T00:00:00Z" })];
    const element = section(draw(site(hero("photo_jobs", { cover: image })), jobs));
    const card = within(element).getByRole("region", { name: "Vacantes recientes" });
    const links = within(card).getAllByRole("link");
    expect(links.slice(0, 3).map(link => link.textContent)).toEqual([expect.stringContaining("Vacante 4"), expect.stringContaining("Vacante 2"), expect.stringContaining("Vacante 3")]);
    expect(links[0]).toHaveAttribute("href", expect.stringContaining(id(504)));
    expect(within(card).getByRole("link", { name: "Ver las 4 vacantes" })).toHaveAttribute("href", expect.stringMatching(/^#bloque-/));
  });
  it("photo_jobs without vacancies omits the card instead of inventing it", () => {
    const element = section(draw(site(hero("photo_jobs", { cover: image })), []));
    expect(within(element).queryByRole("region", { name: "Vacantes recientes" })).toBeNull();
  });
  it("collage shows up to three photos", () => {
    const element = section(draw(site(hero("collage", { images: [image, otherImage, image] }))));
    expect(element.querySelector('[data-layout="hero-collage"]')!.querySelectorAll("img")).toHaveLength(3);
  });
});

describe("benefits and values v2", () => {
  it.each([1, 2, 3, 4, 5, 6, 7])("bento lays out %i items with the shared span math", count => {
    const element = section(draw(site(block("benefits", { variant: "bento", content: { items: benefits(count) } }))));
    const grid = element.querySelector('[data-layout="benefits-bento"] ul')!;
    expect(grid).toHaveAttribute("data-bento-count", String(count));
    const items = grid.querySelectorAll(":scope > li");
    expect(items).toHaveLength(count);
    if (count === 1) expect(items[0]).toHaveClass("lg:col-span-6", "sm:col-span-2");
    expect(within(element).getAllByRole("heading", { level: 3 })).toHaveLength(count);
  });
  it("values big_icons renders the mission and one card per value", () => {
    const element = section(draw(site(block("values", { variant: "big_icons", content: { mission: "Que cada vacante se cubra", items: [{ icon: "shield", emoji: null, title: "Transparencia", description: "Claridad" }, { icon: null, emoji: "🤝", title: "Trato humano", description: null }] } }))));
    expect(element.querySelector('[data-layout="values-big_icons"]')).not.toBeNull();
    expect(within(element).getByText("Que cada vacante se cubra")).toBeVisible();
    expect(within(element).getAllByRole("heading", { level: 3 }).map(node => node.textContent)).toEqual(["Transparencia", "Trato humano"]);
  });
});

describe("stats brand_band", () => {
  const stats = () => block("stats", { variant: "brand_band", content: { items: [{ value: "+15", label: "años" }, { value: "300+", label: "colaboradores" }, { value: "Monterrey", label: "casa" }] } });
  it("paints the brand band and shows final values immediately under reduced motion", () => {
    reduced = true;
    const element = section(draw(site(stats())));
    expect(element).toHaveAttribute("data-site-surface", "brand");
    const values = [...element.querySelectorAll("dd [data-count-display]")].map(node => node.textContent);
    expect(values).toEqual(["+15", "300+", "Monterrey"]);
  });
  it("exposes the final value to assistive technology while the count animates", () => {
    vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} unobserve() {} });
    const element = section(draw(site(stats())));
    expect([...element.querySelectorAll("dd")].map(node => node.querySelector(".sr-only")?.textContent)).toEqual(["+15", "300+", "Monterrey"]);
    expect(element.querySelector("dd [data-count-display]")).toHaveTextContent("+0");
  });
  it("counts up to the final value once on screen", async () => {
    type Callback = (entries: { isIntersecting: boolean }[]) => void;
    const observers: Callback[] = [];
    const fire = (entries: { isIntersecting: boolean }[]) => observers.forEach(callback => callback(entries));
    vi.stubGlobal("IntersectionObserver", class { constructor(callback: Callback) { observers.push(callback); } observe() {} disconnect() {} unobserve() {} });
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const element = section(draw(site(stats())));
    act(() => fire([{ isIntersecting: true }]));
    const flush = (time: number) => act(() => { for (const callback of frames.splice(0)) callback(time); });
    flush(100); flush(700);
    const midway = Number(element.querySelector("dd [data-count-display]")!.textContent!.replace("+", ""));
    expect(midway).toBeGreaterThan(0); expect(midway).toBeLessThan(15);
    flush(100 + 1200);
    expect(frames).toHaveLength(0);
    expect([...element.querySelectorAll("dd [data-count-display]")].map(node => node.textContent)).toEqual(["+15", "300+", "Monterrey"]);
  });
  it("server markup carries the final values (no-JS, SEO)", () => {
    const html = renderToStaticMarkup(<CompanySitePresentation site={site(stats())} company={publishedFixture().company} jobs={[]} officeLabels={new Map()} />);
    expect(html).toContain(">+15<"); expect(html).toContain(">300+<");
  });
});

describe("testimonials carousel", () => {
  const testimonials = () => block("testimonials", { variant: "carousel", content: { items: [
    { quote: "Entré como junior", name: "Daniela", role: "Coordinadora", photo: image, consent: true, video_url: null },
    { quote: "Me explicaron todo", name: "Jorge", role: "Supervisor", photo: null, consent: true, video_url: "https://youtu.be/dQw4w9WgXcQ" },
    { quote: "Sin permiso", name: "Luis", role: null, photo: null, consent: false, video_url: null },
    { quote: "Respetan mis horarios", name: "Paola", role: null, photo: image, consent: true, video_url: null },
  ] } });
  it("shows one consented testimonial at a time with prev/next and «N de M»", () => {
    const element = section(draw(site(testimonials())));
    const carousel = within(element).getByRole("region", { name: "Testimonios" });
    expect(carousel).toHaveAttribute("aria-roledescription", "carrusel");
    expect(within(carousel).getByText("1 de 3")).toBeVisible();
    expect(within(carousel).getByText("Entré como junior")).toBeVisible();
    expect(within(carousel).queryByText("Sin permiso")).toBeNull();
    expect(within(carousel).getByRole("button", { name: "Testimonio anterior" })).toBeDisabled();
    fireEvent.click(within(carousel).getByRole("button", { name: "Testimonio siguiente" }));
    expect(within(carousel).getByText("2 de 3")).toBeVisible();
    expect(within(carousel).getByText("Me explicaron todo")).toBeVisible();
  });
  it("is keyboard operable with arrows, Home and End", () => {
    const element = section(draw(site(testimonials())));
    const carousel = within(element).getByRole("region", { name: "Testimonios" });
    expect(carousel).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(carousel, { key: "ArrowRight" });
    expect(within(carousel).getByText("2 de 3")).toBeVisible();
    fireEvent.keyDown(carousel, { key: "End" });
    expect(within(carousel).getByText("3 de 3")).toBeVisible();
    expect(within(carousel).getByRole("button", { name: "Testimonio siguiente" })).toBeDisabled();
    fireEvent.keyDown(carousel, { key: "Home" });
    expect(within(carousel).getByText("1 de 3")).toBeVisible();
    fireEvent.keyDown(carousel, { key: "ArrowLeft" });
    expect(within(carousel).getByText("1 de 3")).toBeVisible();
  });
  it("a testimonial video loads the privacy-friendly player only on request", () => {
    const element = section(draw(site(testimonials())));
    const carousel = within(element).getByRole("region", { name: "Testimonios" });
    fireEvent.keyDown(carousel, { key: "ArrowRight" });
    expect(element.querySelector("iframe")).toBeNull();
    fireEvent.click(within(carousel).getByRole("button", { name: "Ver video de Jorge" }));
    expect(element.querySelector("iframe")).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  });
});

describe("gallery photo_strip", () => {
  const gallery = () => block("gallery", { variant: "photo_strip", content: { items: [{ image, alt: "Oficina", caption: "Monterrey" }, { image: otherImage, alt: "Almacén", caption: null }] } });
  it("moves with a pause control; duplicated frames are hidden from assistive technology", () => {
    const element = section(draw(site(gallery())));
    const strip = element.querySelector("[data-photo-strip]")!;
    expect(strip).toHaveAttribute("data-paused", "false");
    expect(within(element).getAllByRole("img", { name: "Oficina" })).toHaveLength(1);
    fireEvent.click(within(element).getByRole("button", { name: "Pausar fotos" }));
    expect(strip).toHaveAttribute("data-paused", "true");
    expect(within(element).getByRole("button", { name: "Reanudar fotos" })).toBeVisible();
  });
  it("is still and hand-scrollable under reduced motion", () => {
    reduced = true;
    const element = section(draw(site(gallery())));
    expect(within(element).queryByRole("button", { name: /fotos/ })).toBeNull();
    const strip = element.querySelector("[data-photo-strip]")!;
    expect(strip).toHaveAttribute("data-paused", "true");
    expect(strip).toHaveAttribute("tabindex", "0");
    expect(strip.querySelectorAll("img")).toHaveLength(2);
  });
});

describe("new section types", () => {
  it.each(["grid", "portraits"])("team %s shows consented people only", variant => {
    const element = section(draw(site(block("team", { variant, content: { title: "Las personas que lideran", items: [{ name: "Mariana", role: "Directora", photo: image, consent: true }, { name: "Oculto", role: null, photo: null, consent: false }, { name: "Rodrigo", role: "Operaciones", photo: null, consent: true }] } }))));
    expect(element).toHaveAttribute("data-block-type", "team");
    expect(element.querySelector(`[data-layout="team-${variant}"]`)).not.toBeNull();
    expect(within(element).getByRole("heading", { level: 2, name: "Las personas que lideran" })).toBeVisible();
    expect(within(element).getAllByRole("heading", { level: 3 }).map(node => node.textContent)).toEqual(["Mariana", "Rodrigo"]);
    expect(within(element).queryByText("Oculto")).toBeNull();
  });
  it.each(["strip", "grid"])("logos %s names each logo once (alt text, or a visible caption)", variant => {
    const element = section(draw(site(block("logos", { variant, content: { title: "Empresas que confían", items: [{ name: "Constructora Sierra", image, caption: "Cliente desde 2015" }, { name: "Sin logo", image: null, caption: null }] } }))));
    expect(element.querySelector(`[data-layout="logos-${variant}"]`)).not.toBeNull();
    expect(element.querySelectorAll("img")).toHaveLength(1);
    expect(element.querySelector("img")).toHaveAttribute("src", `/media/sitios/${mediaId}`);
    if (variant === "strip") expect(within(element).getByRole("img", { name: "Constructora Sierra" })).toBeVisible();
    else { expect(element.querySelector("img")).toHaveAttribute("alt", ""); expect(within(element).getByText("Constructora Sierra").closest("figcaption")).not.toBeNull(); expect(within(element).getByText("Cliente desde 2015")).toBeVisible(); }
    expect(within(element).queryByText("Sin logo")).toBeNull();
  });
  it.each(["banner", "split"])("talent_cta %s links to the vacancies section, with no form or backend call", variant => {
    const container = draw(site(block("talent_cta", { variant, content: { title: "¿No encontraste tu vacante?", text: "Queremos conocerte" } })));
    const element = section(container);
    const jobs = container.querySelector('section[data-block-type="jobs"]')!;
    expect(within(element).getByRole("heading", { level: 2, name: "¿No encontraste tu vacante?" })).toBeVisible();
    expect(within(element).getByRole("link", { name: "Ver vacantes abiertas" })).toHaveAttribute("href", `#${jobs.id}`);
    expect(element.querySelector("form, input")).toBeNull();
  });
  it("areas without vacancies with an area are omitted on the public page", () => {
    const container = draw(site(block("areas", { content: { title: "Encuentra tu lugar" } })), [job(1, { professional_area: null })]);
    expect(section(container)).toBeNull();
  });
  it.each(["icon_cards", "photo_cards"])("areas %s derives cards from vacancies and filters the vacancy list with a removable chip", variant => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const jobs = [job(1, { professional_area: "logistics_transport" }), job(2, { professional_area: "human_resources" }), job(3, { professional_area: "logistics_transport" })];
    const container = draw(site(block("areas", { variant, content: { title: "Encuentra tu lugar", overrides: [{ key: "human_resources", icon: null, photo: image }] } })), jobs);
    const element = section(container);
    const jobsSection = container.querySelector<HTMLElement>('section[data-block-type="jobs"]')!;
    expect(within(element).getAllByRole("button").map(button => button.textContent)).toEqual([expect.stringContaining("Logística y transporte"), expect.stringContaining("Recursos humanos")]);
    expect(within(element).getByRole("button", { name: /Logística y transporte/ })).toHaveTextContent("2 vacantes");
    expect(within(jobsSection).getByText("3 vacantes")).toBeVisible();
    fireEvent.click(within(element).getByRole("button", { name: /Logística y transporte/ }));
    expect(within(element).getByRole("button", { name: /Logística y transporte/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(jobsSection).getByText("2 vacantes")).toBeVisible();
    expect(within(jobsSection).queryByText("Vacante 2")).toBeNull();
    expect(scroll).toHaveBeenCalled();
    fireEvent.click(within(jobsSection).getByRole("button", { name: "Quitar filtro Área: Logística y transporte" }));
    expect(within(jobsSection).getByText("3 vacantes")).toBeVisible();
    expect(within(element).getByRole("button", { name: /Logística y transporte/ })).toHaveAttribute("aria-pressed", "false");
  });
  it("without an areas section the vacancy list shows no area chip (legacy pages unchanged)", () => {
    const container = draw(site(), [job(1, { professional_area: "logistics_transport" })]);
    expect(container.querySelector("[data-area-chips]")).toBeNull();
  });
});

describe("editor preview with v2 blocks", () => {
  it.each(["team", "logos", "areas", "talent_cta"] as const)("%s is selectable, labelled and shows its empty state", type => {
    const container = draw(site(block(type)), [], true);
    const element = section(container);
    expect(element).toHaveAttribute("data-editor-selected", "true");
    expect(within(element).getByText(BLOCK_LIBRARY_V2[type].label)).toBeVisible();
    expect(element.textContent).toContain("todavía no tiene contenido");
  });
  it("navigation lists new sections without crashing", () => {
    const container = draw(site(block("team", { content: { title: "Equipo", items: [{ name: "Ana", role: null, photo: null, consent: true }] } })));
    expect(container.querySelector(`a[href="#bloque-${id(1)}"]`)).not.toBeNull();
  });
});

it("the public page decodes and renders a v2 document", async () => {
  const data = publishedFixture();
  const document = site(block("talent_cta", { variant: "banner", content: { title: "Únete a la base de talento" }, style: { background: "brand" } }));
  const { container } = render(await CompanySitePage({ data: { ...data, site: document }, jobs: [] }));
  expect(section(container)).toHaveAttribute("data-site-surface", "brand");
});

describe("visual polish against 02/03 (T4 browser check)", () => {
  const team = (title = "Quienes lideran") => block("team", { content: { title, items: [{ name: "Mariana López", role: "Directora", photo: null, consent: true }] } });
  it("v2 section titles use the bold display weight; the eyebrow drops the slash alternative", () => {
    let element = section(draw(site(team())));
    const heading = within(element).getByRole("heading", { level: 2, name: "Quienes lideran" });
    expect(heading).toHaveClass("font-semibold");
    expect(heading).not.toHaveClass("font-medium");
    expect(within(element).getByText("Equipo")).toBeVisible();
    expect(within(element).queryByText(/Equipo \/ Líderes/)).toBeNull();
    cleanup();
    element = section(draw(site(block("logos", { content: { title: "Empresas que confían", items: [{ name: "Sierra", image, caption: null }] } }))));
    expect(within(element).getByText("Logos")).toBeVisible();
  });
  it("«Banda de marca»: eyebrow, centred headline and the figures centred in one row", () => {
    const element = section(draw(site(block("stats", { variant: "brand_band", content: { items: [{ value: "+15", label: "años" }, { value: "300+", label: "colaboradores" }] } }))));
    const heading = within(element).getByRole("heading", { level: 2 });
    expect(heading).toHaveTextContent(`${publishedFixture().company.name} en cifras`);
    expect(heading.parentElement).toHaveClass("mx-auto", "items-center", "text-center");
    expect(within(element).getByText("Cifras")).toBeVisible();
    expect(element.querySelector("dl")).toHaveClass("flex", "flex-wrap", "justify-center", "text-center");
  });
  it("«Íconos grandes» centres cards, icons and text without leaving an empty column", () => {
    const element = section(draw(site(block("benefits", { variant: "big_icons", content: { items: benefits(2) } }))));
    const list = element.querySelector('[data-layout="benefits-big_icons"] ul')!;
    expect(list).toHaveClass("flex", "flex-wrap", "justify-center");
    expect(list).not.toHaveClass("lg:grid-cols-3");
    for (const card of element.querySelectorAll('[data-slot="card"]')) expect(card).toHaveClass("text-center");
    for (const icon of element.querySelectorAll('[data-slot="card-header"] > span[aria-hidden]')) expect(icon).toHaveClass("mx-auto");
    expect(within(element).getByRole("heading", { level: 2 }).parentElement).toHaveClass("mx-auto", "text-center");
  });
  it("empty photos use a light branded placeholder (icon or initials), and the editor asks for a photo", () => {
    const jobs = [job(1, { professional_area: "logistics_transport" }), job(2, { professional_area: "human_resources" })];
    const areas = block("areas", { variant: "photo_cards", content: { title: "Encuentra tu lugar", overrides: [{ key: "human_resources", icon: null, photo: image }] } });
    let element = section(draw(site(areas), jobs));
    const empty = within(element).getByRole("button", { name: /Logística y transporte/ });
    expect(empty).not.toHaveAttribute("data-site-surface");
    expect(empty.querySelector("[data-photo-placeholder]")).not.toBeNull();
    expect(empty.className).not.toContain("heroGradient");
    expect(within(element).getByRole("button", { name: /Recursos humanos/ })).toHaveAttribute("data-site-surface", "scrim");
    expect(within(element).queryByText("Agrega una foto")).toBeNull();
    cleanup();
    const testimonial = block("testimonials", { variant: "carousel", content: { items: [{ quote: "Aquí crecí", name: "Laura Méndez", role: null, photo: null, consent: true, video_url: null }] } });
    element = section(draw(site(testimonial)));
    const placeholder = element.querySelector("[data-photo-placeholder]")!;
    expect(placeholder).toHaveTextContent("LM");
    cleanup();
    element = section(draw(site(testimonial), [job(1)], true));
    expect(within(element).getByText("Agrega una foto")).toBeVisible();
  });
  it("the bento lead tile is brand-tinted with its icon, never a blank band", () => {
    const element = section(draw(site(block("values", { variant: "bento", content: { items: benefits(3) } }))));
    const lead = element.querySelector("[data-bento-lead]")!;
    expect(lead).not.toBeNull();
    expect(lead.className).not.toContain("bg-(--site-band)");
    expect(lead.querySelector("[data-bento-watermark]")).toHaveAttribute("aria-hidden", "true");
  });
});
