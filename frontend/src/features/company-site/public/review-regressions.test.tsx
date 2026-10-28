import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import "@testing-library/jest-dom/vitest";
import { CompanySitePage } from "./company-site-page";
import { SiteGallery } from "./site-gallery";
import { visitorAnchors } from "./site-navigation";
import { CompanyJobs } from "./company-jobs";
import { VideoPlayer } from "./video-player";
import { blockSchema } from "../model";
import { defaultBlock } from "../defaults";
import { contrastRatio } from "../brand";
import { SITE_THEME_SURFACES, siteBrandTokens } from "./theme-tokens";
import { publishedFixture, mediaId } from "./fixtures.test-support";
import { listItem, vacancyDetail } from "@/features/jobs/api/public-fixtures";
vi.mock("next/font/google", () => ({ Fraunces: () => ({ variable: "__variable_fraunces" }), Plus_Jakarta_Sans: () => ({ variable: "__variable_jakarta" }) }));
vi.mock("@/features/geo/client", () => ({ getCountries: async () => ({ ok: true, data: { items: [] } }), getStates: async () => ({ ok: true, data: { items: [] } }), getMunicipalities: async () => ({ ok: true, data: { items: [] } }) }));
afterEach(cleanup);
const image = { media_id: mediaId };
function fullSite() {
  const data = publishedFixture();
  for (const type of ["story", "gallery", "benefits", "values", "stats", "faq", "closing"] as const) {
    const content = {
      story: { title: "Historia real", body: vacancyDetail.description, image },
      gallery: { items: [{ image, alt: "Equipo", caption: null }] },
      benefits: { items: [{ icon: "heart", emoji: null, title: "Bienestar", description: null }] },
      values: { mission: null, items: [{ icon: "users", emoji: null, title: "Equipo", description: null }] },
      stats: { items: [{ value: "12", label: "Personas" }] },
      faq: { items: [{ question: "¿Cómo?", answer: "Así" }] },
      closing: { title: "Adelante", text: "Construyamos juntos" },
    }[type];
    data.site.blocks.push(blockSchema.parse({ ...defaultBlock(type), content }));
  }
  return data;
}
it.each(["grid", "mosaic", "carousel"] as const)("%s gallery keeps every proxy src in SSR and hydrated markup", async variant => {
  const secondId = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d95";
  const block = { ...defaultBlock("gallery"), type: "gallery" as const, variant, content: { items: [{ image, alt: "Equipo", caption: null }, { image: { media_id: secondId }, alt: "Oficina", caption: null }] } };
  const ui = <SiteGallery block={block} />;
  const html = renderToString(ui);
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const expected = [mediaId, secondId].map(id => `/media/sitios/${id}`);
  expect([...parsed.querySelectorAll("img")].map(img => img.getAttribute("src"))).toEqual(expected);
  const container = document.createElement("div");
  container.append(...parsed.body.childNodes);
  document.body.append(container);
  const hydrated = render(ui, { hydrate: true, container });
  expect([...hydrated.container.querySelectorAll("img")].map(img => img.getAttribute("src"))).toEqual(expected);
});
it.each([["orange", "#EA580C", "light", "#F7F5FB", "#FFFFFF"], ["orange", "#EA580C", "dark", "#0C0912", "#15121F"], ["green", "#15803D", "light", "#F7F5FB", "#FFFFFF"], ["green", "#15803D", "dark", "#0C0912", "#15121F"]])("%s %s %s brand text passes AA on page, band and cards", async (_name, brand, theme, page, card) => {
  const data = publishedFixture(); data.site.theme.brand_color = brand;
  const { container } = render(await CompanySitePage({ data, jobs: [] }));
  const style = (container.firstElementChild as HTMLElement).style;
  const fill = style.getPropertyValue(`--site-brand-${theme}`);
  const ink = style.getPropertyValue(`--site-brand-text-${theme}`);
  expect(ink).toMatch(/^#[0-9a-f]{6}$/i);
  // Match the authored sRGB 7% tint independently of the production helper.
  const channel = (hex: string, offset: number) => parseInt(hex.slice(offset, offset + 2), 16);
  const band = `#${[1, 3, 5].map(offset => Math.round(channel(fill, offset) * .07 + channel(page, offset) * .93).toString(16).padStart(2, "0")).join("")}`;
  expect(style.getPropertyValue(`--site-band-${theme}`).toUpperCase()).toBe(band.toUpperCase());
  for (const background of [page, band, card]) expect(contrastRatio(ink, background), `${ink} on ${background}`).toBeGreaterThanOrEqual(4.5);
});
it("keeps server contrast surfaces synchronized with the shared palette and covers alternate brands", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const light = css.slice(css.indexOf(":root {"), css.indexOf(".dark {"));
  const dark = css.slice(css.indexOf(".dark {"));
  for (const [theme, source] of [["light", light], ["dark", dark]] as const) {
    expect(source).toContain(`--background: ${SITE_THEME_SURFACES[theme].page};`);
    expect(source).toContain(`--card: ${SITE_THEME_SURFACES[theme].card};`);
    for (const brand of ["#7835DB", "#FFFF00", "#000000", "#FFFFFF"]) {
      const tokens = siteBrandTokens(brand);
      for (const surface of [SITE_THEME_SURFACES[theme].page, SITE_THEME_SURFACES[theme].card, tokens[`--site-band-${theme}`]]) expect(contrastRatio(tokens[`--site-brand-text-${theme}`], surface)).toBeGreaterThanOrEqual(4.5);
    }
  }
});
it("uses the separate text token for eyebrows and brand links, not primary fill", async () => {
  const data = fullSite();
  const { container } = render(await CompanySitePage({ data, jobs: [] }));
  for (const eyebrow of container.querySelectorAll(".tracking-widest.uppercase")) expect(eyebrow).toHaveClass("text-(--site-brand-text)");
  expect(container.querySelector('[data-block-type="stats"] dd')).toHaveClass("text-(--site-brand-text)");
  expect(container.querySelector('footer [data-brand-text-link]')).not.toBeNull();
  const css = readFileSync("src/features/company-site/public/site-theme.module.css", "utf8");
  expect(css).toContain("--site-brand-text: var(--site-brand-text-light)");
  expect(css).toContain("--site-brand-text: var(--site-brand-text-dark)");
  expect(css).toContain("--primary: var(--site-brand-text)");
});
it("gives every navigation landmark a unique name, including repeated closing blocks", async () => {
  const data = fullSite(); data.site.blocks.push(blockSchema.parse({ ...defaultBlock("closing"), content: { title: "Un segundo cierre", text: null } }));
  render(await CompanySitePage({ data, jobs: [] }));
  const navs = screen.getAllByRole("navigation");
  const names = navs.map(nav => nav.getAttribute("aria-label"));
  expect(names.every(Boolean)).toBe(true);
  expect(new Set(names).size).toBe(names.length);
  expect(screen.getByRole("navigation", { name: "Redes de Nexo en el pie" })).toBeVisible();
});
it.each(["banner", "simple"] as const)("%s closing centers the action with its heading and socials", async variant => {
  const data = fullSite(); const closing = data.site.blocks.find(b => b.type === "closing")!;
  if (closing.type === "closing") closing.variant = variant;
  const { container } = render(await CompanySitePage({ data, jobs: [] }));
  const section = container.querySelector('[data-block-type="closing"]')!;
  expect(section.querySelector('[data-slot="card"]')).toHaveClass("text-center");
  expect(section.querySelector('[data-slot="card-content"]')).toHaveClass("items-center", "gap-6");
  const cta = within(section as HTMLElement).getByRole("link", { name: "Ver vacantes" });
  expect(cta).toHaveClass("sm:self-center");
  expect(cta).not.toHaveClass("sm:self-start");
  if (variant === "banner") {
    expect(cta).toHaveAttribute("data-brand-inverse");
    expect(cta).toHaveClass("bg-primary", "text-primary-foreground");
    const css = readFileSync("src/features/company-site/public/site-theme.module.css", "utf8");
    expect(css).toContain("--primary: var(--site-banner-accent)");
    expect(css).toContain("--primary-foreground: var(--site-on-banner-accent)");
    // Null accent keeps the original inverse principal CTA.
    expect(css).toContain("--site-banner-accent-light, var(--site-on-brand)");
    expect(css).toContain("--site-on-banner-accent-light, var(--site-brand)");
  }
});
it("uses downward arrows for in-page actions and outward arrows for external destinations", async () => {
  const data = fullSite();
  const { container } = render(await CompanySitePage({ data, jobs: [listItem(vacancyDetail)] }));
  const actions = [...screen.getAllByRole("link", { name: "Ver vacantes" }), screen.getByRole("link", { name: "Conoce la empresa" })];
  for (const link of actions) {
    expect(link.querySelector(".lucide-arrow-down")).not.toBeNull();
    expect(link.querySelector(".lucide-arrow-up-right")).toBeNull();
  }
  expect(within(container.querySelector("footer")!).getByRole("link", { name: "Sitio web" }).querySelector(".lucide-arrow-up-right")).not.toBeNull();
  expect(screen.getByRole("link", { name: vacancyDetail.title }).querySelector(".lucide-arrow-up-right")).not.toBeNull();
});
it.each(["cards", "list", "by_area"] as const)("%s metadata uses gaps/icons without dangling separator dots", variant => {
  const { container } = render(<CompanyJobs jobs={[listItem(vacancyDetail)]} variant={variant} />);
  const meta = container.querySelector('[data-job-meta]')!;
  expect(meta).not.toHaveTextContent("·");
  expect(meta).toHaveClass("flex-wrap", "gap-x-4");
  expect(meta.querySelectorAll("svg").length).toBeGreaterThan(1);
});
it("keeps search and filters on one row from md with an expanding search field", () => {
  const { container } = render(<CompanyJobs jobs={[listItem(vacancyDetail)]} />);
  const toolbar = container.querySelector('[data-job-controls]')!;
  expect(toolbar).toHaveClass("md:flex-row", "md:items-end");
  expect(toolbar.querySelector('[data-slot="field"]')).toHaveClass("md:flex-1", "min-w-0");
  expect(within(toolbar as HTMLElement).getByRole("button", { name: "Filtros" })).toHaveClass("md:self-end");
});
it("aligns wide video to the heading column and optically centers a 24px play glyph", async () => {
  const data = fullSite(); data.site.blocks.push(blockSchema.parse({ ...defaultBlock("video"), content: { video: { provider: "youtube", video_id: "dQw4w9WgXcQ" }, title: "Equipo", description: null } }));
  const { container } = render(await CompanySitePage({ data, jobs: [] }));
  const column = container.querySelector('[data-video-idle]')!.parentElement!;
  expect(column).toHaveClass("w-full");
  expect(column).not.toHaveClass("mx-auto", "max-w-5xl");
  expect(screen.getByRole("button", { name: "Reproducir video: Equipo" }).querySelector("svg")).toHaveClass("size-6", "translate-x-0.5");
});
it("offsets native social button padding without reducing their hit area", async () => {
  const data = fullSite();
  const { container } = render(await CompanySitePage({ data, jobs: [] }));
  const footer = container.querySelector("footer")!;
  const nav = within(footer).getByRole("navigation", { name: "Redes de Nexo en el pie" });
  expect(nav).toHaveClass("-mx-3");
  expect(within(nav).getByRole("link", { name: "Sitio web" })).toHaveClass("min-h-10", "px-3");
});
it("owns a single main landmark with sibling header/footer and a first skip link", async () => {
  const { container } = render(await CompanySitePage({ data: publishedFixture(), jobs: [] }));
  const main = screen.getByRole("main");
  expect(screen.getAllByRole("main")).toHaveLength(1);
  expect(main).toHaveAttribute("id", "contenido");
  expect(main.querySelector("header, footer")).toBeNull();
  expect(screen.getByRole("banner").parentElement).toBe(main.parentElement);
  expect(screen.getByRole("contentinfo").parentElement).toBe(main.parentElement);
  expect(main.querySelectorAll("section[data-block-type]")).toHaveLength(2);
  const skip = screen.getByRole("link", { name: "Saltar al contenido" });
  expect(skip).toHaveAttribute("href", "#contenido");
  expect(skip).toHaveClass("sr-only", "focus:not-sr-only");
  expect(container.firstElementChild?.firstElementChild).toBe(skip);
});
it("always credits PeopleFlow on the footer's last row, including minimal sites", async () => {
  const { container } = render(await CompanySitePage({ data: publishedFixture(), jobs: [] }));
  const footer = container.querySelector("footer")!;
  expect(footer.lastElementChild).toHaveTextContent("Impulsado por PeopleFlow");
  expect(within(footer).getByRole("link", { name: "PeopleFlow para empresas" })).toHaveAttribute("href", "/");
});
it("curates one-row navigation with three visitor anchors, More and jobs CTA", async () => {
  const data = fullSite();
  render(await CompanySitePage({ data, jobs: [] }));
  const nav = screen.getByRole("navigation", { name: "Secciones de la empresa" });
  const anchors = within(nav).getAllByRole("link");
  expect(anchors.filter(link => link.textContent !== "Ver vacantes")).toHaveLength(3);
  expect(within(nav).queryByText("Portada")).toBeNull();
  expect(within(nav).queryByText("Cierre")).toBeNull();
  expect(within(nav).getByRole("link", { name: "Nosotros" })).toHaveAttribute("href", `#bloque-${data.site.blocks.find(b => b.type === "story")!.id}`);
  expect(within(nav).getByRole("link", { name: "La vida en Nexo" })).toBeVisible();
  expect(within(nav).getByRole("button", { name: "Más" })).toHaveAttribute("aria-haspopup", "menu");
  expect(within(nav).getByRole("link", { name: "Ver vacantes" })).toBeVisible();
  expect(nav.className).not.toContain("flex-wrap");
});
it("uses the same complete visitor set for mobile/overflow and falls back to testimonials for culture", () => {
  const data = fullSite();
  data.site.blocks.find(b => b.type === "gallery")!.hidden = true;
  const testimonials = defaultBlock("testimonials"); data.site.blocks.push(testimonials);
  const model = visitorAnchors(data.site.blocks, data.company.name);
  expect([...model.primary, ...model.remaining]).toEqual(model.all);
  expect(model.all.map(item => item.id)).not.toContain(`bloque-${data.site.blocks.find(b => b.type === "hero")!.id}`);
  expect(model.all.map(item => item.id)).not.toContain(`bloque-${data.site.blocks.find(b => b.type === "closing")!.id}`);
  expect(model.primary.find(item => item.label === "La vida en Nexo")?.id).toBe(`bloque-${testimonials.id}`);
  expect(model.jobs?.id).toBe(`bloque-${data.site.blocks.find(b => b.type === "jobs")!.id}`);
});
it("omits the jobs CTA when the jobs block is hidden", async () => {
  const data = fullSite(); data.site.blocks.find(b => b.type === "jobs")!.hidden = true;
  render(await CompanySitePage({ data, jobs: [] }));
  expect(screen.queryByRole("link", { name: "Ver vacantes" })).toBeNull();
});
it("hero actions are content-sized from sm and link to the visible story", async () => {
  const data = fullSite();
  const { container } = render(await CompanySitePage({ data, jobs: [] }));
  const hero = within(container.querySelector('[data-block-type="hero"]')! as HTMLElement);
  expect(hero.getByRole("link", { name: "Ver vacantes" })).toHaveClass("sm:w-auto");
  expect(hero.getByRole("link", { name: "Conoce la empresa" })).toHaveAttribute("href", `#bloque-${data.site.blocks.find(b => b.type === "story")!.id}`);
  cleanup(); data.site.blocks.find(b => b.type === "story")!.hidden = true;
  render(await CompanySitePage({ data, jobs: [] }));
  expect(screen.queryByRole("link", { name: "Conoce la empresa" })).toBeNull();
});
it("brand surfaces share one readable foreground token, including links, and separate title and subtitle", async () => {
  const css = readFileSync("src/features/company-site/public/site-theme.module.css", "utf8");
  expect(css).toContain("--site-surface-foreground: var(--site-on-brand)");
  for (const token of ["foreground", "card-foreground", "muted-foreground", "primary-foreground"]) expect(css).toContain(`--${token}: var(--site-surface-foreground)`);
  const data = fullSite(); data.company.linkedin_url = "https://example.com/linkedin";
  const { container } = render(await CompanySitePage({ data, jobs: [] }));
  const banner = container.querySelector('[data-brand-banner]')!;
  expect(banner.querySelector('[data-slot="card-header"]')).toHaveClass("gap-4");
  expect(within(banner as HTMLElement).getByRole("link", { name: "LinkedIn" })).not.toHaveClass("text-primary");
});
it.each(["youtube", "vimeo"] as const)("%s idle video is an intentional tinted play surface", provider => {
  const { container } = render(<VideoPlayer video={{ provider, video_id: provider === "youtube" ? "dQw4w9WgXcQ" : "12345" }} title="Nuestro equipo" />);
  expect(container.querySelector('[data-video-idle]')).toHaveClass("aspect-video", "bg-(--site-band)");
  expect(screen.getByRole("button", { name: "Reproducir video: Nuestro equipo" })).toHaveClass("rounded-full", "size-16");
  expect(screen.getByText(`${provider === "youtube" ? "YouTube" : "Vimeo"} · se carga al reproducir`)).toBeVisible();
  expect(container.querySelector("iframe")).toBeNull();
  fireEvent.click(screen.getByRole("button")); expect(screen.getByTitle("Nuestro equipo")).toBeVisible();
});
it.each(["cards", "list", "by_area"] as const)("%s jobs have one whole-surface link and compact accessible facts", variant => {
  const job = listItem(vacancyDetail);
  const { container } = render(<CompanyJobs jobs={[job]} variant={variant} />);
  const link = screen.getByRole("link", { name: job.title });
  expect(within(link).getByRole("heading", { name: job.title })).toBeVisible();
  expect(link).toHaveClass("group/job", "focus-visible:ring-2");
  expect(link.querySelector('[data-job-meta]')).not.toBeNull();
  expect(link.querySelector("dl")).toBeNull();
  expect(link.querySelector("time")).toHaveTextContent(/^Publicada el /);
  expect(container.querySelector('a a')).toBeNull();
  expect(link.querySelector('[data-job-arrow]')).not.toBeNull();
  if (variant === "cards") expect(link.querySelector('[data-slot="card"]')).toHaveClass("h-full");
  else expect(link.querySelector('[data-slot="item"]')).toHaveAttribute("data-variant", "default");
});
