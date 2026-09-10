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
// 5xx/schema/timeout recovery, long-content wrapping.
// Reduced motion is covered by the final Task 4.3 slice below: under an
// emulated `prefers-reduced-motion: reduce` environment the representative
// /vacantes controls must collapse nonessential transition/animation timing
// while every keyboard and pending-state behavior keeps working.

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
    // The two composed search fields own their focus indication on the
    // outer wrapper (data-jobs-composed-field), never on the inner input.
    let composedField: {
      innerOutlineStyle: string;
      innerHasVisibleBoxShadow: boolean;
      innerBorderWidth: string;
      wrapperBorderTopColor: string;
      wrapperBorderTopWidth: string;
    } | null = null;
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
      if (name === "search input") {
        composedField = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          const field =
            el?.closest<HTMLElement>("[data-jobs-composed-field]") ?? null;
          if (!el || !field) return null;
          const inner = getComputedStyle(el);
          const wrapper = getComputedStyle(field);
          const innerShadowLengths = Array.from(
            inner.boxShadow.matchAll(/-?\d+(?:\.\d+)?px/g),
            (match) => Number.parseFloat(match[0]),
          );
          return {
            innerOutlineStyle: inner.outlineStyle,
            innerHasVisibleBoxShadow:
              inner.boxShadow !== "none" &&
              innerShadowLengths.some((length) => length !== 0),
            innerBorderWidth: inner.borderTopWidth,
            wrapperBorderTopColor: wrapper.borderTopColor,
            wrapperBorderTopWidth: wrapper.borderTopWidth,
          };
        });
      }
    }

    for (const name of wanted) {
      const styles = found.get(name);
      expect(styles, `${name} must be keyboard-reachable`).toBeDefined();
      expect(
        hasVisibleOutline(styles!) || hasVisibleRing(styles!),
        `${name} must show a visible outline or ring focus indicator`,
      ).toBe(true);
    }

    // Composed search field: the inner input carries no border, outline,
    // ring, or shadow on focus; the wrapper owns the single brand-violet
    // focus-within indication as one primary-token border (no extra ring).
    expect(
      composedField,
      "search input must live inside a composed field wrapper",
    ).not.toBeNull();
    expect(composedField!.innerOutlineStyle).toBe("none");
    expect(composedField!.innerHasVisibleBoxShadow).toBe(false);
    expect(Number.parseFloat(composedField!.innerBorderWidth)).toBe(0);
    expect(
      Number.parseFloat(composedField!.wrapperBorderTopWidth),
    ).toBeGreaterThan(0);
    const primaryColor = await page.evaluate(() => {
      const probe = document.createElement("span");
      document.body.appendChild(probe);
      probe.style.color = "var(--primary)";
      const primary = getComputedStyle(probe).color;
      probe.remove();
      return primary;
    });
    expect(composedField!.wrapperBorderTopColor).toBe(primaryColor);
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

  test("heading/body typography roles and semantic Violet/Neutral/Default-radius token ownership without inline overrides", async ({
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
    // Inter stays the body/controls face; Clash Display (with the Inter
    // fallback baked into --font-heading) owns the heading role.
    expect(typography.body).toMatch(/Inter/);
    expect(typography.h1).toContain("Clash Display");
    expect(typography.jobTitleLink).toContain("Clash Display");

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
        '[aria-label="Listado de vacantes"] li p',
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
    // Blink may serialize the value as either `0.625rem` or `.625rem`.
    expect(tokenEvidence.rootRadiusAnchor).toMatch(/^(?:0?\.)625rem$/);
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

test.describe("reduced motion on vacancy controls", () => {
  // Playwright 1.62 moved context emulation options under contextOptions;
  // this is the documented equivalent of the removed top-level
  // test.use({ reducedMotion: "reduce" }) option.
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  type MotionStyle = {
    transitionDuration: string;
    animationDuration: string;
    animationIterationCount: string;
  };

  // CSS transition/animation durations serialize as comma-separated time
  // lists ("200ms", "0.15s, 100ms", "0s"); parse every entry in milliseconds
  // so an assertion failure shows the real computed values instead of strings.
  function parseTimesMs(value: string): number[] {
    const parts = value
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter((part) => part.length > 0);
    if (parts.length === 0) return [0];
    return parts.map((part) => {
      // Blink serializes sub-millisecond times in scientific notation
      // (0.01ms computed as "1e-05s"), so exponents must parse.
      const match = part.match(/^(-?[\d.]+(?:e-?\d+)?)(ms|s)$/);
      if (!match) throw new Error(`unparseable CSS time: "${part}"`);
      const amount = Number.parseFloat(match[1]);
      return match[2] === "s" ? amount * 1000 : amount;
    });
  }

  function assertMotionCollapsed(style: MotionStyle, label: string): void {
    for (const ms of parseTimesMs(style.transitionDuration)) {
      expect(
        ms,
        `${label} transition-duration must collapse under reduced motion (computed: ${style.transitionDuration})`,
      ).toBeLessThan(1);
    }
    for (const ms of parseTimesMs(style.animationDuration)) {
      expect(
        ms,
        `${label} animation-duration must collapse under reduced motion (computed: ${style.animationDuration})`,
      ).toBeLessThan(1);
    }
    // A looping animation never "finishes" for users who asked for less
    // motion, so every iteration count must be a finite value of at most 1.
    for (const part of style.animationIterationCount
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter((part) => part.length > 0)) {
      expect(
        part,
        `${label} animation-iteration-count must not loop under reduced motion (computed: ${style.animationIterationCount})`,
      ).not.toBe("infinite");
      expect(
        Number.parseFloat(part),
        `${label} animation-iteration-count must be at most 1 under reduced motion (computed: ${style.animationIterationCount})`,
      ).toBeLessThanOrEqual(1);
    }
  }

  function motionOf(
    locator: import("@playwright/test").Locator,
  ): Promise<MotionStyle> {
    return locator.evaluate((el) => {
      const computed = getComputedStyle(el);
      return {
        transitionDuration: computed.transitionDuration,
        animationDuration: computed.animationDuration,
        animationIterationCount: computed.animationIterationCount,
      };
    });
  }

  async function expectReducedMotionMatches(
    page: import("@playwright/test").Page,
  ): Promise<void> {
    expect(
      await page.evaluate(
        () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
    ).toBe(true);
  }

  test("desktop controls collapse nonessential motion and stay keyboard operable @a11y @reduced-motion", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/vacantes");
    await expectReducedMotionMatches(page);

    const search = page.getByLabel(/buscar/i);
    const submit = page.getByRole("button", { name: /^buscar$/i });
    const trigger = page.getByLabel(/moneda/i);
    for (const [label, locator] of [
      ["search input", search],
      ["search submit button", submit],
      ["currency select trigger", trigger],
    ] as const) {
      assertMotionCollapsed(await motionOf(locator), label);
    }

    // Keyboard Select: open the popup, highlight USD, commit, then submit the
    // filters form with Enter so the canonical navigation completes without
    // any pointing device. Timing assertions run while the popup is open so
    // its enter/exit motion is covered as authored.
    await trigger.focus();
    await page.keyboard.press("Enter");
    const popup = page.getByRole("listbox");
    await expect(popup).toBeVisible();
    assertMotionCollapsed(await motionOf(popup), "currency select popup");
    const usd = page.getByRole("option", { name: "USD" });
    for (let i = 0; i < 4; i++) {
      if (await usd.evaluate((el) => el.hasAttribute("data-highlighted")))
        break;
      await page.keyboard.press("ArrowDown");
    }
    await expect
      .poll(async () =>
        usd.evaluate((el) => el.hasAttribute("data-highlighted")),
      )
      .toBe(true);
    await page.keyboard.press("Enter");
    // Base UI returns focus to the trigger after keyboard selection.
    await expect(trigger).toBeFocused();

    const apply = page.getByRole("button", { name: /aplicar filtros/i });
    await apply.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL("/vacantes?currency=USD");
    await expect(trigger).toHaveText(/^USD/);
    await expect(
      page.getByRole("list", { name: /listado de vacantes/i }),
    ).toBeVisible();
  });

  test("pending search keeps exact announcement and initiator-only disablement under reduced motion @a11y @reduced-motion", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/vacantes");
    await expectReducedMotionMatches(page);

    const search = page.getByLabel(/buscar/i);
    const submit = page.getByRole("button", { name: /^buscar$/i });
    await search.fill("pending-search");
    // Keyboard-only submission: Enter from the focused search input.
    await search.press("Enter");

    const status = page.getByRole("status");
    await expect(status).toHaveText("Cargando…");
    // Focus must stay on the search input the whole time pending state is
    // announced; only the initiating submit button is disabled.
    await expect(search).toBeFocused();
    await expect(submit).toBeDisabled();
    await expect(
      page.getByRole("button", { name: /aplicar filtros/i }),
    ).toBeEnabled();

    await expect(page).toHaveURL(/q=pending-search/);
    await expect(status).not.toHaveText(/cargando/i);
    // Focus retention is proven while pending is announced; after the
    // navigation completes the island currently resets focus to body (an
    // app-level gap, out of this slice's test-only scope), so only the
    // control state and results are asserted here.
    await expect(search).toBeEnabled();
    await expect(search).toHaveValue("pending-search");
    await expect(
      page.getByRole("list", { name: /listado de vacantes/i }),
    ).toBeVisible();
  });

  test("mobile filters Sheet collapses motion and closes by keyboard Escape under reduced motion @a11y @reduced-motion", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/vacantes");
    await expectReducedMotionMatches(page);

    const trigger = page.getByRole("button", { name: /filtros/i });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Both Sheet surfaces exist only while the dialog is open, so their
    // computed motion is asserted in the open state.
    assertMotionCollapsed(
      await motionOf(page.locator('[data-slot="sheet-overlay"]')),
      "Sheet overlay",
    );
    assertMotionCollapsed(
      await motionOf(page.locator('[data-slot="sheet-content"]')),
      "Sheet panel",
    );

    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  });

  test("detail return link collapses motion and stays keyboard-operable @a11y @reduced-motion", async ({
    page,
  }) => {
    await page.goto("/vacantes/0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e");
    await expectReducedMotionMatches(page);
    const link = page.locator('a[href="/vacantes"]').first();
    assertMotionCollapsed(await motionOf(link), "detail return link");
    await link.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/vacantes$/);
  });
});

const DETAIL_RICH_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d92";

test.describe("vacancy detail axe WCAG A/AA matrix", () => {
  for (const scheme of SCHEMES) {
    for (const [label, viewport] of Object.entries(VIEWPORTS)) {
      test.describe(`${scheme} scheme, ${label} width`, () => {
        test.use({ colorScheme: scheme, viewport });

        test(`detail has no WCAG A/AA violations @a11y`, async ({ page }) => {
          await page.goto(`/vacantes/${DETAIL_RICH_ID}`);
          await expect(page.getByRole("article")).toBeVisible();
          const results = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa"])
            .analyze();
          expect(results.violations).toEqual([]);
        });
      });
    }
  }
});
