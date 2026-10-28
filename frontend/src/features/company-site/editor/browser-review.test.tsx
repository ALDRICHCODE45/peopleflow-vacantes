import "./browser-platform.test-support";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { CareersSiteEditor } from "./index";
import { PreviewFrame } from "./preview-frame";
import { publishedFixture } from "../public/fixtures.test-support";
import { defaultBlock } from "../defaults";
import type { SiteState } from "../api/model";
vi.mock("next/font/google", () => ({ Fraunces: () => ({ variable: "editorial" }), Plus_Jakarta_Sans: () => ({ variable: "modern" }) }));
vi.mock("../api/actions", () => ({ saveDraftAction: vi.fn() }));
// Floating positioning has no layout in jsdom. Exercise the real root/trigger
// open state for both input modes, leaving popup paint to the browser review.
vi.mock("@/components/ui/tooltip", async original => {
  const parts = await original<typeof import("@/components/ui/tooltip")>();
  return { ...parts, TooltipContent: () => null };
});
const observers: { targets: Set<Element>; callback: ResizeObserverCallback }[] = [];
let paneWidth = 415;
const rect = (top = 0, width = 0, height = 0) => ({ top, left: 0, width, height, bottom: top + height, right: width, x: 0, y: top, toJSON() {} });
function props() {
  const data = publishedFixture();
  const initialSite: SiteState = { draft: { ...data.site, slug: data.slug }, draft_version: 1, published: null, has_unpublished_changes: false, media: data.media, updated_at: data.published_at };
  return { initialSite, role: "owner", preview: { company: data.company, jobs: [], officeLabels: new Map<string, string>() } };
}
const intoView = vi.fn();
const originalScroll = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
beforeEach(() => {
  localStorage.clear();
  paneWidth = 415; observers.length = 0; intoView.mockClear();
  // The resizable engine reads pixel widths and rem units; jsdom has no layout.
  document.documentElement.style.fontSize = "16px";
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) { return this.hasAttribute("data-panel") ? 400 : 0; });
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: intoView });
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class {
    record: typeof observers[number];
    constructor(callback: ResizeObserverCallback) { this.record = { targets: new Set(), callback }; observers.push(this.record); }
    observe(target: Element) { this.record.targets.add(target); }
    unobserve(target: Element) { this.record.targets.delete(target); }
    disconnect() { this.record.targets.clear(); }
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.hasAttribute("data-preview-fit")) return rect(0, paneWidth, 0);
    if (this.hasAttribute("data-editor-workspace")) return rect(100, 1200, 600);
    return rect();
  });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalScroll) Object.defineProperty(Element.prototype, "scrollIntoView", originalScroll);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});
function resize(target: Element) {
  act(() => { for (const observer of observers) if (observer.targets.has(target)) observer.callback([], {} as ResizeObserver); });
}
it.each([1280, 768, 390])("renders a %i viewport scaled to the pane, maintains scaled height, and never upscales", async width => {
  const { container } = render(<PreviewFrame title="Scaled preview" viewportWidth={width}><p>Preview content</p></PreviewFrame>);
  const iframe = screen.getByTitle("Scaled preview") as HTMLIFrameElement;
  expect(iframe.style.width).toBe(`${width}px`);
  const content = iframe.contentDocument!.querySelector("[data-preview-content]")!;
  vi.spyOn(content, "getBoundingClientRect").mockReturnValue(rect(0, width, 2400)); resize(content);
  const stage = container.querySelector("[data-preview-stage]") as HTMLElement;
  const scale = Math.min(1, paneWidth / width);
  expect(iframe.style.transform).toBe(`scale(${scale})`);
  expect(stage.style.height).toBe(`${2400 * scale}px`);
  paneWidth = 2000; resize(container.querySelector("[data-preview-fit]")!);
  expect(iframe.style.transform).toBe("scale(1)"); expect(stage.style.height).toBe("2400px");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
});
it("keeps the identity, public link and save status in one header without a second H1", async () => {
  render(<CareersSiteEditor {...props()} />); await screen.findByRole("heading", { name: "Tu página" });
  const identity = screen.getByRole("heading", { level: 2, name: "Nexo" });
  const header = identity.closest("header")!;
  expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  expect(within(header).getByRole("status", { name: "Estado del guardado" })).toBeVisible();
  expect(within(header).getByRole("link", { name: "/empresas/nexo-labs" })).toHaveAttribute("target", "_blank");
  expect(within(header).getByRole("link", { name: "/empresas/nexo-labs" })).toHaveAttribute("rel", "noopener noreferrer");
});
it("places panel toggles at the preview toolbar edges, reachable with both panes collapsed", async () => {
  render(<CareersSiteEditor {...props()} />);
  await screen.findByRole("heading", { name: "Tu página" });
  const toolbar = screen.getByRole("group", { name: "Herramientas de vista previa" });
  const buttons = within(toolbar).getAllByRole("button");
  expect(buttons[0]).toHaveAccessibleName("Ocultar secciones");
  expect(buttons.at(-1)).toHaveAccessibleName("Ocultar propiedades");
  expect(buttons[0]).toHaveClass("size-10", "hover:bg-muted");
  expect(screen.queryByRole("group", { name: "Paneles del editor" })).toBeNull();
  fireEvent.click(buttons[0]); fireEvent.click(buttons.at(-1)!);
  expect(within(toolbar).getByLabelText("Mostrar secciones")).toBeEnabled();
  expect(within(toolbar).getByLabelText("Mostrar propiedades")).toBeEnabled();
  fireEvent.click(screen.getByLabelText("Enfocar vista previa"));
  expect(within(toolbar).getByLabelText("Mostrar secciones")).toBeDisabled();
  expect(within(toolbar).getByLabelText("Mostrar propiedades")).toBeDisabled();
});
it("bounds the desktop workspace below the header and gives each column one ScrollArea", async () => {
  const { container } = render(<CareersSiteEditor {...props()} />); await screen.findByRole("heading", { name: "Tu página" });
  const workspace = container.querySelector("[data-editor-workspace]") as HTMLElement;
  expect(workspace.style.height).toBe(`${window.innerHeight - 100}px`);
  for (const name of ["sections", "preview", "properties"]) {
    const region = container.querySelector(`[data-editor-region="${name}"]`)!;
    expect(region.querySelectorAll('[data-slot="scroll-area"]')).toHaveLength(1);
  }
  expect(intoView).not.toHaveBeenCalled();
});
it("never auto-scrolls the page on mobile, including after a selection", async () => {
  vi.mocked(window.matchMedia).mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList);
  const { container } = render(<CareersSiteEditor {...props()} />);
  const user = userEvent.setup(); await user.click(await screen.findByRole("button", { name: "Secciones" }));
  await user.click(screen.getByRole("button", { name: "Seleccionar Vacantes abiertas" }));
  expect(intoView).not.toHaveBeenCalled();
  expect((container.querySelector("[data-editor-workspace]") as HTMLElement).style.height).toBe("");
  expect(container.querySelector('[data-editor-region="preview"] [data-slot="scroll-area"]')).toBeNull();
});
it("uses an inline protected indicator and current variant instead of a second status row", async () => {
  const data = props(); const process = defaultBlock("process"); data.initialSite.draft.blocks.push(process);
  render(<CareersSiteEditor {...data} />); await screen.findByRole("heading", { name: "Tu página" });
  const row = screen.getByRole("button", { name: "Seleccionar Portada" }).closest('[role="listitem"]') as HTMLElement;
  expect(within(row).getByText("Fotográfica")).toBeVisible();
  expect(row.querySelector('[data-slot="item-description"]')).toBeNull();
  expect(row.querySelector('[data-section-indicators] [aria-label="Sección obligatoria"]')).not.toBeNull();
  expect(screen.getByRole("button", { name: "Seleccionar Proceso de selección" }).querySelector(".truncate")).toBeNull();
});
it("keeps schematic previews outside the primitive's icon sizing rule and adds an editor label", async () => {
  render(<CareersSiteEditor {...props()} />); await screen.findByRole("heading", { name: "Tu página" });
  const choice = screen.getByRole("button", { name: "Diseño Centrada" });
  expect(choice.querySelector("svg")).toHaveClass("size-full");
  expect(choice.querySelector("[data-variant-thumbnail]")).toHaveClass("h-18");
  const iframe = screen.getByTitle("Vista previa del sitio") as HTMLIFrameElement;
  expect(iframe.contentDocument!.querySelector('[data-editor-label]')).toHaveTextContent("Portada");
  expect(iframe.contentDocument!.querySelector('[data-editor-selected="true"]')).not.toHaveClass("outline-ring");
});
it.each(["keyboard", "hover"])("retains standard disabled publish paint and opens its tooltip with %s", async input => {
  render(<CareersSiteEditor {...props()} role="recruiter" />); await screen.findByRole("heading", { name: "Tu página" });
  const button = screen.getByRole("button", { name: "Publicar" }); expect(button).toBeDisabled();
  expect(button).toHaveClass("disabled:opacity-50");
  const trigger = screen.getByLabelText("Solo la persona dueña de la empresa puede publicar");
  const user = userEvent.setup();
  if (input === "keyboard") { act(() => trigger.focus()); expect(trigger).toHaveFocus(); }
  else await user.hover(trigger);
  // jsdom cannot position the floating portal. The real Tooltip root owns this
  // open marker; test both input paths without replacing its controller.
  await waitFor(() => expect(trigger).toHaveAttribute("data-popup-open"));
});
it("focuses the preview locally, preserves selection, and displays its actual zoom", async () => {
  const { container } = render(<div data-global-sidebar-state="expanded"><CareersSiteEditor {...props()} /></div>);
  await screen.findByRole("heading", { name: "Tu página" });
  expect(screen.getByLabelText("Zoom de la vista previa")).toHaveTextContent("32 %");
  const focus = screen.getByRole("button", { name: "Enfocar vista previa" });
  const user = userEvent.setup();
  expect(focus).toHaveAttribute("aria-pressed", "false");
  await user.click(focus);
  expect(focus).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("complementary", { name: "Organizar sitio" })).toBeNull();
  expect(screen.queryByRole("complementary", { name: "Propiedades de la sección" })).toBeNull();
  expect(container.querySelector("[data-global-sidebar-state]")).toHaveAttribute("data-global-sidebar-state", "expanded");
  const frame = screen.getByTitle("Vista previa del sitio") as HTMLIFrameElement;
  expect(frame.contentDocument!.querySelector('[data-editor-selected="true"]')).toHaveAttribute("data-block-type", "hero");
  paneWidth = 1000; resize(container.querySelector("[data-preview-fit]")!);
  expect(screen.getByLabelText("Zoom de la vista previa")).toHaveTextContent("78 %");
  await user.click(focus);
  expect(screen.getByRole("complementary", { name: "Organizar sitio" })).toBeVisible();
  expect(screen.getByRole("complementary", { name: "Propiedades de la sección" })).toBeVisible();
});
it("counter-scales editor affordances as the preview zoom changes", async () => {
  render(<CareersSiteEditor {...props()} />); await screen.findByRole("heading", { name: "Tu página" });
  const frame = screen.getByTitle("Vista previa del sitio") as HTMLIFrameElement;
  const content = frame.contentDocument!.querySelector("[data-preview-content]") as HTMLElement;
  expect(Number(content.style.getPropertyValue("--editor-inverse-scale"))).toBeCloseTo(1280 / paneWidth);
  paneWidth = 640; resize(frame.closest("[data-preview-fit]")!);
  expect(content.style.getPropertyValue("--editor-inverse-scale")).toBe("2");
  expect(frame.contentDocument!.querySelector("[data-editor-label]")).toHaveTextContent("Portada");
});
it("gives thumbnail and caption their own padded content stack inside the variant border", async () => {
  render(<CareersSiteEditor {...props()} />); await screen.findByRole("heading", { name: "Tu página" });
  const choice = screen.getByRole("button", { name: "Diseño Centrada" });
  const stack = choice.querySelector("[data-variant-content]");
  expect(stack).toHaveClass("py-3", "gap-2");
  expect(stack?.querySelector("[data-variant-thumbnail]")).not.toBeNull();
  expect(within(stack as HTMLElement).getByText("Centrada")).toBeVisible();
});
it("uses a row-wide native selection hit area so pointer and keyboard feedback cannot form an inner pill", async () => {
  render(<CareersSiteEditor {...props()} />); await screen.findByRole("heading", { name: "Tu página" });
  const select = screen.getByRole("button", { name: "Seleccionar Portada" });
  const row = select.closest('[role="listitem"]')!;
  expect(select).toHaveClass("absolute", "inset-0", "size-full");
  expect(select.closest('[data-slot="item-title"]')).toBeNull();
  expect(row).toHaveClass("relative", "ring-1", "ring-primary/40");
  expect(select).toHaveClass("focus-visible:ring-3");
});
it("defaults below md to mobile but allows an explicit device change", async () => {
  vi.mocked(window.matchMedia).mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList);
  render(<CareersSiteEditor {...props()} />);
  const frame = screen.getByTitle("Vista previa del sitio") as HTMLIFrameElement;
  expect(frame.style.width).toBe("390px");
  expect(screen.getByRole("button", { name: "Móvil" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Escritorio" }));
  expect(frame.style.width).toBe("1280px");
});
it.each([[1440, 900], [1280, 800], [1920, 1080]])("accounts for ancestor bottom gutters and borders at %i × %i", async (width, height) => {
  vi.stubGlobal("innerWidth", width); vi.stubGlobal("innerHeight", height);
  const { container } = render(<div data-shell-gutter="" style={{ paddingBottom: 12, borderBottom: "2px solid transparent" }}><div data-pf-page-content="" style={{ paddingBottom: 24 }}><CareersSiteEditor {...props()} /></div></div>);
  await screen.findByRole("heading", { name: "Tu página" });
  const workspace = container.querySelector("[data-editor-workspace]") as HTMLElement;
  expect(workspace.style.height).toBe(`${height - 100 - 24 - 12 - 2}px`);
  const gutter = container.querySelector("[data-shell-gutter]") as HTMLElement;
  gutter.style.paddingBottom = "20px"; resize(gutter);
  expect(workspace.style.height).toBe(`${height - 100 - 24 - 20 - 2}px`);
});
it.each([["process", "Proceso de selección"], ["faq", "Preguntas frecuentes"]] as const)("keeps %s icon and single-line name in one horizontal identity row at the compact column width", async (type, label) => {
  const data = props(); data.initialSite.draft.blocks.push(defaultBlock(type));
  render(<CareersSiteEditor {...data} />); await screen.findByRole("heading", { name: "Tu página" });
  const select = screen.getByRole("button", { name: `Seleccionar ${label}` });
  const row = select.closest('[role="listitem"]') as HTMLElement;
  const name = within(row).getByText(label);
  const identity = name.closest("[data-section-identity]");
  expect(identity).toHaveClass("flex", "flex-row", "items-center");
  expect(identity?.querySelector("[data-section-type-icon]")?.parentElement).toBe(identity);
  expect(name).toHaveClass("whitespace-nowrap");
  expect(identity).not.toHaveClass("line-clamp-none");
  expect(select).toHaveClass("absolute", "inset-0", "size-full");
  // jsdom cannot measure text; this fixes the actual CSS regression (line-clamp
  // changing the icon's flex parent to display:block). Browser verifies 280px fit.
  expect(row.querySelector("[data-section-copy]")).toContainElement(name);
});
it("makes the real preview viewport a named, visibly focusable keyboard scroll region", async () => {
  render(<CareersSiteEditor {...props()} />); await screen.findByRole("heading", { name: "Tu página" });
  const frame = screen.getByTitle("Vista previa del sitio");
  const viewport = frame.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
  expect(viewport).toHaveAttribute("tabindex", "0");
  expect(screen.getByRole("region", { name: "Vista previa en vivo" })).toBe(viewport);
  expect(viewport).toHaveClass("focus-visible:ring-[3px]", "focus-visible:ring-ring/50");
  const user = userEvent.setup();
  act(() => screen.getByRole("button", { name: "Ocultar propiedades" }).focus());
  await user.tab(); expect(viewport).toHaveFocus();
  // Base UI can recompute a non-overflowing/temporarily unloaded viewport as -1.
  // The local accessibility contract must survive those later measurements.
  act(() => { viewport.tabIndex = -1; viewport.setAttribute("role", "presentation"); });
  await waitFor(() => expect(viewport).toHaveAttribute("tabindex", "0"));
  expect(viewport).toHaveAttribute("role", "region");
});
