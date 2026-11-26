import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "../brand";
import { SITE_THEME_SURFACES, siteBrandTokens, siteTintTokens } from "./theme-tokens";

// Every authored pixel pair, not just principal ink on the page. No contrast
// tolerance: rounded sRGB tokens must meet the actual WCAG threshold.
export function assertTokenContrast(tokens: Record<string, string>) {
  for (const mode of ["light", "dark"]) {
    const get = (role: string) => tokens[`--site-${role}-${mode}`];
    for (const surface of ["page", "card", "band", "muted"]) {
      for (const ink of ["foreground", "secondary", "brand-text"]) {
        expect(contrastRatio(get(ink), get(surface)), `${mode} ${ink}/${surface}`).toBeGreaterThanOrEqual(4.5);
      }
      for (const fill of ["brand", "accent", "ring"]) expect(contrastRatio(get(fill), get(surface)), `${mode} ${fill}/${surface}`).toBeGreaterThanOrEqual(3);
    }
    for (const fill of ["brand", "accent", "banner-accent"]) expect(contrastRatio(get(`on-${fill}`), get(fill)), `${mode} on-${fill}`).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(get("banner-accent"), get("brand"))).toBeGreaterThanOrEqual(3);
  }
}
it("preserves the complete legacy default token snapshot for null fallbacks", () => {
  expect(siteBrandTokens("#7835DB", null, null)).toEqual(siteBrandTokens("#7835DB"));
  expect(siteBrandTokens("#7835DB")).toMatchInlineSnapshot(`
    {
      "--site-band-dark": "#150F20",
      "--site-band-light": "#EEE8F9",
      "--site-brand-dark": "#8F58E1",
      "--site-brand-light": "#7835DB",
      "--site-brand-text-dark": "#9864E4",
      "--site-brand-text-light": "#7835DB",
      "--site-on-brand-dark": "#000000",
      "--site-on-brand-light": "#FFFFFF",
    }
  `);
});
it("separates CTA accent from principal and uses the chosen light surface", () => {
  const tokens = siteBrandTokens("#7835DB", "#0F766E", "#F0F9FF");
  expect(tokens["--site-page-light"]).toBe("#F0F9FF");
  expect(tokens["--site-accent-light"]).not.toBe(tokens["--site-brand-light"]);
  expect(tokens["--site-card-light"]).toBe("#FFFFFF");
  expect(tokens["--site-card-dark"]).toBe("#15121F");
  expect(tokens["--site-page-dark"]).toBe("#0F151A");
  assertTokenContrast(tokens);
});
it.each(["#FFFF00", "#000000", "#FFFFFF", "#808080", "#777777", "#FF00FF"])("protects every pair on adversarial %s backgrounds", background => {
  for (const brand of ["#FFFF00", "#000000", "#FFFFFF", "#808080"]) for (const accent of ["#FFFF00", "#000000", "#FFFFFF", "#7835DB"]) assertTokenContrast(siteBrandTokens(brand, accent, background));
});
it("keeps null accent equal to principal on a custom background", () => {
  const tokens = siteBrandTokens("#7835DB", null, "#FFFF00");
  assertTokenContrast(tokens);
  for (const mode of ["light", "dark"]) {
    expect(tokens[`--site-accent-${mode}`]).toBe(tokens[`--site-brand-${mode}`]);
    expect(tokens[`--site-on-accent-${mode}`]).toBe(tokens[`--site-on-brand-${mode}`]);
  }
});
it("keeps null-background surfaces exact when only accent is customized", () => {
  const tokens = siteBrandTokens("#7835DB", "#000000", null);
  assertTokenContrast(tokens);
  expect(tokens["--site-page-light"]).toBe("#F7F5FB");
  expect(tokens["--site-page-dark"]).toBe("#0C0912");
});
it("uses opaque focus outlines and stable AA CTA fills rather than alpha hover fills", () => {
  const css = readFileSync("src/features/company-site/public/site-theme.module.css", "utf8");
  expect(css).toContain("outline: 2px solid var(--ring)");
  expect(css).toContain('[data-site-palette="true"] [class~="bg-primary"]:hover');
  expect(css).toContain("background-color: var(--primary)");
  expect(css).toContain("--input: var(--muted)");
  expect(css).toContain("--secondary-foreground: var(--site-on-accent)");
});
it("keeps server/client surface definitions synchronized with shared CSS", () => {
  const css = readFileSync("src/features/company-site/public/site-theme.module.css", "utf8");
  for (const mode of ["light", "dark"]) for (const role of ["page", "card", "foreground", "secondary", "accent", "on-accent", "ring"]) expect(css).toContain(`var(--site-${role}-${mode}`);
});
describe("«Tinte suave» surface (S3: four visibly different backgrounds)", () => {
  const palettes: [string, string | null, string | null][] = [["#7835DB", null, null], ["#0F766E", null, null], ["#FFFF00", null, null], ["#000000", null, null], ["#FFFFFF", null, null], ["#808080", null, null], ["#7835DB", "#0F766E", "#F0F9FF"], ["#C2410C", null, "#FFF7ED"], ["#7835DB", "#000000", "#000000"], ["#FFFF00", "#FFFF00", "#FFFF00"]];
  it.each(palettes)("brand %s (accent %s, page %s) tints apart from the page, the band and the brand fill, keeping AA ink", (brand, accent, background) => {
    const tokens = siteBrandTokens(brand, accent, background);
    const tint = siteTintTokens(brand, accent, background);
    for (const mode of ["light", "dark"] as const) {
      const surface = tint[`--site-tint-${mode}`];
      const page = tokens[`--site-page-${mode}`] ?? SITE_THEME_SURFACES[mode].page;
      const card = tokens[`--site-card-${mode}`] ?? SITE_THEME_SURFACES[mode].card;
      expect(surface).toMatch(/^#[\dA-F]{6}$/);
      expect(contrastRatio(surface, page), `${mode} tint/page`).toBeGreaterThanOrEqual(1.1);
      expect(contrastRatio(surface, tokens[`--site-band-${mode}`]), `${mode} tint/band`).toBeGreaterThanOrEqual(1.06);
      expect(contrastRatio(surface, tokens[`--site-brand-${mode}`]), `${mode} tint/brand`).toBeGreaterThanOrEqual(1.5);
      for (const ink of ["foreground", "secondary", "brand-text"]) for (const under of [surface, card]) {
        expect(contrastRatio(tint[`--site-tint-${ink}-${mode}`], under), `${mode} ${ink}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrastRatio(tint[`--site-tint-ring-${mode}`], surface), `${mode} ring`).toBeGreaterThanOrEqual(3);
    }
  });
  it("leaves the legacy token object untouched (tint tokens travel only on tinted sections)", () => {
    expect(Object.keys(siteBrandTokens("#7835DB")).some(key => key.includes("tint"))).toBe(false);
  });
});
