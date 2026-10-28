import { expect, it } from "vitest";
import { contrastRatio } from "./brand";
import { PALETTE_PRESETS } from "./palettes";
import { siteBrandTokens } from "./public/theme-tokens";

it("offers eight distinct Spanish palettes with AA-ready light inks", () => {
  expect(PALETTE_PRESETS).toHaveLength(8);
  expect(new Set(PALETTE_PRESETS.map(p => p.name)).size).toBe(8);
  for (const preset of PALETTE_PRESETS) {
    for (const color of [preset.brand_color, preset.accent_color]) expect(contrastRatio(color, preset.background_color)).toBeGreaterThanOrEqual(4.5);
  }
});
it("meets every preset × theme × token pair without any post-token adjustment or tolerance", () => {
  for (const p of PALETTE_PRESETS) {
    const tokens = siteBrandTokens(p.brand_color, p.accent_color, p.background_color);
    for (const mode of ["light", "dark"]) {
      const get = (role: string) => tokens[`--site-${role}-${mode}`];
      for (const surface of ["page", "band", "card", "muted"]) {
        for (const ink of ["foreground", "secondary", "brand-text"]) expect(contrastRatio(get(ink), get(surface)), `${p.name}/${mode}/${ink}/${surface}`).toBeGreaterThanOrEqual(4.5);
        for (const fill of ["accent", "brand", "ring"]) expect(contrastRatio(get(fill), get(surface)), `${p.name}/${mode}/${fill}/${surface}`).toBeGreaterThanOrEqual(3);
      }
      for (const fill of ["brand", "accent", "banner-accent"]) expect(contrastRatio(get(`on-${fill}`), get(fill))).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(get("banner-accent"), get("brand"))).toBeGreaterThanOrEqual(3);
    }
  }
});
