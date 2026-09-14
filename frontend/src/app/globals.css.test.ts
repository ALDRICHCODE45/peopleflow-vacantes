import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Vitest runs from frontend/, so cwd-relative paths keep the assertions stable.
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function cssBlock(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(
    start,
    `expected a ${selector} block in globals.css`,
  ).toBeGreaterThanOrEqual(0);
  const end = css.indexOf("}", start);
  return css.slice(start, end);
}

describe("globals.css foundation tokens", () => {
  it("keeps the Tailwind v4 semantic token mapping", () => {
    expect(css).toContain('@import "tailwindcss"');
    expect(css).toContain("@theme inline");
    expect(css).toContain("--color-background: var(--background)");
    expect(css).toContain("--font-sans: var(--font-sans)");
  });

  it("defines light semantic tokens matching preset b27M1Ev2", () => {
    const root = cssBlock(":root");
    expect(root).toContain("--background: oklch(1 0 0)"); // Neutral base
    expect(root).toContain("--primary: oklch(0.491 0.27 292.581)"); // Violet theme
    expect(root).toContain("--radius: 0.625rem"); // Default radius
    expect(root).toContain("--ring:");
  });

  it("defines dark semantic tokens", () => {
    const dark = cssBlock(".dark");
    expect(dark).toContain("--background: oklch(0.145 0 0)");
    expect(dark).toContain("--primary: oklch(0.432 0.232 292.759)");
  });

  it("activates dark tokens from system preference without a toggle", () => {
    const mediaStart = css.indexOf("@media (prefers-color-scheme: dark)");
    expect(mediaStart).toBeGreaterThanOrEqual(0);
    const media = css.slice(mediaStart);
    expect(media).toContain("--background: oklch(0.145 0 0)");
  });

  it("keeps a visible safe focus ring", () => {
    expect(css).toContain("--ring:");
    expect(css).toContain("outline-ring");
  });

  it("applies Inter typography to headings and body", () => {
    expect(css).toContain("--font-heading: var(--font-sans)");
    expect(css).toMatch(/html\s*{\s*@apply font-sans/);
  });
});

describe("ambient depth for the public vacancy list", () => {
  it("defines per-scheme ambient intensity tokens without touching preset identity", () => {
    const root = cssBlock(":root");
    expect(root).toContain("--pf-glow-alpha:");
    expect(root).toContain("--pf-grid-dot-alpha:");

    const mediaStart = css.indexOf("@media (prefers-color-scheme: dark)");
    expect(mediaStart).toBeGreaterThanOrEqual(0);
    const media = css.slice(mediaStart);
    expect(media).toContain("--pf-glow-alpha:");
    expect(media).toContain("--pf-grid-dot-alpha:");
  });

  it("drives the static top glow and masked dot grid from the semantic primary token", () => {
    const glow = cssBlock(".pf-top-glow");
    expect(glow).toContain("var(--primary)");
    expect(glow).toContain("radial-gradient");

    const grid = cssBlock(".pf-dot-grid");
    expect(grid).toContain("var(--primary)");
    expect(grid).toContain("radial-gradient");
    expect(grid).toContain("mask-image");
  });
});
