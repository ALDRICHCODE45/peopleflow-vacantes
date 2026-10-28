import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CompanySitePresentation } from "./company-site-presentation";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PreviewFrame } from "../editor/preview-frame";
import { publishedFixture } from "./fixtures.test-support";
import { listItem, vacancyDetail } from "@/features/jobs/api/public-fixtures";
import { PALETTE_PRESETS } from "../palettes";
import { contrastRatio } from "../brand";
import { siteBrandTokens, SITE_THEME_SURFACES } from "./theme-tokens";
vi.mock("next/font/google", () => ({ Fraunces: () => ({ variable: "editorial" }), Plus_Jakarta_Sans: () => ({ variable: "modern" }) }));
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("gives overlay field wrappers a visible opaque boundary even when input and popup fills match", () => {
  const css = readFileSync("src/features/company-site/public/site-theme.module.css", "utf8");
  const overlay = css.match(/\.site :is\(\[data-slot="sheet-content"\], \[data-slot="combobox-content"\], \[data-slot="popover-content"\]\) \{([^}]+)\}/)?.[1];
  expect(overlay).toBeDefined();
  expect(overlay).toContain("--input: var(--background)");
  expect(overlay).toContain("--muted: var(--background)");
  expect(overlay).toContain("--site-field-border: var(--foreground)");
  expect(css).toContain('border-color: var(--site-field-border)');
  expect(css).toContain('[data-slot="combobox-chips"]');
  expect(css).toContain('[data-slot="input-group"]');
});
it("keeps overlay field boundaries above 3:1 and text at AA in both themes", () => {
  for (const palette of [...PALETTE_PRESETS, { brand_color: "#1D4ED8", accent_color: "#0E7490", background_color: "#000000" }]) {
    const tokens = siteBrandTokens(palette.brand_color, palette.accent_color, palette.background_color);
    for (const theme of ["light", "dark"] as const) {
      const foreground = tokens[`--site-foreground-${theme}`];
      const secondary = tokens[`--site-secondary-${theme}`];
      const card = tokens[`--site-card-${theme}`] ?? SITE_THEME_SURFACES[theme].card;
      const page = tokens[`--site-page-${theme}`] ?? SITE_THEME_SURFACES[theme].page;
      const blend = `#${[1, 3, 5].map(i => Math.round((parseInt(card.slice(i, i + 2), 16) + parseInt(page.slice(i, i + 2), 16)) / 2).toString(16).padStart(2, "0")).join("")}`;
      for (const surface of [card, page, blend]) {
        expect(contrastRatio(foreground, surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(secondary, surface)).toBeGreaterThanOrEqual(4.5);
      }
    }
  }
});
it("applies the extra site focus outline only to bare focusables without their own ring", () => {
  const css = readFileSync("src/features/company-site/public/site-theme.module.css", "utf8");
  const selector = '.site[data-site-palette="true"] :focus-visible:not([data-slot]):not([class*="focus-visible:ring"])';
  expect(css).toContain(`${selector} {`);
  render(<div className="site" data-site-palette="true"><a href="#">Enlace</a><input data-slot="combobox-chip-input" aria-label="Filtro" /><button data-slot="button">Botón</button><a href="#" className="focus-visible:ring-2">Fila</a></div>);
  const matches = selector.replace(":focus-visible", ":focus");
  for (const element of [screen.getByRole("link", { name: "Enlace" }), screen.getByRole("textbox"), screen.getByRole("button"), screen.getByRole("link", { name: "Fila" })]) {
    element.focus();
    expect(element.matches(matches)).toBe(element.textContent === "Enlace");
  }
});
function site() {
  const data = publishedFixture();
  return <CompanySitePresentation site={data.site} company={data.company} jobs={[listItem(vacancyDetail)]} officeLabels={new Map()} />;
}
function assertPortal(root: HTMLElement, owner: Document) {
  const panel = root.querySelector('[data-slot="sheet-content"]');
  expect(panel).not.toBeNull();
  expect(panel?.ownerDocument).toBe(owner);
  expect(root.querySelector('[data-slot="sheet-overlay"]')).not.toBeNull();
  expect(panel).toHaveClass("fixed");
  expect(root.querySelector('[data-slot="sheet-overlay"]')).toHaveClass("fixed", "inset-0");
}
it("portals the public filters panel and backdrop inside the palette/font root", () => {
  const { container } = render(site());
  const root = container.querySelector<HTMLElement>('[data-font-pair]')!;
  fireEvent.click(within(root).getByRole("button", { name: "Filtros" }));
  assertPortal(root, document);
});
it.each(["Vista previa del sitio", "Ver como visitante"])("keeps filters inside the %s PreviewFrame document, not the editor", title => {
  const preview = <PreviewFrame title={title}>{site()}</PreviewFrame>;
  render(title === "Ver como visitante" ? <Dialog open><DialogContent><DialogTitle>Vista de visitante</DialogTitle><DialogDescription>Tu sitio</DialogDescription>{preview}</DialogContent></Dialog> : preview);
  const frame = screen.getByTitle(title) as HTMLIFrameElement;
  const owner = frame.contentDocument!;
  const root = owner.querySelector<HTMLElement>('[data-font-pair]')!;
  fireEvent.click(within(root).getByRole("button", { name: "Filtros" }));
  const overlayRoot = owner.querySelector<HTMLElement>('[data-site-overlay-root]')!;
  expect(overlayRoot.parentElement).toHaveAttribute("data-preview-portal-viewport");
  expect(overlayRoot.getAttribute("data-font-pair")).toBe(root.getAttribute("data-font-pair"));
  expect(overlayRoot.style.cssText).toBe(root.style.cssText);
  expect(overlayRoot).toHaveClass("pointer-events-none", "[&>*]:pointer-events-auto");
  assertPortal(overlayRoot, owner);
  expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull();
  expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull();
});
