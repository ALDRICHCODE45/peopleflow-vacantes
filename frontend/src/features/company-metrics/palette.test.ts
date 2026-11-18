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
});
