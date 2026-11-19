import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DELIVERY_TONE } from "./palette";

const css = readFileSync(resolve(__dirname, "../../app/globals.css"), "utf8");
/** The declarations of every rule whose selector is exactly `selector`, joined. */
const block = (selector: string) => {
  const parts: string[] = [];
  for (let start = css.indexOf(`${selector} {`); start >= 0; start = css.indexOf(`${selector} {`, start + 1)) parts.push(css.slice(start, css.indexOf("}", start)));
  return parts.join("\n");
};

describe("delivery palette (rule 9)", () => {
  it("paints «Tarde» with its own token, a light violet that stays visible on the near-black card in dark mode", () => {
    expect(DELIVERY_TONE.late).toBe("var(--pf-tone-late)");
    expect(block("\n:root")).toContain("--pf-tone-late: color-mix(in oklab, var(--primary) 45%, var(--pf-tint-base));");
    // Dark --primary is a deep fill: «Tarde» mixes the brand strong tone (the violet text token) instead.
    const dark = "--pf-tone-late: color-mix(in oklab, var(--brand-decorative-strong) 70%, var(--card));";
    expect(block("\n.dark")).toContain(dark);
    expect(block("  :root:not([data-theme])")).toContain(dark);
  });

  it("paints «A tiempo» with its own token: --primary in light, a ≥ 3:1 brand tone on the dark card (legend dot, segments)", () => {
    expect(DELIVERY_TONE.on_time).toBe("var(--pf-tone-on-time)");
    expect(block("\n:root")).toContain("--pf-tone-on-time: var(--primary);");
    const dark = "--pf-tone-on-time: var(--brand-decorative-strong);";
    expect(block("\n.dark")).toContain(dark);
    expect(block("  :root:not([data-theme])")).toContain(dark);
    const strong = /--brand-decorative-strong: oklch\(([\d.]+) ([\d.]+) ([\d.]+)\);/.exec(block("\n.dark"))!;
    const card = /--card: #([0-9A-Fa-f]{6});/.exec(block("\n.dark"))!;
    expect(contrast(oklchLuminance(+strong[1], +strong[2], +strong[3]), hexLuminance(card[1]))).toBeGreaterThanOrEqual(3);
  });
});

/** WCAG relative luminance from linear sRGB. */
const luminance = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const hexLuminance = (hex: string) => luminance([0, 2, 4].map(at => {
  const value = parseInt(hex.slice(at, at + 2), 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}));
/** OKLCH → linear sRGB (Björn Ottosson's matrices), clamped to the gamut. */
function oklchLuminance(l: number, c: number, h: number) {
  const a = c * Math.cos((h * Math.PI) / 180), b = c * Math.sin((h * Math.PI) / 180);
  const [l_, m_, s_] = [l + 0.3963377774 * a + 0.2158037573 * b, l - 0.1055613458 * a - 0.0638541728 * b, l - 0.0894841775 * a - 1.291485548 * b].map(v => v ** 3);
  return luminance([
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ].map(v => Math.min(1, Math.max(0, v))));
}
