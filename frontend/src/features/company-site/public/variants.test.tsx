import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CompanySitePage } from "./company-site-page";
import { publishedFixture, mediaId } from "./fixtures.test-support";
import { blockSchema, ICONS, type BlockType } from "../model";
import { defaultBlock } from "../defaults";
import { vacancyDetail, listItem } from "@/features/jobs/api/public-fixtures";
vi.mock("next/font/google", () => ({ Fraunces: () => ({ variable: "__variable_fraunces" }), Plus_Jakarta_Sans: () => ({ variable: "__variable_jakarta" }) }));
vi.mock("@/features/geo/client", () => ({ getCountries: async () => ({ ok: true, data: { items: [] } }), getStates: async () => ({ ok: true, data: { items: [] } }), getMunicipalities: async () => ({ ok: true, data: { items: [] } }) }));
afterEach(cleanup);
const image = { media_id: mediaId };
const content: Record<BlockType, unknown> = {
  hero: { title: "Nuestro siguiente capítulo", subtitle: "Creamos juntos", cover: image },
  story: { title: "Nuestra historia", body: vacancyDetail.description, image },
  values: { mission: "Hacemos equipo", items: [{ icon: "rocket", title: "Curiosidad", description: "Exploramos juntos" }] },
  benefits: { items: [{ icon: "coffee", title: "Café compartido", description: "Tiempo para conectar" }] },
  stats: { items: [{ value: "Monterrey", label: "Nuestra casa" }] },
  process: { items: [{ title: "Conversación", description: "Conócenos", duration: "30 minutos" }] },
  gallery: { items: [{ image, alt: "Equipo conversando", caption: "Primera foto" }, { image, alt: "Oficina luminosa", caption: "Segunda foto" }] },
  testimonials: { items: [{ quote: "Mis ideas importan", name: "Ana", role: "Diseño", photo: image, consent: true }] },
  video: { video: { provider: "youtube", video_id: "dQw4w9WgXcQ" }, title: "Conoce el equipo", description: "Así trabajamos" },
  offices: { items: [{ name: "Oficina central", address: "Calle Real", location: null, map_url: null }] },
  jobs: { title: "Oportunidades", intro: "Encuentra tu lugar" },
  faq: { items: [{ question: "¿Cómo empiezo?", answer: "Abre una vacante" }] },
  closing: { title: "Construyamos juntos", text: "Te esperamos" },
};
const variants: Record<BlockType, string[]> = { hero: ["photo", "split", "centered"], story: ["text", "text_image"], values: ["grid", "list"], benefits: ["grid", "compact"], stats: ["row", "cards"], process: ["steps", "timeline"], gallery: ["grid", "mosaic", "carousel"], testimonials: ["cards", "quote"], video: ["wide", "split"], offices: ["list", "cards"], jobs: ["list", "cards", "by_area"], faq: ["accordion", "two_columns"], closing: ["banner", "simple"] };
const expected: Record<BlockType, string> = { hero: "Nuestro siguiente capítulo", story: "Construye servicios seguros.", values: "Curiosidad", benefits: "Café compartido", stats: "Monterrey", process: "Conversación", gallery: "Primera foto", testimonials: "Mis ideas importan", video: "Así trabajamos", offices: "Oficina central", jobs: vacancyDetail.title, faq: "¿Cómo empiezo?", closing: "Te esperamos" };
it.each(Object.entries(variants).flatMap(([type, names]) => names.map(variant => [type as BlockType, variant] as const)))("%s / %s renders content with variant-specific composition", async (type, variant) => {
  const data = publishedFixture();
  const block = blockSchema.parse({ ...defaultBlock(type), variant, content: content[type] });
  data.site.blocks = data.site.blocks.filter(b => b.type !== type).concat(block);
  const { container } = render(await CompanySitePage({ data, jobs: [listItem(vacancyDetail)] }));
  const section = container.querySelector(`section[data-block-type="${type}"]`)!;
  expect(section).toHaveAttribute("data-variant", variant);
  expect(within(section as HTMLElement).getAllByText(expected[type], { exact: false }).length).toBeGreaterThan(0);
  const layout = section.querySelector(`[data-layout="${type}-${variant}"]`)!;
  expect(layout).not.toBeNull();
  if (type === "hero") {
    expect(section.querySelectorAll("img")).toHaveLength(variant === "centered" ? 0 : 1);
    expect(layout.classList.contains("lg:grid-cols-2")).toBe(variant === "split");
  }
  if (type === "story") expect(section.querySelectorAll("img")).toHaveLength(variant === "text_image" ? 1 : 0);
  if (type === "values" || type === "benefits") expect(section.querySelector('[data-slot="card"]') !== null).toBe(variant === "grid");
  if (type === "stats") expect(section.querySelector('[data-slot="card"]') !== null).toBe(variant === "cards");
  if (type === "offices") expect(section.querySelector('[data-slot="item"]') !== null).toBe(variant === "list");
  if (type === "faq") expect(section.querySelector('[data-slot="accordion"]') !== null).toBe(variant === "accordion");
  if (type === "closing") expect(section.querySelector('[data-brand-banner]') !== null).toBe(variant === "banner");
  if (type === "video") expect(layout.classList.contains("lg:grid-cols-[.7fr_1.3fr]")).toBe(variant === "split");
  if (type === "jobs") {
    expect(section.querySelector('[data-slot="item"]') !== null).toBe(variant !== "cards");
    expect(within(section as HTMLElement).queryByRole("heading", { name: "Tecnología y sistemas" }) !== null).toBe(variant === "by_area");
  }
  if (type === "gallery") expect(section.querySelector('[aria-roledescription="carrusel"]') !== null).toBe(variant === "carousel");
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
});
it.each(ICONS)("maps each contract icon: %s", async icon => {
  const data = publishedFixture();
  data.site.blocks.push(blockSchema.parse({ ...defaultBlock("values"), content: { mission: null, items: [{ icon, title: "Vale", description: null }] } }));
  const { container } = render(await CompanySitePage({ data, jobs: [] }));
  const svg = container.querySelector(`[data-site-icon="${icon}"]`);
  expect(svg?.tagName.toLowerCase()).toBe("svg");
  expect(svg).toHaveAttribute("aria-hidden", "true");
  // Lucide keeps these exported aliases, but emits the canonical icon class.
  expect(svg).toHaveClass(`lucide-${icon === "home" ? "house" : icon === "smile" ? "face-slightly-smiling" : icon}`);
});
it.each(["classic", "editorial", "modern"] as const)("scopes %s font pair to the site root", async font_pair => {
  const data = publishedFixture(); data.site.theme.font_pair = font_pair;
  const { container } = render(await CompanySitePage({ data, jobs: [] }));
  expect(container.firstElementChild).toHaveAttribute("data-font-pair", font_pair);
  expect(container.firstElementChild).toHaveClass("__variable_fraunces", "__variable_jakarta");
});
it("renders socials in closing and footer and omits incomplete optional blocks", async () => {
  const data = publishedFixture(); data.company.linkedin_url = "https://linkedin.com/company/nexo";
  data.site.blocks.push(blockSchema.parse({ ...defaultBlock("closing"), content: content.closing }), defaultBlock("gallery"), defaultBlock("video"));
  const { container } = render(await CompanySitePage({ data, jobs: [] }));
  expect(within(container.querySelector('[data-block-type="closing"]')! as HTMLElement).getByRole("link", { name: "LinkedIn" })).toBeVisible();
  expect(within(container.querySelector("footer")!).getByRole("link", { name: "LinkedIn" })).toBeVisible();
  expect(container.querySelector('[data-block-type="gallery"]')).toBeNull();
  expect(container.querySelector('[data-block-type="video"]')).toBeNull();
  expect(screen.getByRole("button", { name: "Abrir navegación de la empresa" })).toHaveAttribute("aria-haspopup", "menu");
});
it("keeps map actions compact without losing the office's accessible name", async () => {
  const data = publishedFixture(); const name = "Nuestra oficina con un nombre muy largo para una pantalla pequeña";
  data.site.blocks.push(blockSchema.parse({ ...defaultBlock("offices"), content: { items: [{ name, location: null, address: null, map_url: "https://example.com/map" }] } }));
  render(await CompanySitePage({ data, jobs: [] }));
  expect(screen.getByRole("link", { name: `Ver mapa de ${name}` })).toHaveTextContent(/^Ver mapa$/);
});
it("keeps navigation links as native anchors, not button-like controls", async () => {
  const data = publishedFixture();
  render(await CompanySitePage({ data, jobs: [] }));
  for (const link of screen.getAllByRole("link")) {
    expect(link).not.toHaveAttribute("type", "button");
    expect(link).not.toHaveAttribute("role", "button");
  }
});
it("carousel supports arrows, Home and End, announces the slide and keeps image alt", async () => {
  const data = publishedFixture(); data.site.blocks.push(blockSchema.parse({ ...defaultBlock("gallery"), variant: "carousel", content: content.gallery }));
  render(await CompanySitePage({ data, jobs: [] }));
  const carousel = screen.getByRole("region", { name: "Fotos de la empresa" });
  expect(within(carousel).getByRole("img", { name: "Equipo conversando" })).toBeVisible();
  fireEvent.keyDown(carousel, { key: "ArrowRight" });
  expect(within(carousel).getByRole("img", { name: "Oficina luminosa" })).toBeVisible();
  expect(within(carousel).getByRole("status")).toHaveTextContent("2 de 2");
  fireEvent.keyDown(carousel, { key: "Home" });
  expect(within(carousel).getByRole("status")).toHaveTextContent("1 de 2");
  fireEvent.keyDown(carousel, { key: "End" });
  expect(within(carousel).getByRole("status")).toHaveTextContent("2 de 2");
  fireEvent.keyDown(carousel, { key: "ArrowLeft" });
  expect(within(carousel).getByRole("status")).toHaveTextContent("1 de 2");
});
