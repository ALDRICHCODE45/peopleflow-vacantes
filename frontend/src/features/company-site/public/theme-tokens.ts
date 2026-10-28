import { adjustedBrandColor, adjustedColorOn, contrastRatio, darkBackground, readableOn } from "../brand";

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
export function siteBrandTokens(brand: string, accent: string | null = null, background: string | null = null): Record<string, string> {
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
  // Keep the complete old token object (and inherited surfaces) byte-for-byte
  // for existing sites. CSS aliases fall back to those original semantic tokens.
  if (accent === null && background === null) return tokens;
  for (const theme of ["light", "dark"] as const) {
    const defaults = SITE_THEME_SURFACES[theme];
    const page = background === null ? defaults.page : theme === "light" ? background : darkBackground(background);
    const pole = readableOn(page);
    // A very dark custom *light* page cannot share AA ink with a white card.
    const card = contrastRatio(pole, defaults.card) >= 4.5 ? defaults.card : pole === "#FFFFFF" ? "#15121F" : "#FFFFFF";
    const band = adjustedBrandColor(brandBand(tokens[`--site-brand-${theme}`], page), pole).color;
    const muted = background === null ? theme === "light" ? "#F1EEF7" : "#171226" : card;
    const surfaces = [page, card, band, muted];
    const brandFill = background === null ? tokens[`--site-brand-${theme}`] : adjustedColorOn(brand, surfaces).color;
    const accentFill = accent === null ? brandFill : adjustedColorOn(accent, surfaces).color;
    const bannerAccent = accent === null ? readableOn(brandFill) : adjustedBrandColor(accent, brandFill).color;
    const values = {
      page, card, band, muted,
      brand: brandFill, "on-brand": readableOn(brandFill),
      "brand-text": adjustedColorOn(brandFill, surfaces).color,
      accent: accentFill, "on-accent": readableOn(accentFill),
      "banner-accent": bannerAccent, "on-banner-accent": accent === null ? brandFill : readableOn(bannerAccent),
      foreground: adjustedColorOn(theme === "light" ? "#1A1626" : "#F6F2FF", surfaces).color,
      secondary: adjustedColorOn(theme === "light" ? "#6B6480" : "#A79FBF", surfaces).color,
      ring: adjustedColorOn(brandFill, surfaces, 3).color,
    };
    for (const [role, value] of Object.entries(values)) tokens[`--site-${role}-${theme}`] = value;
  }
  return tokens;
}
