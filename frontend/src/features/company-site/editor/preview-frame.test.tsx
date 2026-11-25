import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import Link from "next/link";
import { PreviewFrame } from "./preview-frame";
import { useSitePortalContainer } from "../public/site-portal";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
let paneWidth = 640;
let viewportHeight = 600;
const callbacks: ResizeObserverCallback[] = [];
const rect = (top: number, width: number, height: number) => ({ x: 0, y: top, left: 0, right: width, top, bottom: top + height, width, height, toJSON() {} });
beforeEach(() => {
  paneWidth = 640; viewportHeight = 600; callbacks.length = 0;
  vi.stubGlobal("innerHeight", 900);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { callbacks.push(callback); }
    observe() {} unobserve() {} disconnect() {}
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.hasAttribute("data-preview-fit")) return rect(100, paneWidth, 4000);
    if (this.hasAttribute("data-preview-content")) return rect(0, 1280, 8000);
    if (this.hasAttribute("data-test-viewport")) return rect(100, paneWidth, viewportHeight);
    if (this.tagName === "IFRAME") return rect(100 - this.closest<HTMLElement>("[data-test-viewport]")!.scrollTop, paneWidth, 8000 * paneWidth / 1280);
    return rect(0, 0, 0);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
// Keep geometry tests tiny: the real presentation's themed mount is exercised
// separately by site-portal.test, including the visitor Dialog entry point.
function Overlay() {
  const container = useSitePortalContainer();
  return <Sheet open><SheetContent container={container}><SheetTitle>Filtros</SheetTitle><SheetDescription>Tu búsqueda</SheetDescription></SheetContent></Sheet>;
}
function preview() {
  return <div data-test-viewport="" data-slot="scroll-area-viewport" style={{ overflowY: "auto" }}><PreviewFrame title="Visible preview" viewportWidth={1280}><p>Contenido</p><Overlay /></PreviewFrame></div>;
}
it("portals the sheet into a box matching the scrolled, scaled visible iframe region", () => {
  const { container } = render(preview());
  const viewport = container.querySelector<HTMLElement>("[data-test-viewport]")!;
  const frame = screen.getByTitle("Visible preview") as HTMLIFrameElement;
  viewport.scrollTop = 480; fireEvent.scroll(viewport);
  const box = frame.contentDocument!.querySelector<HTMLElement>("[data-preview-portal-viewport]");
  expect(box).not.toBeNull();
  expect(box!.parentElement).toBe(frame.contentDocument!.body);
  expect(box).toHaveStyle({ position: "absolute", top: "960px", left: "0px", width: "1280px", height: "1200px", transform: "translateZ(0)", pointerEvents: "none" });
  const sheet = frame.contentDocument!.querySelector<HTMLElement>('[data-slot="sheet-content"]')!;
  expect(sheet.closest("[data-preview-portal-viewport]")).toBe(box);
  expect(box!.querySelector('[data-slot="sheet-overlay"]')).not.toBeNull();
  expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull();
});
it("updates the box on parent resize and scroll without adding to measured site height", async () => {
  const { container } = render(preview());
  const viewport = container.querySelector<HTMLElement>("[data-test-viewport]")!;
  const frame = screen.getByTitle("Visible preview") as HTMLIFrameElement;
  const box = frame.contentDocument!.querySelector<HTMLElement>("[data-preview-portal-viewport]");
  expect(box).not.toBeNull();
  expect(box).toHaveStyle({ top: "0px", height: "1200px" });
  // Nodes constructed by contentDocument use a separate jsdom prototype.
  vi.spyOn(frame.contentDocument!.querySelector('[data-preview-content]')!, "getBoundingClientRect").mockReturnValue(rect(0, 1280, 8000));
  viewport.scrollTop = 300; paneWidth = 320; viewportHeight = 400;
  act(() => { for (const callback of [...callbacks]) callback([], {} as ResizeObserver); });
  expect(frame.style.transform).toBe("scale(0.25)");
  expect(box).toHaveStyle({ top: "1200px", height: "1600px", width: "1280px" });
  expect(frame.height).toBe("8000");
  viewport.scrollTop = 450; fireEvent.scroll(viewport);
  expect(box).toHaveStyle({ top: "1800px" });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
});
describe("drop line reveal (S4)", () => {
  function frameWith(revealKey: string | null) {
    return <div data-test-viewport="" data-slot="scroll-area-viewport" style={{ overflowY: "auto" }}><PreviewFrame title="Visible preview" viewportWidth={1280} revealKey={revealKey}><div data-editor-drop-line="" /></PreviewFrame></div>;
  }
  function setup(lineTop: number, reduced = false) {
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: reduced && query.includes("reduce"), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const view = render(frameWith(null));
    const viewport = view.container.querySelector<HTMLElement>("[data-test-viewport]")!;
    const scrollTo = vi.fn(); viewport.scrollTo = scrollTo as typeof viewport.scrollTo;
    const doc = (screen.getByTitle("Visible preview") as HTMLIFrameElement).contentDocument!;
    // Nodes constructed by contentDocument use a separate jsdom prototype.
    vi.spyOn(doc.querySelector("[data-editor-drop-line]")!, "getBoundingClientRect").mockReturnValue(rect(lineTop, 1280, 4));
    return { ...view, scrollTo };
  }
  it("scrolls the preview smoothly so an off-screen insertion line is visible", () => {
    // Scale 0.5: a line at 3000 px in the site sits 1500 px below the 100 px frame top.
    const { rerender, scrollTo } = setup(3000);
    expect(scrollTo).not.toHaveBeenCalled();
    rerender(frameWith("story:3"));
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 1600 + 2 - 700 + 150, behavior: "smooth" });
  });
  it("jumps instantly with reduced motion and leaves a visible line alone", () => {
    const { rerender, scrollTo } = setup(3000, true);
    rerender(frameWith("story:3"));
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "instant" }));
    cleanup();
    const visible = setup(600);
    visible.rerender(frameWith("story:2"));
    expect(visible.scrollTo).not.toHaveBeenCalled();
  });
});
describe("links and forms inside the preview never navigate the frame", () => {
  // An about:blank iframe resolves relative and fragment URLs against the editor
  // page, so following any of them loaded the editor inside its own preview.
  function siteWithLinks(onSelect = vi.fn()) {
    const view = render(<div data-test-viewport="" data-slot="scroll-area-viewport" style={{ overflowY: "auto" }}>
      <PreviewFrame title="Visible preview" viewportWidth={1280}>
        <div onClick={onSelect}>
          <a href="#vacantes">Ver vacantes</a>
          <Link href="/empresas/grupo-altavista/vacantes/1">Analista</Link>
          <a href="https://peopleflow.mx/">PeopleFlow</a>
          <form><button type="submit">Buscar</button></form>
        </div>
        <section id="vacantes">Vacantes abiertas</section>
      </PreviewFrame>
    </div>);
    const viewport = view.container.querySelector<HTMLElement>("[data-test-viewport]")!;
    const scrollTo = vi.fn(); viewport.scrollTo = scrollTo as typeof viewport.scrollTo;
    const doc = (screen.getByTitle("Visible preview") as HTMLIFrameElement).contentDocument!;
    vi.spyOn(doc.getElementById("vacantes")!, "getBoundingClientRect").mockReturnValue(rect(3000, 1280, 400));
    return { doc, scrollTo, onSelect };
  }
  const click = (target: Element, init: MouseEventInit = {}) => {
    const event = new (target.ownerDocument.defaultView!.MouseEvent)("click", { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event); return event;
  };
  it("cancels in-site, app and external links while the click still reaches the section", () => {
    const { doc, onSelect } = siteWithLinks();
    for (const name of ["Analista", "PeopleFlow"]) {
      const link = Array.from(doc.querySelectorAll("a")).find(node => node.textContent === name)!;
      expect(click(link).defaultPrevented).toBe(true);
      expect(click(link, { ctrlKey: true }).defaultPrevented).toBe(true);
    }
    const aux = new (doc.defaultView!.MouseEvent)("auxclick", { bubbles: true, cancelable: true, button: 1 });
    doc.querySelector('a[href^="/empresas"]')!.dispatchEvent(aux);
    expect(aux.defaultPrevented).toBe(true);
    expect(onSelect).toHaveBeenCalledTimes(4);
  });
  it("scrolls the preview to the section a fragment link names instead of navigating", () => {
    const { doc, scrollTo } = siteWithLinks();
    expect(click(doc.querySelector('a[href="#vacantes"]')!).defaultPrevented).toBe(true);
    // Scale 0.5: the section at 3000 px sits 1500 px below the 100 px frame top.
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 1600 - 100, behavior: "smooth" });
  });
  it("cancels form submissions inside the preview", () => {
    const { doc } = siteWithLinks();
    const submit = new (doc.defaultView!.Event)("submit", { bubbles: true, cancelable: true });
    doc.querySelector("form")!.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(true);
  });
});
