import "./browser-platform.test-support";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
// Sections v2 on for this whole file (model.ts and the editor read the same switch).
vi.mock("../sections-v2", () => ({ SECTIONS_V2_ENABLED: true, TALENT_CTA_ENABLED: false }));
vi.mock("next/font/google", () => ({ Fraunces: () => ({ variable: "editorial" }), Plus_Jakarta_Sans: () => ({ variable: "modern" }) }));
vi.mock("../api/actions", () => ({ saveDraftAction: vi.fn(), slugAvailabilityAction: vi.fn().mockResolvedValue({ kind: "uncertain" }), publishSiteAction: vi.fn(), unpublishSiteAction: vi.fn() }));
vi.mock("@/components/ui/dropdown-menu", async original => {
  const parts = await original<typeof import("@/components/ui/dropdown-menu")>();
  return { ...parts, DropdownMenuContent: ({ children }: { children: ReactNode }) => <parts.DropdownMenuGroup>{children}</parts.DropdownMenuGroup> };
});
vi.mock("./media", () => ({ ImageField: ({ label }: { label: string }) => <button type="button" data-image-field="">{label}</button> }));
import { CareersSiteEditor } from "./index";
import { publishedFixture } from "../public/fixtures.test-support";
import { defaultBlockV2 } from "../defaults";
import type { SiteState } from "../api/model";
import type { SiteBlockV2 } from "../model";
import { saveDraftAction } from "../api/actions";
import { PROPERTY_GROUPS_KEY } from "./property-groups";
import { EDITOR_LAYOUT_KEY } from "./editor-layout";
import { v2Draft } from "./site-state.test-support";

function team(content: Partial<Extract<SiteBlockV2, { type: "team" }>["content"]> = {}): SiteBlockV2 {
  const base = defaultBlockV2("team") as Extract<SiteBlockV2, { type: "team" }>;
  return { ...base, content: { ...base.content, title: "Este titulo de la seccion.", intro: "Esta es la intruduccion de la seccion.", ...content } };
}
function fixture(extra: SiteBlockV2[]) {
  const data = publishedFixture();
  const draft = v2Draft({ ...data.site, slug: data.slug });
  draft.blocks.splice(draft.blocks.length - 1, 0, ...extra);
  const initialSite: SiteState = { draft, draft_version: 7, published: null, has_unpublished_changes: false, media: data.media, updated_at: data.published_at };
  return { initialSite, role: "owner", preview: { company: data.company, jobs: [], officeLabels: new Map<string, string>() } };
}
async function mount(extra: SiteBlockV2[]) {
  render(<CareersSiteEditor {...fixture(extra)} />);
  // The list sits in a Sheet on phones; the preview is always there.
  await screen.findByTitle("Vista previa del sitio");
  await waitFor(() => expect(frame().getByRole("heading", { level: 1 })).toBeInTheDocument());
}
const frame = () => within((screen.getByTitle("Vista previa del sitio") as HTMLIFrameElement).contentDocument!.body);
const properties = () => screen.getByRole("complementary", { name: "Propiedades de la sección" });
const row = (name: string) => within(screen.getByRole("list", { name: "Secciones del sitio" })).getByRole("button", { name: `Seleccionar ${name}` });

beforeEach(() => {
  localStorage.clear();
  document.documentElement.style.fontSize = "16px";
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) { return this.hasAttribute("data-panel") ? 400 : 0; });
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.mocked(saveDraftAction).mockImplementation(async ({ body }) => ({ kind: "success", data: { ...fixture([]).initialSite, draft: body as SiteState["draft"], draft_version: 8 }, etag: '"8"' }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("«Completar sección» leads to what is missing (L11)", () => {
  it("selects the section, shows a folded properties panel, opens a closed group and focuses «Agregar persona»", async () => {
    localStorage.setItem(EDITOR_LAYOUT_KEY, JSON.stringify({ v: 1, layout: { sections: 25, preview: 75, properties: 0 } }));
    localStorage.setItem(PROPERTY_GROUPS_KEY, JSON.stringify({ v: 1, closed: ["content"] }));
    await mount([team()]);
    expect(document.getElementById("editor-properties")).not.toBeVisible();
    // The preview shows what was typed, not the generic card.
    expect(frame().getByRole("heading", { level: 2, name: "Este titulo de la seccion." })).toBeInTheDocument();
    expect(frame().getByText("Esta es la intruduccion de la seccion.")).toBeInTheDocument();
    fireEvent.click(frame().getByRole("button", { name: "Completar sección" }));
    expect(screen.getByRole("heading", { name: "Propiedades de Equipo / Líderes" })).toBeInTheDocument();
    expect(document.getElementById("editor-properties")).toBeVisible();
    expect(within(properties()).getByRole("button", { name: "Contenido" })).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(document.activeElement).toBe(within(properties()).getByRole("button", { name: "Agregar persona" })));
  });
  it("opens the incomplete person and focuses its permission switch", async () => {
    await mount([team({ items: [{ name: "Ana", role: null, photo: null, consent: false }] })]);
    fireEvent.click(frame().getByRole("button", { name: "Completar sección" }));
    await waitFor(() => expect(document.activeElement).toBe(within(properties()).getByRole("switch", { name: "Tengo permiso para publicar a esta persona" })));
  });
  it("leaves the focused preview so the panel can show", async () => {
    await mount([team()]);
    fireEvent.click(screen.getByRole("button", { name: "Enfocar vista previa" }));
    expect(document.getElementById("editor-properties")).not.toBeVisible();
    fireEvent.click(frame().getByRole("button", { name: "Completar sección" }));
    expect(document.getElementById("editor-properties")).toBeVisible();
    await waitFor(() => expect(document.activeElement).toBe(within(properties()).getByRole("button", { name: "Agregar persona" })));
  });
  it("«Ir a lo que falta» on a «Fondo en movimiento» hero focuses its video slot first, then the poster", async () => {
    const media = publishedFixture().media[0].id;
    for (const [background_video, focused] of [[null, "Subir Video de fondo"], [{ media_id: media }, "Imagen de portada"]] as const) {
      const props = fixture([]);
      const hero = props.initialSite.draft.blocks[0];
      if (hero.type !== "hero") throw new Error("fixture");
      props.initialSite.draft.blocks[0] = { ...hero, variant: "background_loop", content: { ...hero.content, title: "Hola", cover: null, background_video } };
      render(<CareersSiteEditor {...props} />);
      await waitFor(() => expect(frame().getByRole("heading", { level: 1 })).toBeInTheDocument());
      expect(row("Portada")).toHaveAccessibleDescription(background_video ? /Falta: la imagen de portada \(póster del video\)/ : /Falta: el video de fondo/);
      fireEvent.click(row("Portada"));
      fireEvent.click(within(within(properties()).getByRole("note")).getByRole("button", { name: "Ir a lo que falta" }));
      await waitFor(() => expect(document.activeElement).toBe(within(properties()).getByRole("button", { name: focused })));
      cleanup();
    }
  });
  it("opens the properties Sheet on phones and tablets and focuses the missing control", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    await mount([team()]);
    fireEvent.click(frame().getByRole("button", { name: "Completar sección" }));
    const sheet = await screen.findByRole("dialog", { name: "Equipo / Líderes" });
    await waitFor(() => expect(document.activeElement).toBe(within(sheet).getByRole("button", { name: "Agregar persona" })));
  });
});

describe("«Incompleta» says what is missing (L11)", () => {
  it("the row describes it and the properties panel states it with a way to get there", async () => {
    await mount([team()]);
    expect(row("Equipo / Líderes")).toHaveAccessibleDescription(/Falta: al menos 1 persona con permiso/);
    fireEvent.click(row("Equipo / Líderes"));
    const note = within(properties()).getByRole("note");
    expect(note).toHaveTextContent("Falta: al menos 1 persona con permiso");
    fireEvent.click(within(note).getByRole("button", { name: "Ir a lo que falta" }));
    await waitFor(() => expect(document.activeElement).toBe(within(properties()).getByRole("button", { name: "Agregar persona" })));
  });
  it("a complete section has no hint", async () => {
    await mount([team({ items: [{ name: "Ana", role: null, photo: null, consent: true }] })]);
    expect(row("Equipo / Líderes")).not.toHaveAccessibleDescription(/Falta/);
    fireEvent.click(row("Equipo / Líderes"));
    expect(within(properties()).queryByRole("note")).toBeNull();
  });
});

describe("selected rings are never clipped (L11)", () => {
  it("the layout picker draws its selection inside each card and the groups leave room for focus rings", async () => {
    await mount([team()]);
    fireEvent.click(row("Equipo / Líderes"));
    const pressed = within(properties()).getByRole("button", { name: "Diseño Cuadrícula" });
    expect(pressed).toHaveAttribute("aria-pressed", "true");
    expect(pressed.className).toMatch(/inset-ring-2/);
    expect(pressed.className).not.toMatch(/(^|\s)data-pressed:ring-2/);
    const content = pressed.closest('[data-slot="accordion-content"]')!.firstElementChild!;
    expect(content.className).toMatch(/(^|\s)pt-1(\s|$)/);
  });
});
