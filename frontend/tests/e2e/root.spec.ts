import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

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

const BASE_URL = "http://127.0.0.1:3000";

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
  return raw.endsWith("%") ? Number.parseFloat(raw) / 100 : Number.parseFloat(raw);
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
      raw.endsWith("%") ? Number.parseFloat(raw) / 100 : Number.parseFloat(raw) / 255;
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

function relativeLuminance({ r, g, b, alpha }: Rgb): number {
  const linear = (v: number) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  return (
    0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
  ) * alpha;
}

function contrastRatio(foreground: string, background: string): number {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  // Composite the foreground over the background when it carries alpha.
  const blended = fg.alpha < 1
    ? {
        r: fg.r * fg.alpha + bg.r * (1 - fg.alpha),
        g: fg.g * fg.alpha + bg.g * (1 - fg.alpha),
        b: fg.b * fg.alpha + bg.b * (1 - fg.alpha),
        alpha: 1,
      }
    : fg;
  const l1 = relativeLuminance(blended);
  const l2 = relativeLuminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// ---------------------------------------------------------------------------
// Task 2.2 root smoke (preserved).
// ---------------------------------------------------------------------------

test.describe("minimal public root", () => {
  test("renders the shared public shell with one clear vacancy entry point", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.locator("html")).toHaveAttribute("lang", "es-MX");

    const rootHeadings = page.getByRole("heading", { level: 1 });
    await expect(rootHeadings).toHaveCount(1);
    await expect(rootHeadings.first()).not.toBeEmpty();

    const vacantesLinks = page.getByRole("link", { name: /vacantes/i });
    await expect(vacantesLinks).toHaveCount(1);
    await expect(vacantesLinks.first()).toHaveAttribute("href", "/vacantes");

    const hrefs = await page.locator("a").evaluateAll((anchors) =>
      anchors.map((a) => a.getAttribute("href")),
    );
    for (const href of hrefs) {
      expect(["/", "/vacantes"]).toContain(href);
    }

    await expect(page.getByRole("button")).toHaveCount(0);
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

      test(`renders accessible foundation at ${label} width`, async ({ page }) => {
        const requestUrls: string[] = [];
        page.on("request", (request) => requestUrls.push(request.url()));

        await page.goto("/");

        // Unambiguous evidence that this matrix cell runs at its own width.
        expect(page.viewportSize(), `${label} viewport must be exact`).toEqual(
          viewport,
        );

        await expect(page.locator("html")).toHaveAttribute("lang", "es-MX");

        // Exactly one heading and exactly one clear vacancy entry point.
        const h1 = page.getByRole("heading", { level: 1 });
        await expect(h1).toHaveCount(1);
        const vacantesLinks = page.getByRole("link", { name: /vacantes/i });
        await expect(vacantesLinks).toHaveCount(1);
        await expect(vacantesLinks.first()).toHaveAttribute("href", "/vacantes");
        await expect(page.getByRole("button")).toHaveCount(0);

        // No horizontal overflow at either representative width.
        const overflowPx = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        );
        expect(overflowPx).toBeLessThanOrEqual(0);

        // Computed Inter typography for both heading and body roles.
        const styles = await page.evaluate(() => {
          const computed = (el: Element) => getComputedStyle(el);
          const h1El = document.querySelector("h1");
          const vacantesLink = [...document.querySelectorAll("a")].find(
            (a) => a.getAttribute("href") === "/vacantes",
          );
          // One PeopleFlow mark per color scheme; measure the visible one.
          const logo =
            [...document.querySelectorAll<HTMLImageElement>("img[alt='PeopleFlow']")].find(
              (img) => getComputedStyle(img).display !== "none",
            ) ?? null;
          return {
            bodyFont: computed(document.body).fontFamily,
            h1Font: h1El ? computed(h1El).fontFamily : null,
            bodyColor: computed(document.body).color,
            bodyBackground: computed(document.body).backgroundColor,
            linkColor: vacantesLink ? computed(vacantesLink).color : null,
            linkBackground: vacantesLink
              ? computed(vacantesLink).backgroundColor
              : null,
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
        expect(styles.h1Font).toMatch(/Inter/);
        expect(styles.h1Font).toBe(styles.bodyFont);

        // Semantic WCAG AA contrast for body text and the vacancy entry point.
        expect(
          contrastRatio(styles.bodyColor, styles.bodyBackground),
          `body text contrast (${styles.bodyColor} on ${styles.bodyBackground})`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(styles.linkColor as string, styles.linkBackground as string),
          `vacantes link contrast (${styles.linkColor} on ${styles.linkBackground})`,
        ).toBeGreaterThanOrEqual(4.5);

        // Approved brand marks keep reserved, exact dimensions.
        expect(styles.logo).not.toBeNull();
        expect(styles.logo?.width).toBe("1584");
        expect(styles.logo?.height).toBe("396");
        expect(styles.logo?.naturalWidth).toBe(1584);
        expect(styles.logo?.naturalHeight).toBe(396);
        expect(styles.logo?.renderedHeight).toBeCloseTo(32, 0);
        expect(styles.logo?.renderedRatio).toBeCloseTo(4, 1);

        // Visible keyboard focus on the /vacantes entry point itself.
        await page.getByRole("link", { name: /vacantes/i }).focus();
        const focus = await page.evaluate(() => {
          const el = document.activeElement as HTMLAnchorElement | null;
          if (!el) return null;
          const s = getComputedStyle(el);
          return {
            href: el.getAttribute("href"),
            outlineStyle: s.outlineStyle,
            outlineWidth: s.outlineWidth,
          };
        });
        expect(focus).not.toBeNull();
        expect(focus?.href).toBe("/vacantes");
        expect(focus?.outlineStyle).not.toBe("none");
        expect(Number.parseFloat(focus?.outlineWidth ?? "0")).toBeGreaterThan(0);

        // No root API requests: same-origin /api traffic is also rejected.
        for (const url of requestUrls) {
          const parsed = new URL(url);
          expect(
            (parsed.origin === BASE_URL && !parsed.pathname.startsWith("/api")) ||
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
    expect(
      (componentsJson.aliases as Record<string, string>).ui,
    ).toBe("@/components/ui");

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
    const primaryHues = [...css.matchAll(/--primary:\s*oklch\(\s*[\d.]+\s+[\d.]+\s+([\d.]+)/g)].map(
      (match) => Number.parseFloat(match[1]),
    );
    expect(primaryHues.length).toBeGreaterThanOrEqual(2);
    for (const hue of primaryHues) {
      expect(hue).toBeGreaterThan(280);
      expect(hue).toBeLessThan(310);
    }

    // Neutral chart tokens: zero chroma across all five stops per scheme block
    // (5 stops × :root + .dark + system-dark media block = 15 declarations).
    const chartStops = [
      ...css.matchAll(/--chart-\d:\s*oklch\(\s*[\d.]+\s+([\d.]+)\s+[\d.]+\s*\)/g),
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
      expect(source, relativePath).not.toMatch(/(?:from|import)\s+["']recharts/i);
      expect(source, relativePath).not.toMatch(
        /(?:DropdownMenu|Menubar|ContextMenu|NavigationMenu)/,
      );
    }
  });

  test("resolved UI output stays under src/components/ui with CLI-owned primitives only", () => {
    const uiDir = join(FRONTEND_ROOT, "src", "components", "ui");
    if (!existsSync(uiDir)) return; // no primitive installed in this slice yet

    const productPattern = /shell|brand|jobs|marketing|feature/i;
    for (const entry of readdirSync(uiDir, { recursive: true })) {
      expect(String(entry), "product file inside src/components/ui").not.toMatch(
        productPattern,
      );
    }
  });
});
