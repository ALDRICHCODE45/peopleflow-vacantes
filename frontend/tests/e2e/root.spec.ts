import { readFileSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { assertUiPrimitiveInventory } from "../support/assert-ui-primitive-inventory";

// Task 2.3 TRIANGULATE: the task 2.2 root smoke stays, and the foundation is
// probed again from independent angles: width × color-scheme matrix, axe scans,
// computed Inter typography, WCAG AA contrast, focus visibility, reserved image
// dimensions, exact b27M1Ev2 preset identity, absence of ad hoc raw-color /
// custom-radius / primitive-style overrides, absence of charts and employer
// menus, and absence of root API requests.

const FRONTEND_ROOT = process.cwd();

function readFrontendFile(relativePath: string): string {
  return readFileSync(join(FRONTEND_ROOT, relativePath), "utf8");
}

// Handwritten composition files owned by this foundation slice.
const COMPOSITION_FILES = [
  "src/app/layout.tsx",
  "src/app/(marketing)/page.tsx",
  "src/components/brand/logo.tsx",
  "src/components/shells/PublicShell.tsx",
] as const;

const BASE_URL = process.env.PLAYWRIGHT_APP_ORIGIN ?? "http://127.0.0.1:3100";

const VIEWPORTS = {
  desktop: { width: 1280, height: 720 },
  mobile: { width: 375, height: 812 },
} as const;

const SCHEMES = ["light", "dark"] as const;

// ---------------------------------------------------------------------------
// WCAG contrast helpers (oklch / sRGB computed styles → contrast ratio).
// ---------------------------------------------------------------------------

type Rgb = { r: number; g: number; b: number; alpha: number };

function gammaEncode(linear: number): number {
  const c = Math.min(1, Math.max(0, linear));
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

function oklchToSrgb(L: number, C: number, H: number): Rgb {
  const rad = (H * Math.PI) / 180;
  const a = C * Math.cos(rad);
  const b = C * Math.sin(rad);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return {
    r: gammaEncode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: gammaEncode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: gammaEncode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    alpha: 1,
  };
}

function parseAlpha(raw: string | undefined): number {
  if (!raw) return 1;
  return raw.endsWith("%")
    ? Number.parseFloat(raw) / 100
    : Number.parseFloat(raw);
}

function parseColor(input: string): Rgb {
  const value = input.trim();

  const oklch = value.match(
    /^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+%?))?\s*\)$/i,
  );
  if (oklch) {
    const L = oklch[1].endsWith("%")
      ? Number.parseFloat(oklch[1]) / 100
      : Number.parseFloat(oklch[1]);
    const color = oklchToSrgb(
      L,
      Number.parseFloat(oklch[2]),
      Number.parseFloat(oklch[3]),
    );
    return { ...color, alpha: parseAlpha(oklch[4]) };
  }

  const rgb = value.match(
    /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/i,
  );
  if (rgb) {
    const part = (raw: string) =>
      raw.endsWith("%")
        ? Number.parseFloat(raw) / 100
        : Number.parseFloat(raw) / 255;
    return {
      r: part(rgb[1]),
      g: part(rgb[2]),
      b: part(rgb[3]),
      alpha: parseAlpha(rgb[4]),
    };
  }

  const srgb = value.match(
    /^color\(\s*srgb\s+([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+%?)\s*(?:\/\s*([\d.]+%?))?\s*\)$/i,
  );
  if (srgb) {
    const part = (raw: string) =>
      raw.endsWith("%") ? Number.parseFloat(raw) / 100 : Number.parseFloat(raw);
    return {
      r: part(srgb[1]),
      g: part(srgb[2]),
      b: part(srgb[3]),
      alpha: parseAlpha(srgb[4]),
    };
  }

  throw new Error(`Unparsable computed color: "${value}"`);
}

function compositeOver(top: Rgb, bottom: Rgb): Rgb {
  if (top.alpha >= 1) return top;
  return {
    r: top.r * top.alpha + bottom.r * (1 - top.alpha),
    g: top.g * top.alpha + bottom.g * (1 - top.alpha),
    b: top.b * top.alpha + bottom.b * (1 - top.alpha),
    alpha: 1,
  };
}

function relativeLuminance({ r, g, b, alpha }: Rgb): number {
  const linear = (v: number) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  return (0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)) * alpha;
}

function contrastRatioRgb(fg: Rgb, bg: Rgb): number {
  // Composite the foreground over the background when it carries alpha.
  const blended = compositeOver(fg, bg);
  const l1 = relativeLuminance(blended);
  const l2 = relativeLuminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function contrastRatio(foreground: string, background: string): number {
  return contrastRatioRgb(parseColor(foreground), parseColor(background));
}

// ---------------------------------------------------------------------------
// Task 2.2 root smoke (preserved).
// ---------------------------------------------------------------------------

test.describe("minimal public root", () => {
  test("renders the scoped reference landing with one hero heading", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.locator("html")).toHaveAttribute("lang", "es-MX");

    const rootHeadings = page.getByRole("heading", { level: 1 });
    await expect(rootHeadings).toHaveCount(1);
    await expect(rootHeadings.first()).toHaveText(
      /Publica\.?\s*Recibe\.?\s*Contrata\./,
    );

    // The landing is scoped so its marketing stylesheet cannot leak into the
    // candidate/auth routes.
    await expect(page.locator("[data-pf-reference-landing]")).toHaveCount(1);

    // Reference links are non-operational prototype placeholders ("#") plus
    // the real brand route; every anchor stays addressable.
    const hrefs = await page
      .locator("a")
      .evaluateAll((anchors) => anchors.map((a) => a.getAttribute("href")));
    expect(hrefs.length).toBeGreaterThan(10);
    for (const href of hrefs) {
      expect(href).not.toBeNull();
    }

    // The single header control is the real persisted theme toggle.
    const themeButtons = page.getByRole("button", { name: /cambiar tema/i });
    await expect(themeButtons).toHaveCount(1);
    await expect(themeButtons).toHaveAttribute("data-pf-theme-toggle", "");
  });
});

// ---------------------------------------------------------------------------
// Width × color-scheme matrix: typography, contrast, focus, images, requests.
// ---------------------------------------------------------------------------

for (const scheme of SCHEMES) {
  for (const [label, viewport] of Object.entries(VIEWPORTS)) {
    // One describe per matrix cell: Playwright use-options are describe-
    // scoped, so each viewport must own its own test.use declaration.
    test.describe(`root foundation matrix — ${scheme} scheme, ${label} viewport`, () => {
      test.use({ colorScheme: scheme, viewport });

      test(`renders accessible foundation at ${label} width`, async ({
        page,
      }) => {
        const requestUrls: string[] = [];
        page.on("request", (request) => requestUrls.push(request.url()));

        await page.goto("/");

        // Unambiguous evidence that this matrix cell runs at its own width.
        expect(page.viewportSize(), `${label} viewport must be exact`).toEqual(
          viewport,
        );

        await expect(page.locator("html")).toHaveAttribute("lang", "es-MX");

        // Exactly one hero heading and one scoped landing root.
        const h1 = page.getByRole("heading", { level: 1 });
        await expect(h1).toHaveCount(1);
        await expect(page.locator("[data-pf-reference-landing]")).toHaveCount(
          1,
        );
        // The single header control is the real persisted theme toggle.
        const themeButtons = page.getByRole("button", {
          name: /cambiar tema/i,
        });
        await expect(themeButtons).toHaveCount(1);
        await expect(themeButtons).toHaveAttribute("data-pf-theme-toggle", "");

        // No horizontal overflow at either representative width.
        const overflowPx = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        );
        expect(overflowPx).toBeLessThanOrEqual(0);

        // Wait for the visible brand asset before reading intrinsic dimensions.
        const visibleLogo = page.locator("img[alt='PeopleFlow']:visible");
        await expect(visibleLogo).toHaveJSProperty("naturalWidth", 1584);
        await expect(visibleLogo).toHaveJSProperty("naturalHeight", 396);

        // Computed typography: Inter for body, the licensed Clash Display face
        // for the landing display heading (landing-local font family).
        const styles = await page.evaluate(() => {
          const computed = (el: Element) => getComputedStyle(el);
          const h1El = document.querySelector("h1");
          // One PeopleFlow mark per color scheme; measure the visible one.
          const logo =
            [
              ...document.querySelectorAll<HTMLImageElement>(
                "img[alt='PeopleFlow']",
              ),
            ].find((img) => getComputedStyle(img).display !== "none") ?? null;
          return {
            bodyFont: computed(document.body).fontFamily,
            h1Font: h1El ? computed(h1El).fontFamily : null,
            bodyColor: computed(document.body).color,
            bodyBackground: computed(document.body).backgroundColor,
            logo: logo
              ? {
                  width: logo.getAttribute("width"),
                  height: logo.getAttribute("height"),
                  naturalWidth: logo.naturalWidth,
                  naturalHeight: logo.naturalHeight,
                  renderedHeight: logo.getBoundingClientRect().height,
                  renderedRatio:
                    logo.getBoundingClientRect().width /
                    logo.getBoundingClientRect().height,
                }
              : null,
          };
        });

        expect(styles.bodyFont).toMatch(/Inter/);
        expect(styles.h1Font).toContain("Clash Display");

        // Semantic WCAG AA contrast for the body text on the page foundation.
        expect(
          contrastRatio(styles.bodyColor, styles.bodyBackground),
          `body text contrast (${styles.bodyColor} on ${styles.bodyBackground})`,
        ).toBeGreaterThanOrEqual(4.5);

        // Approved brand marks keep reserved, exact dimensions at the
        // reference header height (h-6 wordmark, 24px).
        expect(styles.logo).not.toBeNull();
        expect(styles.logo?.width).toBe("1584");
        expect(styles.logo?.height).toBe("396");
        expect(styles.logo?.naturalWidth).toBe(1584);
        expect(styles.logo?.naturalHeight).toBe(396);
        expect(styles.logo?.renderedHeight).toBeCloseTo(28, 0);
        expect(styles.logo?.renderedRatio).toBeCloseTo(4, 1);

        // Visible keyboard focus: Tab moves focus off <body> onto a real
        // interactive element and the focused element shows a visible cue.
        await page.keyboard.press("Tab");
        const focus = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el) return null;
          const s = getComputedStyle(el);
          return {
            tag: el.tagName,
            outlineStyle: s.outlineStyle,
            outlineWidth: s.outlineWidth,
            boxShadow: s.boxShadow,
          };
        });
        expect(focus).not.toBeNull();
        expect(focus?.tag).not.toBe("BODY");
        expect(
          focus?.outlineStyle !== "none" || focus?.boxShadow !== "none",
        ).toBe(true);

        // No root API requests: same-origin /api traffic is rejected. The
        // reference fonts are self-hosted from public/fonts (same origin),
        // so no cross-origin font CDN is allowed either.
        for (const url of requestUrls) {
          const parsed = new URL(url);
          expect(
            (parsed.origin === BASE_URL &&
              !parsed.pathname.startsWith("/api")) ||
              /^(data|blob|about):/.test(parsed.protocol),
            `unexpected request from root: ${url}`,
          ).toBe(true);
        }
      });

      test(`axe finds no WCAG A/AA violations at ${label} width @a11y`, async ({
        page,
      }) => {
        await page.goto("/");
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa"])
          .analyze();
        expect(results.violations).toEqual([]);
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Exact b27M1Ev2 preset identity and absence of ad hoc overrides.
// ---------------------------------------------------------------------------

test.describe("preset b27M1Ev2 triangulation", () => {
  test("project configuration keeps the exact decoded preset identity", () => {
    const componentsJson = JSON.parse(readFrontendFile("components.json"));
    expect(componentsJson.style).toBe("base-rhea"); // Rhea style on Base UI
    expect((componentsJson.tailwind as Record<string, unknown>).baseColor).toBe(
      "neutral",
    );
    expect(componentsJson.iconLibrary).toBe("lucide");
    expect(componentsJson.menuColor).toBe("default");
    expect(componentsJson.menuAccent).toBe("subtle");
    expect((componentsJson.aliases as Record<string, string>).ui).toBe(
      "@/components/ui",
    );

    const tsconfig = JSON.parse(readFrontendFile("tsconfig.json"));
    expect(
      (tsconfig.compilerOptions as Record<string, unknown>).paths,
    ).toMatchObject({ "@/*": ["./src/*"] });

    const pkg = JSON.parse(readFrontendFile("package.json"));
    const deps = {
      ...(pkg.dependencies as Record<string, string>),
      ...(pkg.devDependencies as Record<string, string>),
    };
    expect(deps.tailwindcss).toMatch(/^4\./); // Tailwind CSS v4
    expect(deps["@base-ui/react"]).toEqual(expect.any(String)); // explicit Base UI
    expect(deps["lucide-react"]).toEqual(expect.any(String)); // Lucide icons
    expect(deps.recharts).toBeUndefined(); // no chart library installed
  });

  test("globals.css keeps Violet theme, Neutral chart tokens, and Default radius", () => {
    const css = readFrontendFile("src/app/globals.css");

    // Violet theme: every --primary stop stays in the violet hue range.
    const primaryHues = [
      ...css.matchAll(/--primary:\s*oklch\(\s*[\d.]+\s+[\d.]+\s+([\d.]+)/g),
    ].map((match) => Number.parseFloat(match[1]));
    expect(primaryHues.length).toBeGreaterThanOrEqual(2);
    for (const hue of primaryHues) {
      expect(hue).toBeGreaterThan(280);
      expect(hue).toBeLessThan(310);
    }

    // Neutral chart tokens: zero chroma across all five stops per scheme block
    // (5 stops × :root + .dark + system-dark media block = 15 declarations).
    const chartStops = [
      ...css.matchAll(
        /--chart-\d:\s*oklch\(\s*[\d.]+\s+([\d.]+)\s+[\d.]+\s*\)/g,
      ),
    ];
    expect(chartStops).toHaveLength(15);
    for (const stop of chartStops) {
      expect(Number.parseFloat(stop[1])).toBe(0);
    }

    // Default radius anchor from the preset.
    expect(css).toContain("--radius: 0.625rem");
  });

  test("composition files carry no raw colors, custom radius, or scope-expanding primitives", () => {
    for (const relativePath of COMPOSITION_FILES) {
      const source = readFrontendFile(relativePath);
      expect(source, relativePath).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(source, relativePath).not.toMatch(
        /\[\s*(?:oklch|rgb|hsl|#[0-9a-fA-F])/,
      );
      expect(source, relativePath).not.toMatch(
        /(?:text|bg|border|ring|outline|fill|stroke|shadow|decoration|accent|caret)-\[/,
      );
      expect(source, relativePath).not.toMatch(/rounded-\[/);
      expect(source, relativePath).not.toMatch(
        /(?:from|import)\s+["']recharts/i,
      );
      expect(source, relativePath).not.toMatch(
        /(?:DropdownMenu|Menubar|ContextMenu|NavigationMenu)/,
      );
    }
  });

  test("enforces the required generic UI primitive inventory", () => {
    assertUiPrimitiveInventory(FRONTEND_ROOT);
  });
});
