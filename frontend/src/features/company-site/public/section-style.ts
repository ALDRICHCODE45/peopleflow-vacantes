import type { SectionStyle, SiteBlock, SiteBlockV2 } from "../model";

/** Scrim ink for text over photos: the `--pf-hero-scrim` hue (oklch .14 .02 292) as sRGB. */
export const SITE_SCRIM = "#140F1F";
/** Every level keeps white text ≥ 4.5:1 even over a pure white photo (sRGB blending
 * needs α ≥ 0.58 with this ink; tested). The design's 0.36/0.50 levels could not
 * guarantee that, so the curated levels start at 0.6. */
export const SCRIM_ALPHA = { soft: 0.6, medium: 0.7, strong: 0.8 } as const satisfies Record<NonNullable<SectionStyle["overlay"]>, number>;
export const scrimColor = (overlay: SectionStyle["overlay"]) => `rgb(20 15 31 / ${SCRIM_ALPHA[overlay ?? "medium"]})`;

/** The surface a section paints: the legacy alternating band, the stronger brand tint, the
 * brand fill, the dark photo scrim, or the page. «Tinte suave» never reuses the band, so it
 * stays distinct from «Normal» on sections that sit on the band by default. */
export type SectionSurface = "band" | "tint" | "brand" | "scrim" | null;

/** Bands the legacy presentation hard-coded per type/layout; kept for the default style. */
function legacyBand(block: SiteBlock | SiteBlockV2): boolean {
  return block.type === "story" || block.type === "jobs" || block.type === "stats" && block.variant === "row"
    || block.type === "benefits" && block.variant === "grid" || block.type === "video" && block.variant === "split";
}

export function sectionSurface(block: SiteBlockV2): SectionSurface {
  switch (block.style.background) {
    case "tint": return "tint";
    case "brand": return "brand";
    case "image": return "scrim";
    default: return legacyBand(block) ? "band" : block.type === "stats" && block.variant === "brand_band" ? "brand" : null;
  }
}

/** Alignment a layout always renders with, whatever the style says (null: it follows the
 * section's «Alineación»). The editor shows these as fixed instead of offering a choice that
 * would change nothing, and the page renders headings with the same value. */
export function fixedSectionAlign(block: SiteBlockV2): SectionStyle["align"] | null {
  if (block.type === "closing") return "center";
  // Designed centred in 02: the brand band of figures and the large-icon cards.
  if (block.type === "stats" && block.variant === "brand_band" || (block.type === "benefits" || block.type === "values") && block.variant === "big_icons") return "center";
  if (block.type === "hero") return block.variant === "photo" || block.variant === "centered" ? "center" : block.variant === "background_loop" ? null : "start";
  return null;
}
/** The alignment a section actually renders with. */
export const sectionAlign = (block: SiteBlockV2): SectionStyle["align"] => fixedSectionAlign(block) ?? block.style.align;

/** Compact trims the vertical rhythm; airy is the legacy spacing. */
export const sectionInnerClass = (spacing: SectionStyle["spacing"]) => spacing === "compact"
  ? "mx-auto max-w-7xl px-6 py-6 sm:px-10 sm:py-8 lg:px-16 lg:py-10"
  : "mx-auto max-w-7xl px-6 py-10 sm:px-10 sm:py-14 lg:px-16 lg:py-16";

/** Photo area cards keep their label in the lower part, where this gradient stays at α ≥ 0.69. */
export const AREA_PHOTO_SCRIM = "linear-gradient(to top, rgb(20 15 31 / 0.85), rgb(20 15 31 / 0.7) 55%, rgb(20 15 31 / 0.4))";
