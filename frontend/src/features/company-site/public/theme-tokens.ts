import { adjustedBrandColor, readableOn } from "../brand";

/** Server-side mirrors of the shared semantic theme surfaces; drift is tested. */
export const SITE_THEME_SURFACES = {
  light: { page: "#F7F5FB", card: "#FFFFFF" },
  dark: { page: "#0C0912", card: "#15121F" },
} as const;

/** Materialize the 7% sRGB tint so CSS and contrast checks use identical pixels. */
function brandBand(fill: string, page: string): string {
  const channel = (hex: string, offset: number) => parseInt(hex.slice(offset, offset + 2), 16);
  return `#${[1, 3, 5].map(offset => Math.round(channel(fill, offset) * .07 + channel(page, offset) * .93).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** Separate brand-as-fill from small-text ink; never change the saved brand. */
export function siteBrandTokens(brand: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const theme of ["light", "dark"] as const) {
    const surfaces = SITE_THEME_SURFACES[theme];
    const fill = adjustedBrandColor(brand, theme === "light" ? "#FFFFFF" : "#000000").color;
    const band = brandBand(fill, surfaces.page);
    // All surfaces in a theme share one luminance pole. Each adjustment moves
    // farther from that pole, preserving contrast already achieved on earlier ones.
    const text = [surfaces.page, band, surfaces.card].reduce((ink, background) => adjustedBrandColor(ink, background).color, fill);
    tokens[`--site-brand-${theme}`] = fill;
    tokens[`--site-on-brand-${theme}`] = readableOn(fill);
    tokens[`--site-brand-text-${theme}`] = text;
    tokens[`--site-band-${theme}`] = band;
  }
  return tokens;
}
