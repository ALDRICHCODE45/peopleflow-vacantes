import "./browser-platform.test-support";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ComponentProps, ReactNode } from "react";
// Sections v2 on for this whole file (model.ts and the editor read the same switch).
vi.mock("../sections-v2", () => ({ SECTIONS_V2_ENABLED: true, TALENT_CTA_ENABLED: false }));
vi.mock("next/font/google", () => ({ Fraunces: () => ({ variable: "editorial" }), Plus_Jakarta_Sans: () => ({ variable: "modern" }) }));
vi.mock("../api/actions", () => ({ saveDraftAction: vi.fn(), slugAvailabilityAction: vi.fn().mockResolvedValue({ kind: "uncertain" }), publishSiteAction: vi.fn(), unpublishSiteAction: vi.fn() }));
vi.mock("@/components/ui/dropdown-menu", async original => {
  const parts = await original<typeof import("@/components/ui/dropdown-menu")>();
  return { ...parts, DropdownMenuContent: ({ children }: { children: ReactNode }) => <parts.DropdownMenuGroup>{children}</parts.DropdownMenuGroup> };
});
// jsdom cannot model Base UI Select's portal/focus; keep labels, values and changes (as in manual intake).
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const Context = React.createContext({ value: "", items: [] as { value: string; label: string }[], change: (value: string) => { void value; } });
  return {
    Select: ({ value, items, onValueChange, children }: { value: string; items: { value: string; label: string }[]; onValueChange: (value: string) => void; children: ReactNode }) => <Context.Provider value={{ value, items, change: onValueChange }}>{children}</Context.Provider>,
    SelectTrigger: (props: ComponentProps<"select">) => { const state = React.useContext(Context); return <select {...props} value={state.value ?? ""} onChange={event => state.change(event.target.value)}>{(state.items ?? []).map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>; },
    SelectValue: () => null, SelectContent: () => null, SelectGroup: () => null, SelectItem: () => null,
  };
});
vi.mock("./media", () => ({ ImageField: ({ label }: { label: string }) => <p data-image-field="">{label}</p> }));
import { CareersSiteEditor } from "./index";
import { publishedFixture } from "../public/fixtures.test-support";
import { defaultBlockV2 } from "../defaults";
import type { SiteState } from "../api/model";
import { saveDraftAction } from "../api/actions";
import { createAutosave } from "../autosave";
import { addBlockAction, createEditorState, editorReducer } from "../editor-state";
import { PROPERTY_GROUPS_KEY } from "./property-groups";
import { EDITOR_LAYOUT_KEY } from "./editor-layout";
import { v2Draft } from "./site-state.test-support";
import { offeredVariants } from "./variant-picker";

function fixture(extra: ReturnType<typeof defaultBlockV2>[] = []) {
  const data = publishedFixture();
  const draft = v2Draft({ ...data.site, slug: data.slug });
  draft.blocks.splice(draft.blocks.length - 1, 0, ...extra);
  const initialSite: SiteState = { draft, draft_version: 7, published: null, has_unpublished_changes: false, media: data.media, updated_at: data.published_at };
  return { initialSite, role: "owner", preview: { company: data.company, jobs: [], officeLabels: new Map<string, string>() } };
}
async function mount(extra: ReturnType<typeof defaultBlockV2>[] = []) {
  const props = fixture(extra); render(<CareersSiteEditor {...props} />);
  await screen.findByRole("heading", { name: "Tu página" });
  return props;
}
const list = () => screen.getByRole("list", { name: "Secciones del sitio" });
const select = (name: string) => fireEvent.click(within(list()).getByRole("button", { name: `Seleccionar ${name}` }));
const properties = () => screen.getByRole("complementary", { name: "Propiedades de la sección" });
const frameDocument = () => (screen.getByTitle("Vista previa del sitio") as HTMLIFrameElement).contentDocument!;
const draft = (): SiteState["draft"] => vi.mocked(saveDraftAction).mock.calls.at(-1)?.[0].body as SiteState["draft"];
async function saved() { await act(() => vi.advanceTimersByTimeAsync(1500)); return draft(); }

beforeEach(() => {
  localStorage.clear();
  document.documentElement.style.fontSize = "16px";
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) { return this.hasAttribute("data-panel") ? 400 : 0; });
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.mocked(saveDraftAction).mockImplementation(async ({ body }) => ({ kind: "success", data: { ...fixture().initialSite, draft: body as SiteState["draft"], draft_version: 8 }, etag: '"8"' }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("reducer and history with sections v2 on", () => {
  const state = () => createEditorState(fixture().initialSite, '"7"');
  it("sets a curated style: an image background starts at a medium veil, leaving it drops veil and image", () => {
    let current = state(); const jobs = current.draft.blocks.find(block => block.type === "jobs")!;
    current = editorReducer(current, { type: "style", id: jobs.id, style: { ...jobs.style, background: "image" } });
    expect(current.draft.blocks.find(block => block.id === jobs.id)!.style).toEqual({ background: "image", spacing: "airy", align: "start", overlay: "medium", image: null });
    current = editorReducer(current, { type: "style", id: jobs.id, style: { background: "image", spacing: "compact", align: "center", overlay: "strong", image: { media_id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d94" } } });
    current = editorReducer(current, { type: "style", id: jobs.id, style: { ...current.draft.blocks.find(block => block.id === jobs.id)!.style, background: "brand" } });
    expect(current.draft.blocks.find(block => block.id === jobs.id)!.style).toEqual({ background: "brand", spacing: "compact", align: "center", overlay: null, image: null });
    expect(editorReducer(current, { type: "style", id: jobs.id, style: { ...jobs.style, background: "video" as never } })).toBe(current);
  });
  it("makes every style change its own undo step", () => {
    const controller = createAutosave(fixture().initialSite, '"7"', vi.fn());
    const jobs = controller.getSnapshot().editor.draft.blocks.find(block => block.type === "jobs")!;
    controller.dispatch({ type: "style", id: jobs.id, style: { ...jobs.style, spacing: "compact" } });
    controller.dispatch({ type: "style", id: jobs.id, style: { ...jobs.style, spacing: "compact", align: "center" } });
    const style = () => controller.getSnapshot().editor.draft.blocks.find(block => block.id === jobs.id)!.style;
    expect(style()).toMatchObject({ spacing: "compact", align: "center" });
    expect(controller.undo()).toEqual({ blockId: jobs.id, area: "sections" });
    expect(style()).toMatchObject({ spacing: "compact", align: "start" });
    controller.undo(); expect(style()).toMatchObject({ spacing: "airy", align: "start" });
    controller.redo(); expect(style()).toMatchObject({ spacing: "compact" });
    controller.dispose();
  });
  it("accepts slice A layouts and inserts a chosen layout at the chosen index", () => {
    let current = state(); const benefits = defaultBlockV2("benefits");
    current = editorReducer(current, { type: "add", block: benefits, index: 1 });
    expect(current.draft.blocks[1].id).toBe(benefits.id);
    current = editorReducer(current, { type: "variant", id: benefits.id, variant: "bento" });
    expect(current.draft.blocks[1].variant).toBe("bento");
    const action = addBlockAction("areas", { variant: "photo_cards", index: 0 });
    current = editorReducer(current, action);
    // Index 0 is above Portada: it lands right after it instead.
    expect(current.draft.blocks[1]).toMatchObject({ type: "areas", variant: "photo_cards" });
  });
  it("clears the Portada secondary target when that section is deleted, in the same undo step", () => {
    const story = defaultBlockV2("story");
    const site = fixture([story]).initialSite;
    const hero = site.draft.blocks[0]; if (hero.type !== "hero") throw new Error("fixture");
    hero.content.secondary_target = story.id;
    const controller = createAutosave(site, '"7"', vi.fn());
    const target = () => { const block = controller.getSnapshot().editor.draft.blocks[0]; return block.type === "hero" ? block.content.secondary_target : "not a hero"; };
    controller.dispatch({ type: "delete", id: story.id });
    expect(target()).toBeNull();
    controller.undo();
    expect(target()).toBe(story.id);
    expect(controller.getSnapshot().editor.draft.blocks.some(block => block.id === story.id)).toBe(true);
    controller.dispose();
  });
  it("never offers the background video layout (slice B), but keeps showing it when it is current", () => {
    expect(offeredVariants("hero")).toEqual(["photo", "split", "centered", "photo_jobs", "collage"]);
    expect(offeredVariants("hero", "background_loop")).toContain("background_loop");
  });
});

describe("visual section library", () => {
  it("docks beside the live preview, folding the side panes until it closes", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Agregar sección" }));
    const library = screen.getByRole("region", { name: "Agregar sección" });
    expect(screen.queryByRole("dialog", { name: "Agregar sección" })).toBeNull();
    expect(document.getElementById("editor-sections")).not.toBeVisible();
    expect(document.getElementById("editor-properties")).not.toBeVisible();
    expect(screen.getByLabelText("Mostrar secciones")).toBeDisabled();
    expect(localStorage.getItem(EDITOR_LAYOUT_KEY)).toBeNull();
    fireEvent.keyDown(within(library).getByPlaceholderText("Buscar una sección"), { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Agregar sección" })).toBeNull();
    expect(document.getElementById("editor-sections")).toBeVisible();
    expect(localStorage.getItem(EDITOR_LAYOUT_KEY)).toBeNull();
  });
  it("filters by category and search; protected sections are disabled with the reason; talent call isn't offered yet", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Agregar sección" }));
    const library = screen.getByRole("region", { name: "Agregar sección" });
    const types = () => Array.from(library.querySelectorAll("[data-library-type]"), node => node.getAttribute("data-library-type"));
    expect(types()).toEqual(["hero", "story", "values", "stats", "video", "benefits", "gallery", "testimonials", "team", "logos", "jobs", "areas", "process", "offices", "faq", "closing"]);
    expect(within(library).getByRole("button", { name: "Portada" })).toBeDisabled();
    expect(within(library).getByRole("button", { name: "Portada" })).toHaveAccessibleDescription("Ya está en tu sitio; solo puede haber una.");
    expect(within(library).getByRole("button", { name: "Vacantes abiertas" })).toHaveAccessibleDescription("Ya está en tu sitio; solo puede haber una.");
    const ids = Array.from(library.querySelectorAll("[id]"), node => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    fireEvent.click(within(library).getByRole("button", { name: "Nuevas · 3" }));
    expect(types()).toEqual(["team", "logos", "areas"]);
    fireEvent.click(within(library).getByRole("button", { name: "Todas" }));
    fireEvent.change(within(library).getByPlaceholderText("Buscar una sección"), { target: { value: "pregunta" } });
    expect(types()).toEqual(["faq"]);
    fireEvent.change(within(library).getByPlaceholderText("Buscar una sección"), { target: { value: "zzz" } });
    expect(within(library).getByText("No encontramos secciones con ese nombre.")).toHaveAttribute("role", "status");
  });
  it("shows the chosen section and layout where it will land, then inserts it after the chosen section", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const story = defaultBlockV2("story");
    const props = await mount([story]);
    select("Historia");
    fireEvent.click(screen.getByRole("button", { name: "Agregar sección" }));
    const library = screen.getByRole("region", { name: "Agregar sección" });
    // Default: after the selected section.
    expect(within(library).getByLabelText("Insertar después de")).toHaveValue(story.id);
    fireEvent.click(within(library).getByRole("button", { name: "Áreas de trabajo" }));
    expect(within(library).getByRole("button", { name: "Diseño Tarjetas con ícono" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(library).getByRole("button", { name: "Diseño Tarjetas con foto" }));
    const ghost = frameDocument().querySelector("[data-editor-dragging]");
    expect(ghost).toHaveAttribute("data-block-type", "areas");
    expect(ghost?.previousElementSibling).toHaveAttribute("data-block-type", "story");
    const hero = props.initialSite.draft.blocks[0];
    fireEvent.change(within(library).getByLabelText("Insertar después de"), { target: { value: hero.id } });
    expect(frameDocument().querySelector("[data-editor-dragging]")?.previousElementSibling).toHaveAttribute("data-block-type", "hero");
    fireEvent.click(within(library).getByRole("button", { name: "Agregar «Áreas de trabajo»" }));
    expect(screen.queryByRole("region", { name: "Agregar sección" })).toBeNull();
    expect(frameDocument().querySelector("[data-editor-dragging]")).toBeNull();
    const body = await saved();
    expect(body.blocks[1]).toMatchObject({ type: "areas", variant: "photo_cards" });
    expect(screen.getByRole("heading", { name: "Propiedades de Áreas de trabajo" })).toBeVisible();
  });
  it("opens in a Sheet on phones and tablets", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    render(<CareersSiteEditor {...fixture()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Secciones" }));
    fireEvent.click(await screen.findByRole("button", { name: "Agregar sección" }));
    const sheet = await screen.findByRole("dialog", { name: "Agregar sección" });
    expect(within(sheet).getByLabelText("Insertar después de")).toBeInTheDocument();
    // The chosen section's name is never truncated in the narrow Sheet: the trigger takes the full row and wraps.
    const trigger = within(sheet).getByRole("combobox", { name: "Insertar después de" });
    expect(trigger).toHaveClass("w-full", "h-auto");
    expect(trigger.closest("[data-slot=field]")).toHaveAttribute("data-orientation", "vertical");
    expect(within(sheet).getByRole("button", { name: "Agregar sección" })).toBeDisabled();
  });
});

describe("properties panel", () => {
  it("groups properties in collapsible groups whose state is remembered across sections and sessions", async () => {
    const props = await mount();
    const triggers = () => within(properties()).getAllByRole("button", { expanded: true }).filter(node => node.getAttribute("data-slot") === "accordion-trigger").map(node => node.textContent);
    expect(triggers()).toEqual(["Diseño de sección", "Estilo de sección", "Contenido", "Botones"]);
    fireEvent.click(within(properties()).getByRole("button", { name: "Estilo de sección" }));
    expect(within(properties()).getByRole("button", { name: "Estilo de sección" })).toHaveAttribute("aria-expanded", "false");
    expect(JSON.parse(localStorage.getItem(PROPERTY_GROUPS_KEY)!)).toEqual({ v: 1, closed: ["style"] });
    select("Vacantes abiertas");
    expect(within(properties()).getByRole("button", { name: "Estilo de sección" })).toHaveAttribute("aria-expanded", "false");
    expect(within(properties()).queryByRole("button", { name: "Botones" })).toBeNull();
    cleanup(); render(<CareersSiteEditor {...props} />); await screen.findByRole("heading", { name: "Tu página" });
    expect(within(properties()).getByRole("button", { name: "Estilo de sección" })).toHaveAttribute("aria-expanded", "false");
    expect(within(properties()).getByRole("button", { name: "Contenido" })).toHaveAttribute("aria-expanded", "true");
  });
  it("keeps the narrow panel from scrolling sideways and lets its controls shrink", async () => {
    await mount();
    const viewport = properties().querySelector('[data-slot="scroll-area-viewport"]')!;
    expect(viewport.parentElement!.className).toContain("[&>[data-slot=scroll-area-viewport]]:overflow-x-hidden!");
    expect(properties().querySelector("[data-properties-content]")).toHaveClass("min-w-0");
    expect(properties().querySelector("[data-property-groups]")).toHaveClass("min-w-0");
    for (const group of properties().querySelectorAll('[data-section-style] [data-slot="toggle-group"]')) expect(group).toHaveClass("w-full", "grid");
    for (const item of properties().querySelectorAll('[data-section-style] [data-slot="toggle-group-item"]')) expect(item).toHaveClass("min-w-0", "whitespace-normal");
    for (const item of properties().querySelectorAll('[data-variant-content]')) expect(item).toHaveClass("min-w-0");
  });
  it("sets the section style from «Estilo de sección», undoable, with the veil only for an image", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await mount(); select("Vacantes abiertas");
    const style = within(properties().querySelector("[data-section-style]") as HTMLElement);
    expect(style.queryByText("Intensidad del velo")).toBeNull();
    fireEvent.click(style.getByRole("button", { name: "Color de marca" }));
    expect((await saved()).blocks.find(block => block.type === "jobs")!.style.background).toBe("brand");
    fireEvent.click(style.getByRole("button", { name: "Imagen" }));
    expect(style.getByText("Imagen de fondo")).toBeInTheDocument();
    expect(style.getByRole("button", { name: "Media" })).toHaveAttribute("aria-pressed", "true");
    expect(style.getByRole("status")).toHaveTextContent(/AA.*Contraste \d+[.,]\d:1 si la foto es muy clara/);
    fireEvent.click(style.getByRole("button", { name: "Fuerte" }));
    fireEvent.click(style.getByRole("button", { name: "Compacto" }));
    fireEvent.click(style.getByRole("button", { name: "Centrado" }));
    expect((await saved()).blocks.find(block => block.type === "jobs")!.style).toEqual({ background: "image", spacing: "compact", align: "center", overlay: "strong", image: null });
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect((await saved()).blocks.find(block => block.type === "jobs")!.style.align).toBe("start");
  });
  it("offers alignment only where the layout honours it; fixed layouts say how they render", async () => {
    await mount([defaultBlockV2("closing")]);
    select("Cierre");
    let style = within(properties().querySelector("[data-section-style]") as HTMLElement);
    expect(style.queryByRole("button", { name: "Izquierda" })).toBeNull();
    expect(style.queryByRole("button", { name: "Centrado" })).toBeNull();
    expect(style.getByText("Alineación")).toBeInTheDocument();
    expect(style.getByText("Este diseño siempre va centrado.")).toBeInTheDocument();
    select("Portada");
    style = within(properties().querySelector("[data-section-style]") as HTMLElement);
    expect(style.getByText("Este diseño siempre va centrado.")).toBeInTheDocument();
    // Every offered Portada layout has a fixed alignment; Vacantes follows the style.
    select("Vacantes abiertas");
    style = within(properties().querySelector("[data-section-style]") as HTMLElement);
    expect(style.getByRole("button", { name: "Izquierda" })).toHaveAttribute("aria-pressed", "true");
    expect(style.queryByText(/Este diseño siempre va/)).toBeNull();
  });
  it("edits the Portada buttons: texts, show/hide the secondary one and where it leads", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const story = defaultBlockV2("story"); story.hidden = true;
    await mount([story]);
    const buttons = within(properties().querySelector("[data-hero-buttons]") as HTMLElement);
    fireEvent.change(buttons.getByLabelText("Botón principal"), { target: { value: "Únete" } });
    fireEvent.change(buttons.getByLabelText("Lleva a"), { target: { value: story.id } });
    expect(buttons.getByText("Esta sección está oculta. Muéstrala o elige otra para publicar.")).toBeInTheDocument();
    let hero = (await saved()).blocks[0];
    expect(hero.type === "hero" && hero.content).toMatchObject({ primary_label: "Únete", secondary_target: story.id, secondary_visible: true });
    fireEvent.click(buttons.getByRole("switch", { name: "Mostrar botón secundario" }));
    expect(buttons.queryByLabelText("Lleva a")).toBeNull();
    hero = (await saved()).blocks[0];
    expect(hero.type === "hero" && hero.content.secondary_visible).toBe(false);
  });
  it("offers the new Portada layouts with their photos (collage up to three)", async () => {
    await mount();
    const layouts = within(properties()).getByRole("group", { name: "Diseño de sección" });
    expect(within(layouts).getAllByRole("button").map(node => node.getAttribute("aria-label"))).toEqual(["Diseño Fotográfica", "Diseño Dividida", "Diseño Centrada", "Diseño Foto con vacantes recientes", "Diseño Collage de fotos"]);
    fireEvent.click(within(layouts).getByRole("button", { name: "Diseño Collage de fotos" }));
    expect(within(properties()).getByText("Foto 1 del collage")).toBeInTheDocument();
    expect(within(properties()).queryByText("Imagen de portada")).toBeNull();
    expect(frameDocument().querySelector('[data-block-type="hero"]')).toHaveAttribute("data-variant", "collage");
  });
  it("edits team, logos, areas and an existing talent call through the content action", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const talent = defaultBlockV2("talent_cta");
    await mount([defaultBlockV2("team"), defaultBlockV2("logos"), defaultBlockV2("areas"), talent]);
    select("Equipo / Líderes");
    fireEvent.click(within(properties()).getByRole("button", { name: "Agregar persona" }));
    fireEvent.change(within(properties()).getByLabelText("Nombre"), { target: { value: "Ana Ruiz" } });
    expect(within(properties()).getByText("Foto")).toBeInTheDocument();
    fireEvent.click(within(properties()).getByRole("switch", { name: "Tengo permiso para publicar a esta persona" }));
    select("Logos / Reconocimientos");
    fireEvent.click(within(properties()).getByRole("button", { name: "Agregar logo" }));
    fireEvent.change(within(properties()).getByLabelText("Nombre"), { target: { value: "Great Place to Work" } });
    expect(within(properties()).getByText("Logo")).toBeInTheDocument();
    select("Áreas de trabajo");
    fireEvent.change(within(properties()).getByLabelText("Título"), { target: { value: "Encuentra tu lugar" } });
    fireEvent.click(within(properties()).getByRole("button", { name: "Agregar" }));
    select("Llamado a talento");
    expect(within(properties()).getByText("El formulario para dejar el CV llega en una próxima entrega.")).toBeInTheDocument();
    fireEvent.change(within(properties()).getByLabelText("Texto del botón"), { target: { value: "Enviar CV" } });
    const blocks = (await saved()).blocks;
    expect(blocks.find(block => block.type === "team")!.content).toMatchObject({ items: [{ name: "Ana Ruiz", consent: true, photo: null, role: null }] });
    expect(blocks.find(block => block.type === "logos")!.content).toMatchObject({ items: [{ name: "Great Place to Work", image: null, caption: null }] });
    expect(blocks.find(block => block.type === "areas")!.content).toMatchObject({ title: "Encuentra tu lugar", overrides: [{ key: "technology_systems", icon: "briefcase", photo: null }] });
    expect(blocks.find(block => block.type === "talent_cta")!.content).toMatchObject({ button_label: "Enviar CV" });
  });
  it("adds an optional video link to a testimonial", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await mount([defaultBlockV2("testimonials")]);
    select("Testimonios");
    fireEvent.click(within(properties()).getByRole("button", { name: "Agregar testimonio" }));
    fireEvent.change(within(properties()).getByLabelText("Video del testimonio"), { target: { value: "nope" } });
    expect(within(properties()).getByText("Pega un enlace de YouTube o Vimeo.")).toBeInTheDocument();
    fireEvent.change(within(properties()).getByLabelText("Video del testimonio"), { target: { value: "https://youtu.be/dQw4w9WgXcQ" } });
    const testimonials = (await saved()).blocks.find(block => block.type === "testimonials")!;
    expect(testimonials.type === "testimonials" && testimonials.content.items[0].video_url).toBe("https://youtu.be/dQw4w9WgXcQ");
  });
});
