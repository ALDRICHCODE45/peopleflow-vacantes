import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Task 4.3 TRIANGULATE (user-authorized bounded accessibility evidence subset):
// independent /vacantes browser proof only — axe WCAG A/AA scans per width ×
// color scheme, mobile Base UI Sheet title/Escape/focus-return, visible
// keyboard focus (outline OR ring implementations), horizontal overflow, and
// computed Inter typography plus semantic token ownership (Violet/Neutral,
// Default radius) with no inline/ad hoc style overrides.
//
// Deliberately out of scope (open Task 4.3 proofs): navigation refresh/share,
// full AND/cursor behavior, final-page omission, empty reset activation,
// 5xx/schema/timeout recovery, long-content wrapping, reduced motion.

const VIEWPORTS = {
  desktop: { width: 1280, height: 720 },
  mobile: { width: 375, height: 812 },
} as const;

const SCHEMES = ["light", "dark"] as const;

function documentOverflowPx(page: import("@playwright/test").Page) {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

type FocusStyles = {
  outlineStyle: string;
  outlineWidth: string;
  boxShadow: string;
};

function hasVisibleOutline(styles: FocusStyles): boolean {
  return (
    styles.outlineStyle !== "none" &&
    Number.parseFloat(styles.outlineWidth || "0") > 0
  );
}

function hasVisibleRing(styles: FocusStyles): boolean {
  if (styles.boxShadow === "none") return false;
  // Chromium serializes shadow color components as rgba(), hex, or modern
  // oklab()/oklch()/color() syntax depending on the authored color space.
  const colors = styles.boxShadow.match(
    /(?:rgba?\([^)]*\))|(?:#[0-9a-fA-F]{3,8})|(?:oklab\([^)]*\))|(?:oklch\([^)]*\))|(?:color\([^)]*\))/g,
  );
  if (!colors) return false;
  return colors.some((color) => {
    if (/^rgba\(0, 0, 0, 0\)$/.test(color)) return false;
    const alpha =
      color.match(/\/\s*([\d.]+)\s*\)$/) ?? color.match(/,\s*([\d.]+)\s*\)$/);
    if (!alpha) return true; // opaque color without an explicit alpha
    return Number.parseFloat(alpha[1]) > 0;
  });
}

test.describe("vacancy list axe WCAG A/AA matrix", () => {
  for (const scheme of SCHEMES) {
    for (const [label, viewport] of Object.entries(VIEWPORTS)) {
      test.describe(`${scheme} scheme, ${label} width`, () => {
        test.use({ colorScheme: scheme, viewport });

        test(`axe reports no WCAG A/AA violations at ${label} width in ${scheme} scheme @a11y`, async ({
          page,
        }) => {
          await page.goto("/vacantes");
          expect(page.viewportSize()).toEqual(viewport);
          const results = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa"])
            .analyze();
          expect(results.violations).toEqual([]);
        });
      });
    }
  }
});

test.describe("mobile filters Sheet accessibility", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("titled Sheet closes on Escape, returns focus, and never overflows", async ({
    page,
  }) => {
    await page.goto("/vacantes");
    const trigger = page.getByRole("button", { name: /filtros/i });
    await trigger.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveAccessibleName(/filtros/i);
    await expect(dialog.locator('[data-slot="sheet-title"]')).toHaveText(
      "Filtros",
    );
    await expect(dialog.getByLabel(/moneda/i)).toBeVisible();

    // The open Sheet must not introduce horizontal overflow, and the popup
    // itself must stay inside the mobile viewport. The dialog role sits on the
    // sheet-content popup element itself, so locate it from the page root; the
    // entry transition (translate-x start style) must settle before measuring.
    expect(await documentOverflowPx(page)).toBeLessThanOrEqual(0);
    const popup = page.locator('[data-slot="sheet-content"]');
    await expect
      .poll(
        async () => {
          const box = await popup.boundingBox();
          return box ? box.x + box.width : Number.POSITIVE_INFINITY;
        },
        { timeout: 5_000 },
      )
      .toBeLessThanOrEqual(375 + 0.5);
    const popupBox = await popup.boundingBox();
    expect(popupBox).not.toBeNull();
    expect(popupBox!.x).toBeGreaterThanOrEqual(0);
    expect(popupBox!.x + popupBox!.width).toBeLessThanOrEqual(375);

    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();

    // Base UI returns focus to the opening trigger after Escape closes it.
    await expect(trigger).toBeFocused();
    expect(await documentOverflowPx(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("keyboard focus visibility on vacancy controls", () => {
  test("representative list controls render visible keyboard focus as outline or ring", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/vacantes?q=frontend&currency=MXN");

    // Walk the page with real keyboard Tabs (genuine :focus-visible modality)
    // and record focus styles of each representative control as it is reached.
    const wanted = [
      "search input",
      "search submit button",
      "job title link",
      "currency select trigger",
      "next-page link",
    ] as const;
    const found = new Map<string, FocusStyles>();
    for (let i = 0; i < 60 && found.size < wanted.length; i++) {
      await page.keyboard.press("Tab");
      const name = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return null;
        return el.id === "jobs-search"
          ? "search input"
          : el.tagName === "BUTTON" && el.textContent?.trim() === "Buscar"
            ? "search submit button"
            : el.tagName === "A" &&
                el.closest('[aria-label="Listado de vacantes"]')
              ? "job title link"
              : el.id === "desktop-currency"
                ? "currency select trigger"
                : el.matches("[data-jobs-next-link]")
                  ? "next-page link"
                  : null;
      });
      if (!name || found.has(name)) continue;
      // The controls transition their ring via a 200ms box-shadow animation;
      // read the computed styles only after the focus transition has settled.
      await page.waitForTimeout(300);
      const styles = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return null;
        const computed = getComputedStyle(el);
        return {
          outlineStyle: computed.outlineStyle,
          outlineWidth: computed.outlineWidth,
          boxShadow: computed.boxShadow,
        };
      });
      if (styles) found.set(name, styles);
    }

    for (const name of wanted) {
      const styles = found.get(name);
      expect(styles, `${name} must be keyboard-reachable`).toBeDefined();
      expect(
        hasVisibleOutline(styles!) || hasVisibleRing(styles!),
        `${name} must show a visible outline or ring focus indicator`,
      ).toBe(true);
    }
  });
});

test.describe("rendered list layout and preset token fidelity", () => {
  test("rendered vacancy list has no horizontal overflow on desktop or mobile", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/vacantes");
    await expect(
      page.getByRole("list", { name: /listado de vacantes/i }),
    ).toBeVisible();
    expect(await documentOverflowPx(page)).toBeLessThanOrEqual(0);

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/vacantes");
    await expect(
      page.getByRole("list", { name: /listado de vacantes/i }),
    ).toBeVisible();
    expect(await documentOverflowPx(page)).toBeLessThanOrEqual(0);
  });

  test("Inter typography and semantic Violet/Neutral/Default-radius token ownership without inline overrides", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/vacantes?currency=MXN");

    const typography = await page.evaluate(() => {
      const font = (selector: string) => {
        const el = document.querySelector(selector);
        return el ? getComputedStyle(el).fontFamily : null;
      };
      return {
        body: font("body"),
        h1: font("h1"),
        jobTitleLink: font('[aria-label="Listado de vacantes"] a'),
      };
    });
    expect(typography.body).toMatch(/Inter/);
    expect(typography.h1).toMatch(/Inter/);
    expect(typography.jobTitleLink).toMatch(/Inter/);

    // Semantic token ownership: each representative control's computed color
    // must equal the value the design token resolves to (a var() probe
    // element), which fails if an inline or ad hoc color override wins.
    const tokenEvidence = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.setAttribute("aria-hidden", "true");
      document.body.appendChild(probe);
      const computed = (el: Element, prop: string) =>
        getComputedStyle(el).getPropertyValue(prop);
      const tokenValue = (token: string, prop: string) => {
        probe.style.setProperty(prop, `var(${token})`);
        return getComputedStyle(probe).getPropertyValue(prop);
      };
      const withToken = (probeValue: string, actual: string) => ({
        probeValue,
        actual,
      });
      const button = [
        ...document.querySelectorAll<HTMLButtonElement>(
          "button[type='submit']",
        ),
      ].find((el) => el.textContent?.trim() === "Buscar")!;
      const titleLink = document.querySelector<HTMLAnchorElement>(
        '[aria-label="Listado de vacantes"] a',
      )!;
      const detail = document.querySelector<HTMLElement>(
        '[aria-label="Listado de vacantes"] li span',
      )!;
      const evidence = {
        buttonBackground: withToken(
          tokenValue("--primary", "background-color"),
          computed(button, "background-color"),
        ),
        buttonForeground: withToken(
          tokenValue("--primary-foreground", "color"),
          computed(button, "color"),
        ),
        titleLinkColor: withToken(
          tokenValue("--foreground", "color"),
          computed(titleLink, "color"),
        ),
        detailColor: withToken(
          tokenValue("--muted-foreground", "color"),
          computed(detail, "color"),
        ),
        controlRadius: {
          probeValue: tokenValue("--radius-2xl", "border-radius"),
          buttonRadius: computed(button, "border-radius"),
          inputRadius: computed(
            document.querySelector<HTMLInputElement>("#jobs-search")!,
            "border-radius",
          ),
        },
        rootRadiusAnchor: getComputedStyle(document.documentElement)
          .getPropertyValue("--radius")
          .trim(),
        inlineOverrides: [
          button,
          titleLink,
          detail,
          document.querySelector<HTMLInputElement>("#jobs-search")!,
        ].map((el) => el.getAttribute("style")),
      };
      probe.remove();
      return evidence;
    });

    for (const [name, { probeValue, actual }] of [
      ["button background", tokenEvidence.buttonBackground],
      ["button foreground", tokenEvidence.buttonForeground],
      ["job title link color", tokenEvidence.titleLinkColor],
      ["vacancy detail color", tokenEvidence.detailColor],
    ] as const) {
      expect(actual, `${name} must equal its semantic token value`).toBe(
        probeValue,
      );
    }

    // Default-radius token behavior: controls derive their radius from the
    // preset scale anchored at --radius (0.625rem) without hardcoding values.
    // (Blink serializes the custom property with or without the leading zero.)
    expect(tokenEvidence.rootRadiusAnchor).toMatch(/^\.?625rem$/);
    expect(tokenEvidence.controlRadius.buttonRadius).toBe(
      tokenEvidence.controlRadius.probeValue,
    );
    expect(tokenEvidence.controlRadius.inputRadius).toBe(
      tokenEvidence.controlRadius.probeValue,
    );

    // No inline/ad hoc style overrides on the representative controls.
    for (const style of tokenEvidence.inlineOverrides) {
      expect(
        style === null || !/color|background|border-radius/i.test(style),
        `unexpected inline style override: ${style ?? "null"}`,
      ).toBe(true);
    }
  });
});
