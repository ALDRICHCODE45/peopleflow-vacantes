import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as geo from "@/features/geo/client";
import "@testing-library/jest-dom/vitest";
import { CompanySitePage } from "@/features/company-site/public/company-site-page";
import { VideoPlayer } from "@/features/company-site/public/video-player";
import { CompanyJobs, filterCompanyJobs } from "@/features/company-site/public/company-jobs";
import { publishedFixture, mediaId } from "./fixtures.test-support";
import { defaultBlock, BLOCK_LIBRARY } from "../defaults";
import { blockSchema, type BlockType } from "../model";
import { adjustedBrandColor, readableOn } from "../brand";
import { listItem, vacancyDetail, legacyDetail } from "@/features/jobs/api/public-fixtures";
import { mediaUrl } from "@/features/company-site/public/media";
import type { ReactNode } from "react";
// Same boundary as components/ui/combobox.test.tsx: jsdom cannot position/focus
// the chips popup inside a modal. Keep the real selection controller and items,
// render only its portal shell inline; browser popup/focus review remains manual.
vi.mock("next/font/google", () => ({ Fraunces: () => ({ variable: "__variable_fraunces" }), Plus_Jakarta_Sans: () => ({ variable: "__variable_jakarta" }) }));
vi.mock("@/components/ui/combobox", async importOriginal => {
  const original = await importOriginal<typeof import("@/components/ui/combobox")>();
  return { ...original, ComboboxContent: ({ children }: { children: ReactNode }) => <div>{children}</div> };
});
vi.mock("@/features/geo/client", () => ({ getCountries: async () => ({ ok: true, data: { items: [{ id: "MX", name: "México" }] } }), getStates: async () => ({ ok: true, data: { items: [{ id: "09", name: "Ciudad de México" }] } }), getMunicipalities: async () => ({ ok: true, data: { items: [{ id: "09002", name: "Azcapotzalco" }] } }) }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const jobs = [listItem(vacancyDetail), listItem(legacyDetail)];
it("renders all 13 block contents in order, one H1, visible anchor navigation, profile and footer", async () => {
  const data = publishedFixture();
  const contents: Record<BlockType, unknown> = {
    hero: data.site.blocks[0].content,
    story: { title: "Nuestra historia", body: vacancyDetail.description, image: { media_id: mediaId } },
    values: { mission: "Una misión compartida", items: [{ icon: "heart", title: "Respeto", description: "Escuchamos" }] },
    benefits: { items: [{ icon: "home", title: "Flexibilidad", description: "Elige tu horario" }] },
    stats: { items: [{ value: "42", label: "Personas" }] },
    process: { items: [{ title: "Conversación", description: "Conócenos", duration: "30 minutos" }] },
    gallery: { items: [{ image: { media_id: mediaId }, alt: "Equipo en el taller", caption: "Un día juntos" }] },
    testimonials: { items: [{ quote: "Me escuchan", name: "Ana", role: "Diseñadora", photo: { media_id: mediaId }, consent: true }] },
    video: { video: { provider: "youtube", video_id: "dQw4w9WgXcQ" }, title: "Conoce Nexo", description: "Así trabajamos" },
    offices: { items: [{ name: "Sede central", location: { country: "MX", state: "09", municipality: "09002" }, address: "Calle Uno 42", map_url: "https://example.com/map" }] },
    jobs: { title: "Únete al equipo", intro: "Oportunidades reales" },
    faq: { items: [{ question: "¿Cómo postular?", answer: "Abre la vacante" }] },
    closing: { title: "Hagamos algo bueno", text: "Te esperamos" },
  };
  data.site.blocks = (Object.keys(BLOCK_LIBRARY) as BlockType[]).map(type => blockSchema.parse({ ...defaultBlock(type), content: contents[type] }));
  const hidden = blockSchema.parse({ ...defaultBlock("closing"), hidden: true, content: { title: "SECRETO", text: "No publicar" } });
  data.site.blocks.push(hidden);
  data.company.linkedin_url = "https://linkedin.com/company/nexo";
  const { container } = render(await CompanySitePage({ data, jobs }));
  fireEvent.click(screen.getByRole("button", { name: "¿Cómo postular?" }));
  for (const text of ["Trabaja con Nexo", "Nuestra historia", "Construye servicios seguros.", "Una misión compartida", "Respeto", "Flexibilidad", "42", "Personas", "Conversación", "30 minutos", "Un día juntos", "Me escuchan", "Ana", "Diseñadora", "Así trabajamos", "Sede central", "Calle Uno 42", "Azcapotzalco", "Únete al equipo", "Oportunidades reales", "¿Cómo postular?", "Abre la vacante", "Hagamos algo bueno", "Te esperamos"]) expect(screen.getAllByText(text, { exact: false }).length, text).toBeGreaterThan(0);
  expect(container.querySelector("footer")).toHaveTextContent("Impulsado por PeopleFlow");
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.queryByText("SECRETO")).toBeNull(); expect(screen.queryByText("No publicar")).toBeNull();
  const visible = data.site.blocks.filter(block => !block.hidden);
  expect(Array.from(container.querySelectorAll("section[data-block-type]")).map(section => section.getAttribute("data-block-type"))).toEqual(visible.map(block => block.type));
  const nav = screen.getByRole("navigation", { name: "Secciones de la empresa" });
  expect(within(nav).getAllByRole("link").map(link => link.getAttribute("href"))).toEqual(["story", "gallery", "benefits", "jobs"].map(type => `#bloque-${visible.find(block => block.type === type)!.id}`));
  expect(within(nav).queryByText("Portada")).toBeNull();
  expect(within(nav).queryByText("Cierre")).toBeNull();
  for (const link of within(nav).getAllByRole("link")) expect(container.querySelector(link.getAttribute("href")!)).not.toBeNull();
  expect(within(container.querySelector("footer")!).getByRole("link", { name: "LinkedIn" })).toHaveAttribute("href", data.company.linkedin_url);
  expect(screen.getByAltText("Equipo en el taller")).toHaveAttribute("src", mediaUrl(mediaId));
  expect(container.querySelectorAll('img[src^="/v2/"]')).toHaveLength(0);
  expect(screen.getByRole("link", { name: vacancyDetail.title })).toHaveAttribute("href", `/vacantes/${vacancyDetail.id}`);
});
it("exposes adjusted brand shades and readable text for both backgrounds without changing the saved theme", async () => {
  const data = publishedFixture(); data.site.theme.brand_color = "#FFFF00";
  const { container } = render(await CompanySitePage({ data, jobs: [] }));
  const root = container.firstElementChild as HTMLElement;
  expect(root.dataset.fontPair).toBe("classic");
  for (const [theme, background] of [["light", "#FFFFFF"], ["dark", "#000000"]]) {
    const color = adjustedBrandColor(data.site.theme.brand_color, background).color;
    expect(root.style.getPropertyValue(`--site-brand-${theme}`)).toBe(color);
    expect(root.style.getPropertyValue(`--site-on-brand-${theme}`)).toBe(readableOn(color));
  }
  expect(data.site.theme.brand_color).toBe("#FFFF00");
});
it.each([["youtube", "dQw4w9WgXcQ", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"], ["vimeo", "123456", "https://player.vimeo.com/video/123456"]] as const)("loads %s iframe only after a click", (provider, video_id, url) => {
  const { container } = render(<VideoPlayer video={{ provider, video_id }} title="Nuestro equipo" />);
  expect(container.querySelector("iframe")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Reproducir video: Nuestro equipo" }));
  expect(screen.getByTitle("Nuestro equipo")).toHaveAttribute("src", url);
  expect(screen.getByTitle("Nuestro equipo")).toHaveAttribute("allow");
});
it("keeps the video action compact for long titles on mobile", () => {
  render(<VideoPlayer video={{ provider: "youtube", video_id: "dQw4w9WgXcQ" }} title={"Una historia con un título muy largo ".repeat(2)} />);
  expect(screen.getByRole("button", { name: /Reproducir video:/ })).toHaveTextContent(/^Reproducir video$/);
});
it("jobs render modalidad, ubicación, jornada and publication date", () => {
  render(<CompanyJobs jobs={jobs} />);
  expect(screen.getAllByText("Híbrido").length).toBeGreaterThan(0); expect(screen.getAllByText("Ciudad de México").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Tiempo completo").length).toBeGreaterThan(0); expect(document.querySelectorAll("time[datetime]")).toHaveLength(2);
});
it("search filters locally and clear restores the list with the Empty composition", () => {
  render(<CompanyJobs jobs={jobs} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Buscar por título" }), { target: { value: "frontend" } });
  expect(screen.queryByRole("link", { name: "Backend Go" })).toBeNull(); expect(screen.getByRole("link", { name: "Ingeniera Frontend" })).toBeVisible();
  fireEvent.change(screen.getByRole("textbox", { name: "Buscar por título" }), { target: { value: "inexistente" } });
  expect(screen.getByText("No encontramos vacantes con estos filtros.").closest('[data-slot="empty"]')).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Quitar filtros" })); expect(screen.getByRole("link", { name: "Backend Go" })).toBeVisible();
});
it("modalidad and estado filters combine with title, and missing state does not masquerade as a state", () => {
  expect(filterCompanyJobs(jobs, { search: "back", modes: ["hybrid"], states: ["09"] })).toEqual([jobs[0]]);
  expect(filterCompanyJobs(jobs, { search: "back", modes: ["remote"], states: ["09"] })).toEqual([]);
  expect(filterCompanyJobs(jobs, { search: "", modes: [], states: ["09"] })).toEqual([jobs[0]]);
});
it("office catalog failures omit raw codes while preserving name and address", async () => {
  vi.spyOn(geo, "getCountries").mockResolvedValue({ ok: false, error: "no_response" });
  const data = publishedFixture();
  data.site.blocks.push(blockSchema.parse({ ...defaultBlock("offices"), content: { items: [{ name: "Oficina real", address: "Calle Real", location: { country: "MX", state: "09", municipality: "09002" }, map_url: null }] } }));
  render(await CompanySitePage({ data, jobs: [] }));
  expect(screen.getByText("Oficina real")).toBeVisible(); expect(screen.getByText("Calle Real")).toBeVisible();
  expect(screen.queryByText("MX")).toBeNull(); expect(screen.queryByText("09002")).toBeNull();
});
it("renders remote scope without inventing a physical location", () => {
  const remote = { ...listItem(vacancyDetail), work_mode: "remote" as const, location: null, location_label: null, remote_scope: { kind: "anywhere" as const } };
  render(<CompanyJobs jobs={[remote]} />);
  expect(screen.getByText("Desde cualquier lugar")).toBeVisible(); expect(screen.queryByText("Ciudad de México")).toBeNull();
});
it("filters by modalidad and estado through the real controls without a network read", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("fetch", vi.fn());
  const user = userEvent.setup();
  render(<CompanyJobs jobs={jobs} />);
  await user.click(screen.getByRole("button", { name: "Filtros" }));
  const panel = await screen.findByRole("dialog", { name: "Filtrar vacantes" });
  expect(panel.querySelector('[data-slot="sheet-header"] [data-slot="sheet-title"]')).not.toBeNull();
  expect(within(panel).getByRole("combobox", { name: "Modalidad" })).toBeEnabled();
  expect(within(panel).getByRole("combobox", { name: "Estado" })).toBeEnabled();
  fireEvent.click(within(panel).getByRole("option", { name: "Híbrido" }));
  fireEvent.click(within(panel).getByRole("option", { name: "Ciudad de México" }));
  expect(panel.querySelector('[data-slot="sheet-footer"] [role="status"]')).toHaveTextContent("1 vacante coincide");
  await user.click(within(panel).getByRole("button", { name: "Ver resultados" }));
  expect(await screen.findByRole("link", { name: "Backend Go" })).toBeVisible(); expect(screen.queryByRole("link", { name: "Ingeniera Frontend" })).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
it("jobs show the honest no-vacancies state", () => {
  render(<CompanyJobs jobs={[]} />);
  expect(screen.getByText("Por ahora no hay vacantes abiertas. Vuelve pronto.").closest('[data-slot="empty"]')).not.toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
});
