import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Vitest runs from frontend/, so cwd-relative paths keep the assertions stable.
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

// Every @font-face body in the stylesheet, in source order. The face for the
// heading role is asserted below so the declared family can never become an
// unresolved reference to a face nobody ships.
const fontFaceBlocks = [...css.matchAll(/@font-face\s*\{([^}]*)\}/gu)].map(
  (match) => match[1],
);

function cssBlock(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(
    start,
    `expected a ${selector} block in globals.css`,
  ).toBeGreaterThanOrEqual(0);
  const end = css.indexOf("}", start);
  return css.slice(start, end);
}

// Approved palette contract: design/screens/assets/base.css reference tokens,
// consumed exactly (base, surface, surface2, elevated, line, ink, muted). The
// mapping into the shadcn semantic variables is documented in globals.css and
// asserted here so neither side can drift silently:
//
//   reference --base      -> --background           (page foundation)
//   reference --ink       -> --foreground           (+ *-foreground roles)
//   reference --surface   -> --card
//   reference --elevated  -> --popover
//   reference --surface2  -> --secondary / --muted / --accent
//   reference --line      -> --border / --input
//   reference --muted     -> --muted-foreground
//   reference --top-glow-alpha    -> --pf-glow-alpha
//   reference --grid-dot-alpha    -> --pf-grid-dot-alpha
//
// The violet accent family (primary, primary-foreground) is the configured
// preset identity and stays untouched; chart tokens stay neutral.
const REFERENCE_LIGHT = {
  base: "#F7F5FB",
  surface: "#FFFFFF",
  surface2: "#F1EEF7",
  elevated: "#FFFFFF",
  line: "#E4DFF0",
  ink: "#1A1626",
  muted: "#6B6480",
};

const REFERENCE_DARK = {
  base: "#0C0912",
  surface: "#15121F",
  surface2: "#171226",
  elevated: "#1A1626",
  line: "#262233",
  ink: "#F6F2FF",
  muted: "#A79FBF",
};

function expectBlockTokens(
  block: string,
  label: string,
  palette: typeof REFERENCE_LIGHT,
) {
  expect(block, `${label} background`).toContain(
    `--background: ${palette.base}`,
  );
  expect(block, `${label} foreground`).toContain(
    `--foreground: ${palette.ink}`,
  );
  expect(block, `${label} card`).toContain(`--card: ${palette.surface}`);
  expect(block, `${label} card foreground`).toContain(
    `--card-foreground: ${palette.ink}`,
  );
  expect(block, `${label} popover`).toContain(`--popover: ${palette.elevated}`);
  expect(block, `${label} popover foreground`).toContain(
    `--popover-foreground: ${palette.ink}`,
  );
  expect(block, `${label} secondary`).toContain(
    `--secondary: ${palette.surface2}`,
  );
  expect(block, `${label} secondary foreground`).toContain(
    `--secondary-foreground: ${palette.ink}`,
  );
  expect(block, `${label} muted`).toContain(`--muted: ${palette.surface2}`);
  expect(block, `${label} muted foreground`).toContain(
    `--muted-foreground: ${palette.muted}`,
  );
  expect(block, `${label} accent`).toContain(`--accent: ${palette.surface2}`);
  expect(block, `${label} accent foreground`).toContain(
    `--accent-foreground: ${palette.ink}`,
  );
  expect(block, `${label} border`).toContain(`--border: ${palette.line}`);
  expect(block, `${label} input`).toContain(`--input: ${palette.line}`);
}

describe("globals.css foundation tokens", () => {
  it("keeps the Tailwind v4 semantic token mapping", () => {
    expect(css).toContain('@import "tailwindcss"');
    expect(css).toContain("@theme inline");
    expect(css).toContain("--color-background: var(--background)");
    expect(css).toContain("--font-sans: var(--font-sans)");
  });

  it("documents the approved reference palette source", () => {
    // The reconciliation must name its authority so future edits know the
    // contract instead of silently drifting.
    expect(css).toContain("design/screens/assets/base.css");
  });

  it("defines light semantic tokens from the approved reference palette", () => {
    const root = cssBlock(":root");
    expectBlockTokens(root, "light", REFERENCE_LIGHT);
    // Preset identity (violet accent family, radius, focus ring) is preserved.
    expect(root).toContain("--primary: oklch(0.491 0.27 292.581)");
    expect(root).toContain("--primary-foreground: oklch(0.969 0.016 293.756)");
    expect(root).toContain("--radius: 0.625rem");
    expect(root).toContain("--ring:");
    // Reference ambient intensities for the light scheme.
    expect(root).toContain("--pf-glow-alpha: 0.12");
    expect(root).toContain("--pf-grid-dot-alpha: 0.07");
  });

  it("defines dark semantic tokens from the approved reference palette", () => {
    const dark = cssBlock(".dark");
    expectBlockTokens(dark, "dark", REFERENCE_DARK);
    // Preset identity (dark violet accent family) is preserved.
    expect(dark).toContain("--primary: oklch(0.432 0.232 292.759)");
    // Reference ambient intensities for the dark scheme.
    expect(dark).toContain("--pf-glow-alpha: 0.22");
    expect(dark).toContain("--pf-grid-dot-alpha: 0.11");
  });

  it("activates the approved dark palette from system preference without a toggle", () => {
    const mediaStart = css.indexOf("@media (prefers-color-scheme: dark)");
    expect(mediaStart).toBeGreaterThanOrEqual(0);
    const media = css.slice(mediaStart);
    expect(media).toContain("--background: #0C0912");
    expect(media).toContain("--pf-glow-alpha: 0.22");
    expect(media).toContain("--pf-grid-dot-alpha: 0.11");
  });

  it("keeps a visible safe focus ring", () => {
    expect(css).toContain("--ring:");
    expect(css).toContain("outline-ring");
  });

  it("applies Inter to the body and Clash Display to headings with an Inter fallback", () => {
    expect(css).toContain('--font-heading: "Clash Display", var(--font-sans)');
    expect(css).toContain("--font-sans: var(--font-sans)");
    expect(css).toMatch(/html\s*{\s*@apply font-sans/);
  });

  it("keeps chart tokens neutral and the destructive token untouched", () => {
    const root = cssBlock(":root");
    expect(root).toContain("--chart-1: oklch(0.87 0 0)");
    expect(root).toContain("--chart-5: oklch(0.269 0 0)");
    expect(root).toContain("--destructive: oklch(0.577 0.245 27.325)");
  });
});

describe("public heading font", () => {
  const WEIGHTS = ["500", "600", "700"];

  it("registers the licensed Clash Display weights from local woff2 assets", () => {
    expect(fontFaceBlocks).toHaveLength(WEIGHTS.length);
    fontFaceBlocks.forEach((block, index) => {
      const weight = WEIGHTS[index];
      expect(block, `weight ${weight} family`).toContain(
        'font-family: "Clash Display"',
      );
      expect(block, `weight ${weight} source`).toContain(
        `url("/fonts/clash-display-${weight}.woff2") format("woff2")`,
      );
      expect(block, `weight ${weight} weight`).toContain(
        `font-weight: ${weight}`,
      );
      expect(block, `weight ${weight} style`).toContain("font-style: normal");
      expect(block, `weight ${weight} display`).toContain("font-display: swap");
    });
  });

  it("lets the declared heading token resolve against that family", () => {
    // The registered family name is exactly the one --font-heading asks for.
    expect(css).toContain('--font-heading: "Clash Display", var(--font-sans)');
    expect(css).toContain("--font-sans: var(--font-sans)");
  });

  it("keeps every font source local with no remote font dependency", () => {
    const fontUrls = [...css.matchAll(/url\(([^)]*)\)/gu)].map((match) =>
      match[1].trim().replace(/^["']|["']$/gu, ""),
    );
    expect(fontUrls).toHaveLength(WEIGHTS.length);
    for (const url of fontUrls)
      expect(url).toMatch(/^\/fonts\/clash-display-\d{3}\.woff2$/u);
    // No hosted stylesheet, CDN reference, or remote face may be reintroduced.
    expect(css).not.toMatch(/https?:\/\//u);
    expect(css).not.toMatch(/@import\s+(url\()?["']?https?:/u);
    expect(css).not.toMatch(/fontshare|googleapis|gstatic|cdn\./iu);
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
