import { readFileSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { assertUiPrimitiveInventory } from "../support/assert-ui-primitive-inventory";

// Task 2.3 TRIANGULATE: the task 2.2 root smoke stays, and the foundation is
// probed again from independent angles: width × color-scheme matrix, axe scans,
// computed Inter typography, WCAG AA contrast, focus visibility, reserved image
// dimensions, exact b27M1Ev2 preset identity, absence of ad hoc raw-color /
// custom-radius / primitive-style overrides, the intentional Recharts 3.x
// dashboard adoption and employer-menu absence, and no root API requests.

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

    // The marketing header owns exactly one Ingresar menu trigger and one
    // persisted theme toggle; the primary CTA stays a non-operational link.
    const nav = page.locator("#nav");
    await expect(
      nav.getByRole("button", { name: "Ingresar", exact: true }),
    ).toHaveCount(1);
    const themeButtons = page.getByRole("button", { name: /cambiar tema/i });
    await expect(themeButtons).toHaveCount(1);
    await expect(themeButtons).toHaveAttribute("data-pf-theme-toggle", "");
    await expect(
      nav.getByRole("link", { name: "Empezar gratis", exact: true }),
    ).toHaveAttribute("href", "#empezar");
  });
});

// ---------------------------------------------------------------------------
// Floating marketing navbar: detached capsule, real destinations, no overflow.
// ---------------------------------------------------------------------------

const NAV_LINK_DESTINATIONS = [
  ["Vacantes", "/vacantes"],
  ["Producto", "#producto"],
  ["Soluciones", "#soluciones"],
  ["Para candidatos", "/candidatos"],
];

const NAV_HASH_DESTINATIONS = [
  ["Producto", "producto"],
  ["Soluciones", "soluciones"],
  ["Empezar gratis", "empezar"],
] as const;

test.describe("floating marketing navbar", () => {
  test("detaches the header into a floating capsule that owns the scrolled state", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");

    const nav = page.locator("#nav");
    const capsule = nav.locator("[data-pf-nav-floating]");
    await expect(capsule).toHaveCount(1);

    // Side/top breathing room with the concentric 16px capsule radius.
    const navBox = (await nav.boundingBox())!;
    const box = (await capsule.boundingBox())!;
    expect(navBox.x).toBe(0);
    expect(box.x).toBeGreaterThanOrEqual(16);
    expect(box.y).toBeGreaterThanOrEqual(8);
    expect(Math.round(box.x + box.width)).toBeLessThanOrEqual(1280 - 16);
    expect(
      await capsule.evaluate((el) => getComputedStyle(el).borderTopLeftRadius),
    ).toBe("16px");

    // The shell stays transparent and lets the capsule paint the surface.
    const transparent = "rgba(0, 0, 0, 0)";
    const background = (target: typeof nav) =>
      target.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await background(nav)).toBe(transparent);
    const resting = await background(capsule);
    expect(resting).not.toBe(transparent);

    // Real destinations only: Precios/Recursos are removed from the DOM.
    const links = await nav
      .locator("ul a")
      .evaluateAll((els) =>
        els.map((el) => [el.textContent?.trim(), el.getAttribute("href")]),
      );
    expect(links).toEqual(NAV_LINK_DESTINATIONS);
    await expect(
      nav.getByRole("link", { name: "Precios", exact: true }),
    ).toHaveCount(0);
    await expect(
      nav.getByRole("link", { name: "Recursos", exact: true }),
    ).toHaveCount(0);

    // Scrolling retargets the backdrop to the capsule while the shell stays
    // pinned, transparent, and the owner of the `scrolled` state class.
    await expect(nav).not.toHaveClass(/scrolled/);
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(nav).toHaveClass(/scrolled/);
    await expect(nav).toHaveCSS("position", "sticky");
    expect(await background(nav)).toBe(transparent);
    // The capsule colour transition settles into the scrolled backdrop.
    await expect.poll(() => background(capsule)).not.toBe(resting);
    expect(Math.round((await nav.boundingBox())!.y)).toBe(0);
  });

  test("drives every marketing navbar destination to a real place", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");

    const nav = page.locator("#nav");
    await expect(
      nav.getByRole("link", { name: "Empezar gratis", exact: true }),
    ).toHaveAttribute("href", "#empezar");

    for (const [label, id] of NAV_HASH_DESTINATIONS) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await nav.getByRole("link", { name: label, exact: true }).click();
      await expect.poll(() => new URL(page.url()).hash).toBe(`#${id}`);

      const navBox = (await nav.boundingBox())!;
      const sectionBox = (await page.locator(`#${id}`).boundingBox())!;
      // The anchored section clears the floating navbar instead of hiding
      // behind it, and it really moved into view.
      expect(
        sectionBox.y,
        `#${id} must not be covered by the floating navbar`,
      ).toBeGreaterThanOrEqual(Math.round(navBox.y + navBox.height) - 1);
      expect(sectionBox.y).toBeGreaterThan(0);
    }

    await page.goto("/");
    await nav.getByRole("link", { name: "Vacantes", exact: true }).click();
    await expect(page).toHaveURL(/\/vacantes$/);
  });

  test("keeps every control inside 375px, with desktop links hidden", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");

    const nav = page.locator("#nav");
    for (const label of ["Vacantes", "Producto", "Soluciones"]) {
      await expect(
        nav.getByRole("link", { name: label, exact: true }),
      ).toBeHidden();
    }
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);

    // Brand, login, theme and CTA stay visible inside the viewport.
    const selectors = [
      "a[aria-label='PeopleFlow']",
      "button[aria-haspopup='menu']",
      "[data-pf-theme-toggle]",
      "a.btn-primary",
    ];
    const controls = await nav.evaluate((el, targets) =>
      targets.map((selector) => {
        const node = el.querySelector(selector);
        if (!node) return null;
        return { selector, ...node.getBoundingClientRect().toJSON() };
      }),
      selectors,
    );
    expect(controls.filter(Boolean)).toHaveLength(4);
    for (const control of controls) {
      if (!control) continue;
      expect(control.width, control.selector).toBeGreaterThan(0);
      expect(control.x, control.selector).toBeGreaterThanOrEqual(0);
      expect(control.right, control.selector).toBeLessThanOrEqual(375);
      expect(control.bottom, control.selector).toBeLessThanOrEqual(812);
    }
  });

  test("gives the marketing navbar an explicit keyboard focus treatment", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");

    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        inNav: Boolean(el.closest("#nav")),
        outlineStyle: s.outlineStyle,
        outlineWidth: s.outlineWidth,
        outlineOffset: s.outlineOffset,
      };
    });
    expect(focus).toEqual({
      inNav: true,
      outlineStyle: "solid",
      outlineWidth: "2px",
      outlineOffset: "2px",
    });
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
        // The marketing header owns exactly one Ingresar menu trigger and one
        // persisted theme toggle at both representative widths.
        const nav = page.locator("#nav");
        await expect(
          nav.getByRole("button", { name: "Ingresar", exact: true }),
        ).toHaveCount(1);
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
        // Scoped to the marketing navbar: the footer repeats the same mark.
        const visibleLogo = page.locator("#nav img[alt='PeopleFlow']:visible");
        await expect(visibleLogo).toHaveJSProperty("naturalWidth", 1584);
        await expect(visibleLogo).toHaveJSProperty("naturalHeight", 396);

        // Computed typography: Inter for body, the licensed Clash Display face
        // for the landing display heading (landing-local font family).
        const styles = await page.evaluate(() => {
          const computed = (el: Element) => getComputedStyle(el);
          const h1El = document.querySelector("h1");
          // One PeopleFlow mark per color scheme inside #nav; measure the
          // visible one (the footer repeats the same mark).
          const logo =
            [
              ...document.querySelectorAll<HTMLImageElement>(
                "#nav img[alt='PeopleFlow']",
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

        // Wait for the reveal island to hydrate first: `pf-motion-ready` is
        // added in the same effect that attaches the observer, so the walk
        // cannot race past sections that would then never be observed.
        await expect
          .poll(async () =>
            page.evaluate(
              () =>
                document
                  .querySelector("[data-pf-reference-landing]")
                  ?.classList.contains("pf-motion-ready") ?? false,
            ),
          )
          .toBe(true);

        // The reveal-on-scroll island mounts asynchronously and paints every
        // `.reveal` section at opacity 0 until its IntersectionObserver
        // (threshold 0.14) marks it `in`. Axe skips content that is still
        // hidden, so the scan must run on the fully revealed page. Walk every
        // `.reveal` into view (two animation frames per stop so the observer
        // callback is processed before scrolling on), then poll until the
        // lifecycle has settled: at least one `.reveal` exists and every
        // `.reveal` under the landing root carries class `in` with computed
        // opacity exactly 1. No fixed sleeps, no scan-time hiding, and no axe
        // exclusions.
        await page.evaluate(async () => {
          const nextFrame = () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => resolve(null)),
            );
          const root = document.querySelector("[data-pf-reference-landing]");
          const reveals = Array.from(root?.querySelectorAll(".reveal") ?? []);
          for (const reveal of reveals) {
            reveal.scrollIntoView({ block: "center" });
            await nextFrame();
            await nextFrame();
          }
          window.scrollTo(0, 0);
          await nextFrame();
        });

        await expect
          .poll(async () =>
            page.evaluate(() => {
              const root = document.querySelector(
                "[data-pf-reference-landing]",
              );
              if (!root || !root.classList.contains("pf-motion-ready")) {
                return false;
              }
              const reveals = Array.from(root.querySelectorAll(".reveal"));
              if (reveals.length === 0) {
                return false;
              }
              return reveals.every(
                (element) =>
                  element.classList.contains("in") &&
                  getComputedStyle(element).opacity === "1",
              );
            }),
          )
          .toBe(true);

        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa"])
          .analyze();
        expect(results.violations).toEqual([]);
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Marketing login menu: one trigger, two real destinations, real focus.
// ---------------------------------------------------------------------------

const MARKETING_MENU_DESTINATIONS = [
  ["Candidato", "/candidato/login"],
  ["Empresa", "/empresa/login"],
] as const;

for (const [label, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`marketing login menu — ${label} viewport`, () => {
    test.use({ viewport });

    test(`opens exactly the two login destinations at ${label} width`, async ({ page }) => {
      const runtimeErrors: string[] = [];
      page.on("pageerror", (error) => runtimeErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") runtimeErrors.push(message.text());
      });

      await page.goto("/");
      // Realistic hydration: document load, bounded network idle, one beat.
      await page.waitForLoadState("load");
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(100);

      const trigger = page.locator("#nav").getByRole("button", { name: "Ingresar", exact: true });
      await expect(trigger).toHaveCount(1);

      // Exactly one non-retried click opens the popup.
      await trigger.click();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");

      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();
      await expect(menu.getByRole("menuitem")).toHaveCount(2);
      for (const [name, href] of MARKETING_MENU_DESTINATIONS) {
        await expect(
          menu.getByRole("menuitem", { name, exact: true }),
        ).toHaveAttribute("href", href);
      }

      // The open popup stays inside the viewport and adds no overflow.
      const overflowPx = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflowPx).toBeLessThanOrEqual(0);
      const popup = (await menu.boundingBox())!;
      expect([
        popup.x >= 0,
        Math.round(popup.x + popup.width) <= viewport.width,
        Math.round(popup.y + popup.height) <= viewport.height,
      ]).toEqual([true, true, true]);

      // Escape closes with focus return; the keyboard reopens without leaving.
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(menu).toBeVisible();
      await expect(menu.getByRole("menuitem")).toHaveCount(2);
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();

      // The interaction never left the root route or logged a runtime error.
      expect(new URL(page.url()).pathname).toBe("/");
      expect(runtimeErrors).toEqual([]);
    });
  });
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
    // Recharts 3.x is intentionally adopted by the employer dashboard charts;
    // this preset slice pins that adopted major instead of forbidding charts.
    expect(deps.recharts).toMatch(/^3\./);
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
