import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { CompanySitePresentation } from "./company-site-presentation";
import { publishedFixture } from "./fixtures.test-support";
import { BLOCK_LIBRARY_V2, defaultBlockV2 } from "../defaults";
import { blockSchemaV2, type BlockTypeV2, type SiteBlockV2 } from "../model";
vi.mock("next/font/google", () => ({ Fraunces: () => ({ variable: "editorial" }), Plus_Jakarta_Sans: () => ({ variable: "modern" }) }));
afterEach(cleanup);

const variants = (type: BlockTypeV2) => blockSchemaV2.options.find(option => option.shape.type.value === type)!.shape.variant.options as readonly string[];
function block<T extends BlockTypeV2>(type: T, variant: string, content: Record<string, unknown>): SiteBlockV2 {
  const base = defaultBlockV2(type);
  return { ...base, variant, content: { ...base.content, ...content } } as SiteBlockV2;
}
function draw(target: SiteBlockV2, editor: { select?: () => void; complete?: () => void } | null = { select: vi.fn(), complete: vi.fn() }) {
  const data = publishedFixture();
  const site = { ...data.site, blocks: [...data.site.blocks.slice(0, 1), target, ...data.site.blocks.slice(1)] } as typeof data.site;
  const props = { site, company: data.company, jobs: [], officeLabels: new Map<string, string>() };
  const view = editor ? render(<CompanySitePresentation {...props} selectedBlockId={target.id} onSelectBlock={editor.select} onCompleteBlock={editor.complete} />) : render(<CompanySitePresentation {...props} />);
  return { ...view, section: view.container.querySelector<HTMLElement>(`#bloque-${target.id}`) };
}

/** What the person typed (title, intro, text…) without the items/media the section needs. */
const PARTIAL: { type: BlockTypeV2; content: Record<string, unknown>; typed: string[]; placeholder: RegExp | null }[] = [
  { type: "story", content: { title: "Así empezamos" }, typed: ["Así empezamos"], placeholder: /Escribe tu historia para mostrarla aquí/ },
  { type: "values", content: { mission: "Hacer fácil lo difícil" }, typed: ["Hacer fácil lo difícil"], placeholder: /Agrega valores para mostrarlos aquí/ },
  { type: "benefits", content: { items: [{ icon: "gift", emoji: null, title: null, description: "Cada viernes" }] }, typed: ["Beneficios"], placeholder: /Escribe el título de cada beneficio/ },
  { type: "stats", content: { items: [{ value: "120+", label: null }] }, typed: ["Cifras"], placeholder: /Escribe el valor y la etiqueta/ },
  { type: "process", content: { items: [{ title: null, description: "Una llamada corta", duration: null }] }, typed: ["Proceso de selección"], placeholder: /Escribe el título de cada paso/ },
  { type: "gallery", content: { items: [{ image: null, alt: "Equipo en la oficina", caption: null }] }, typed: ["Galería de cultura"], placeholder: /Sube la foto y escribe su texto alternativo/ },
  { type: "testimonials", content: { items: [{ quote: "Aquí crecí", name: "Ana", role: null, photo: null, consent: false, video_url: null }] }, typed: ["Testimonios"], placeholder: /permiso/ },
  { type: "video", content: { title: "Conócenos", description: "Un día con el equipo" }, typed: ["Conócenos", "Un día con el equipo"], placeholder: /Pega el enlace de YouTube o Vimeo/ },
  { type: "offices", content: { items: [{ name: null, location: null, address: "Av. Reforma 1", map_url: null }] }, typed: ["Oficinas"], placeholder: /Escribe el nombre de cada oficina/ },
  { type: "faq", content: { items: [{ question: "¿Hay home office?", answer: null }] }, typed: ["Preguntas frecuentes"], placeholder: /Escribe la pregunta y su respuesta/ },
  { type: "closing", content: { text: "Te esperamos" }, typed: ["Te esperamos"], placeholder: /Escribe un título para mostrar esta sección/ },
  { type: "team", content: { title: "Este titulo de la seccion.", intro: "Esta es la intruduccion de la seccion." }, typed: ["Este titulo de la seccion.", "Esta es la intruduccion de la seccion."], placeholder: /Agrega personas para mostrarlas aquí/ },
  { type: "logos", content: { title: "Reconocimientos" }, typed: ["Reconocimientos"], placeholder: /Agrega logos para mostrarlos aquí/ },
  { type: "areas", content: { title: "Encuentra tu lugar", intro: "Explora por área" }, typed: ["Encuentra tu lugar", "Explora por área"], placeholder: /Las áreas aparecen aquí cuando tengas vacantes publicadas/ },
  { type: "talent_cta", content: { text: "Déjanos tu CV" }, typed: ["Déjanos tu CV"], placeholder: /Escribe un título para mostrar esta sección/ },
];

describe("editor preview: partial sections render what was typed (L11)", () => {
  it.each(PARTIAL.flatMap(row => variants(row.type).map(variant => ({ ...row, variant }))))("$type/$variant shows its heading and text plus an editor-only slot", ({ type, variant, content, typed, placeholder }) => {
    const target = block(type, variant, content);
    const { section } = draw(target);
    expect(section).not.toBeNull();
    expect(section!.textContent).not.toContain("todavía no tiene contenido");
    for (const text of typed) expect(within(section!).getAllByText(text)[0]).toBeVisible();
    // The section is still named by a real element.
    expect(section!.ownerDocument.getElementById(section!.getAttribute("aria-labelledby")!)).not.toBeNull();
    const slot = section!.querySelector<HTMLElement>("[data-editor-placeholder]");
    expect(slot).not.toBeNull();
    expect(slot!.textContent).toMatch(placeholder!);
  });
  it.each(PARTIAL)("$type: the public page keeps omitting the incomplete section", ({ type, content }) => {
    const target = block(type, variants(type)[0], content);
    const { section, container } = draw(target, null);
    expect(section).toBeNull();
    expect(container.querySelector("[data-editor-placeholder]")).toBeNull();
    expect(screen.queryByRole("button", { name: "Completar sección" })).toBeNull();
  });
  it("the reported case: team title and intro show as on the public page, never interpolated into a sentence", () => {
    const target = block("team", "grid", { title: "Este titulo de la seccion.", intro: "Esta es la intruduccion de la seccion." });
    const { section } = draw(target);
    expect(within(section!).getByRole("heading", { level: 2, name: "Este titulo de la seccion." })).toBeVisible();
    expect(within(section!).getByText("Esta es la intruduccion de la seccion.")).toBeVisible();
    expect(screen.queryByText(/Este titulo de la seccion\. todavía/)).toBeNull();
  });
  it("a hero without its title shows a slot where the title goes (every layout)", () => {
    for (const variant of variants("hero")) {
      const target = block("hero", variant, { title: null });
      const data = publishedFixture();
      const site = { ...data.site, blocks: [target, ...data.site.blocks.slice(1)] } as typeof data.site;
      const { container, unmount } = render(<CompanySitePresentation site={site} company={data.company} jobs={[]} officeLabels={new Map()} onSelectBlock={vi.fn()} onCompleteBlock={vi.fn()} />);
      const section = container.querySelector<HTMLElement>(`#bloque-${target.id}`)!;
      expect(within(section).queryByRole("heading", { level: 1 })).toBeNull();
      expect(section.querySelector("[data-editor-placeholder]")?.textContent).toMatch(/Escribe el título principal de tu portada/);
      expect(document.getElementById(section.getAttribute("aria-labelledby")!)).not.toBeNull();
      unmount();
    }
  });
});

describe("«Completar sección» (L11)", () => {
  it("an untouched section keeps the generic card, named by the section type", () => {
    const target = defaultBlockV2("team");
    const { section } = draw(target);
    expect(within(section!).getByRole("heading", { level: 3, name: `${BLOCK_LIBRARY_V2.team.label} todavía no tiene contenido` })).toBeVisible();
  });
  it("the blank card's button asks the editor to complete the section, with the mouse and the keyboard", async () => {
    const select = vi.fn(); const complete = vi.fn();
    const target = defaultBlockV2("logos");
    const { section } = draw(target, { select, complete });
    const button = within(section!).getByRole("button", { name: "Completar sección" });
    fireEvent.click(button);
    expect(complete).toHaveBeenCalledExactlyOnceWith(target.id);
    button.focus();
    await userEvent.setup().keyboard("{Enter}");
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete).toHaveBeenLastCalledWith(target.id);
  });
  it("the partial slot's button asks to complete the section too; the areas slot only informs", () => {
    const complete = vi.fn();
    const team = block("team", "grid", { title: "Líderes" });
    const { section, unmount } = draw(team, { select: vi.fn(), complete });
    fireEvent.click(within(section!).getByRole("button", { name: "Completar sección" }));
    expect(complete).toHaveBeenCalledExactlyOnceWith(team.id);
    unmount();
    const areas = block("areas", "icon_cards", { title: "Encuentra tu lugar" });
    expect(within(draw(areas).section!).queryByRole("button", { name: "Completar sección" })).toBeNull();
  });
  it("without onCompleteBlock the button still selects the section (exactly once)", () => {
    const select = vi.fn(); const target = defaultBlockV2("team");
    const { section } = draw(target, { select });
    fireEvent.click(within(section!).getByRole("button", { name: "Completar sección" }));
    expect(select).toHaveBeenCalledExactlyOnceWith(target.id);
  });
});

describe("controls inside the preview work and select their section (L11 audit)", () => {
  it("carousel arrows move the testimonial and select the section", () => {
    const select = vi.fn();
    const items = ["Ana", "Luis"].map(name => ({ quote: `Cita de ${name}`, name, role: null, photo: null, consent: true, video_url: null }));
    const target = block("testimonials", "carousel", { items });
    const { section } = draw(target, { select, complete: vi.fn() });
    fireEvent.click(within(section!).getByRole("button", { name: "Testimonio siguiente" }));
    expect(within(section!).getByRole("status")).toHaveTextContent("2 de 2");
    expect(select).toHaveBeenCalledWith(target.id);
  });
  it("FAQ accordion triggers open in the preview", () => {
    const target = block("faq", "accordion", { items: [{ question: "¿Hay home office?", answer: "Sí, tres días." }] });
    const { section } = draw(target);
    const trigger = within(section!).getByRole("button", { name: "¿Hay home office?" });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });
  it("a click on plain content still only selects (links never navigate)", () => {
    const select = vi.fn();
    const target = block("team", "grid", { title: "Líderes", items: [{ name: "Ana", role: null, photo: null, consent: true }] });
    const { section } = draw(target, { select, complete: vi.fn() });
    fireEvent.click(within(section!).getByText("Ana"));
    expect(select).toHaveBeenCalledExactlyOnceWith(target.id);
  });
});
