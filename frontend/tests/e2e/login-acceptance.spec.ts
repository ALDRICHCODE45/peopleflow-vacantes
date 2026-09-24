import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

// CCP-R7E — marketing → login acceptance on both routes. Real assertions only;
// the shader/pixel proof stays in login.spec.ts. Every mutation, storage and
// cross-origin boundary is observed, never assumed. Non-GETs are classified by
// exact Next internal path so no business mutation can hide behind them.
// UISC-02: the shell renders no implementation-status copy, and every auth
// action stays visible, enabled, focusable and inert over pointer and keyboard.

const APP_ORIGIN = process.env.PLAYWRIGHT_APP_ORIGIN ?? "http://127.0.0.1:3100";
const DESKTOP = { width: 1280, height: 720 } as const;
const MOBILE = { width: 375, height: 812 } as const;
const PANEL = "[data-login-visual-panel]";
const FRAMEWORK_DIAGNOSTIC = "/__nextjs_original-stack-frames";
// Rendered implementation-status vocabulary is banned from the shell, mirroring
// the focused contract. Sales copy such as "Agendar demo" never appears here.
const PROHIBITED_COPY = /vista previa|aún no disponible|no disponible|demo|prototip|prueba|maqueta|local|unavailable/iu;
const SUCCESS_CLAIM = /éxito|correctamente|acceso concedido|sesión iniciada correctamente|bienvenid|has iniciado sesión/iu;
const ROUTES = [
  { path: "/empresa/login", heading: "Ingresa a tu cuenta", menu: "Empresa", reciprocal: "/candidato/login", provider: "Microsoft", action: "Registra tu empresa", remember: "employer-login-remember" },
  { path: "/candidato/login", heading: "Ingresa a tu perfil", menu: "Candidato", reciprocal: "/empresa/login", provider: "LinkedIn", action: "Crea tu perfil", remember: "candidate-login-remember" },
] as const;
type Route = (typeof ROUTES)[number];

async function openHydrated(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(100);
}

type Request = { method: string; url: string };
const track = (page: Page) => {
  const seen: Request[] = [];
  page.on("request", (entry) => seen.push({ method: entry.method(), url: entry.url() }));
  return seen;
};
const isInternal = (url: string) => {
  const { origin, pathname } = new URL(url);
  return origin === APP_ORIGIN && (pathname === FRAMEWORK_DIAGNOSTIC || pathname.startsWith("/_next/"));
};
// Only Next's own exact internal dev paths may use a non-GET.
const mutations = (seen: readonly Request[]) =>
  seen.filter(({ method, url }) => method !== "GET" && !isInternal(url)).map(({ method, url }) => `${method} ${url}`);
// No fixture, API or cross-origin business read may ever happen.
const foreignReads = (seen: readonly Request[]) =>
  seen
    .filter(({ url }) => !/^(data|blob|about):/.test(url))
    .filter(({ url }) => new URL(url).origin !== APP_ORIGIN || new URL(url).pathname.startsWith("/api"))
    .map(({ url }) => url);
const storage = (page: Page) =>
  page.evaluate(() => ({ local: JSON.stringify(Object.entries(localStorage).sort()), session: JSON.stringify(Object.entries(sessionStorage).sort()) }));
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// Raw sub-pixel pointer-target dimension: a sub-threshold target never rounds up.
const minTargetPx = (locator: Locator) =>
  locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return Math.min(box.width, box.height);
  });

// The page-order index of a control: stable identity for the Tab walk, so a
// button whose accessible name hides a decorative mark still resolves exactly.
type FocusPaint = { focusVisible: boolean; outlineStyle: string; outlineWidth: string; boxShadow: string };
const controlIndex = (locator: Locator) =>
  locator.evaluate((element) => Array.from(document.querySelectorAll("button, input")).indexOf(element));
const activeFocusStop = (page: Page): Promise<(FocusPaint & { index: number }) | null> =>
  page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element) return null;
    const computed = getComputedStyle(element);
    return {
      index: Array.from(document.querySelectorAll("button, input")).indexOf(element),
      focusVisible: element.matches(":focus-visible"),
      outlineStyle: computed.outlineStyle,
      outlineWidth: computed.outlineWidth,
      boxShadow: computed.boxShadow,
    };
  });
/** Visible keyboard focus as either an outline or a non-transparent ring. */
function hasVisibleFocus(paint: FocusPaint): boolean {
  if (paint.outlineStyle !== "none" && Number.parseFloat(paint.outlineWidth || "0") > 0) return true;
  if (paint.boxShadow === "none") return false;
  // Chromium serializes shadow colors as rgb()/rgba(), hex, or oklab/oklch/color().
  const colors = paint.boxShadow.match(/(?:rgba?\([^)]*\))|(?:#[0-9a-fA-F]{3,8})|(?:oklab\([^)]*\))|(?:oklch\([^)]*\))|(?:color\([^)]*\))/g);
  if (!colors) return false;
  return colors.some((color) => {
    if (/^rgba\(0, 0, 0, 0\)$/.test(color)) return false;
    const alpha = color.match(/\/\s*([\d.]+)\s*\)$/) ?? color.match(/,\s*([\d.]+)\s*\)$/);
    if (!alpha) return true;
    return Number.parseFloat(alpha[1]) > 0;
  });
}

async function assertTruthfulShell(page: Page, route: Route, mobile: boolean) {
  await expect(page.locator("main")).toHaveCount(1);
  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1).toHaveCount(1);
  await expect(h1).toHaveText(route.heading);
  // UISC-02: the preview disclosure and both "(aún no disponible)" suffixes are
  // gone, and no implementation-status vocabulary replaced them.
  await expect(page.locator("main")).not.toContainText(PROHIBITED_COPY);
  await expect(page.getByRole("group", { name: "Datos de acceso", exact: true })).toHaveCount(1);
  await expect(page.locator("form")).toHaveCount(0);
  // Exactly two readonly, fixed-empty credential inputs with no field name.
  const fields = page.locator('main input[type="email"], main input[type="password"]');
  await expect(fields).toHaveCount(2);
  for (let index = 0; index < 2; index += 1) {
    await expect(fields.nth(index)).toHaveAttribute("readonly", "");
    await expect(fields.nth(index)).toHaveValue("");
    expect(await fields.nth(index).getAttribute("name")).toBeNull();
  }
  // One enabled checkbox plus five enabled auth actions, each at a >=40px target.
  const remember = page.getByRole("checkbox");
  await expect(remember).toHaveCount(1);
  await expect(remember).toBeEnabled();
  for (const name of ["Ingresar", "Continuar con Google", `Continuar con ${route.provider}`, "¿Olvidaste tu contraseña?", route.action]) {
    const action = page.getByRole("button", { name, exact: true });
    await expect(action).toHaveCount(1);
    await expect(action).toBeEnabled();
    expect(await minTargetPx(action), `${name} must reach the 40px pointer target`).toBeGreaterThanOrEqual(40);
  }
  // The checkbox keeps native presentation; its clickable label owns the target.
  expect(await minTargetPx(page.locator(`label[for="${route.remember}"]`)), "the remember label must reach the 40px target").toBeGreaterThanOrEqual(40);
  // Only the reciprocal route and the root are real anchors; no "#" placeholders.
  await expect(page.getByRole("link", { name: "Ingresa aquí" })).toHaveAttribute("href", route.reciprocal);
  const hrefs = await page.locator("main a").evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute("href")));
  expect(hrefs.length).toBeGreaterThanOrEqual(2);
  expect(hrefs.every((href) => href === "/" || href === route.reciprocal)).toBe(true);
  if (mobile) {
    await expect(page.locator(PANEL)).toBeHidden();
    await expect(page.locator(`${PANEL} canvas`)).toHaveCount(0);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  } else {
    await expect(page.locator(PANEL)).toHaveAttribute("aria-hidden", "true");
    await expect(page.getByRole("link", { name: "Ingresa aquí" })).toBeVisible();
  }
}

for (const route of ROUTES) {
  for (const scheme of ["light", "dark"] as const) {
    for (const [label, viewport] of [["desktop", DESKTOP], ["mobile", MOBILE]] as const) {
      test.describe(`${route.path} — ${scheme} ${label}`, () => {
        test.use({ colorScheme: scheme, viewport });
        test("has a truthful shell and no serious/critical axe violations", async ({ page }) => {
          await openHydrated(page, route.path);
          expect(page.viewportSize()).toEqual(viewport);
          await assertTruthfulShell(page, route, label === "mobile");
          const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
          const severe = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
          expect(severe.map((v) => v.id)).toEqual([]);
        });
      });
    }
  }
}

test.describe("login acceptance boundaries", () => {
  test.use({ viewport: DESKTOP });
  test("emits zero business mutations and no foreign reads on both routes", async ({ page }) => {
    const seen = track(page);
    for (const route of ROUTES) await openHydrated(page, route.path);
    expect(mutations(seen)).toEqual([]);
    expect(foreignReads(seen)).toEqual([]);
  });
  test("keeps storage byte-identical across load and reciprocal navigation", async ({ page }) => {
    await openHydrated(page, ROUTES[0].path);
    const entering = await storage(page);
    expect(entering.local).not.toContain("pf-theme");
    await page.reload();
    expect(await storage(page)).toEqual(entering);
    await page.getByRole("link", { name: "Ingresa aquí" }).click();
    await page.waitForURL(`**${ROUTES[0].reciprocal}`);
    expect(await storage(page)).toEqual(entering);
  });
  test("Enter in a readonly field cannot submit, navigate, or mutate", async ({ page }) => {
    const seen = track(page);
    await openHydrated(page, ROUTES[0].path);
    const before = await storage(page);
    await page.locator('main input[type="email"]').click();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(250);
    expect(new URL(page.url()).pathname).toBe(ROUTES[0].path);
    expect(await storage(page)).toEqual(before);
    expect(mutations(seen)).toEqual([]);
    // The auth actions stay enabled and inert: asserted enabled, never submitted.
    for (const name of ["Ingresar", "Continuar con Google", "Continuar con Microsoft"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeEnabled();
    }
    await expect(page.locator('main [role="status"], main [role="alert"]')).toHaveCount(0);
  });
  for (const route of ROUTES) {
    test(`enabled auth placeholders stay inert over pointer and keyboard on ${route.path}`, async ({ page }) => {
      test.setTimeout(60_000);
      const seen = track(page);
      await openHydrated(page, route.path);
      const url = page.url();
      const before = await storage(page);
      const controls = [
        page.getByRole("button", { name: "Ingresar", exact: true }),
        page.getByRole("button", { name: "Continuar con Google", exact: true }),
        page.getByRole("button", { name: `Continuar con ${route.provider}`, exact: true }),
        page.getByRole("button", { name: "¿Olvidaste tu contraseña?", exact: true }),
        page.getByRole("button", { name: route.action, exact: true }),
      ];
      // Pointer activation: the control is enabled, focused and inert.
      for (const control of controls) {
        await expect(control).toBeEnabled();
        await control.click();
        await expect(control).toBeFocused();
        expect(page.url()).toBe(url);
        expect(await storage(page)).toEqual(before);
      }
      // Keyboard activation through both native activation keys.
      for (const [control, key] of [[controls[0], "Enter"], [controls[3], "Space"], [controls[4], "Enter"]] as const) {
        await control.focus();
        await page.keyboard.press(key);
        expect(page.url()).toBe(url);
        expect(await storage(page)).toEqual(before);
      }
      // The remember checkbox keeps native presentation but persists nothing.
      const remember = page.getByRole("checkbox");
      await expect(remember).toBeEnabled();
      await remember.click();
      expect(page.url()).toBe(url);
      expect(await storage(page)).toEqual(before);
      // No activation renders a success, status or authentication claim.
      await expect(page.locator('main [role="status"], main [role="alert"]')).toHaveCount(0);
      await expect(page.locator("main")).not.toContainText(SUCCESS_CLAIM);
      expect(mutations(seen)).toEqual([]);
      expect(foreignReads(seen)).toEqual([]);
    });
  }
  test("enters each login route from the root marketing menu without mutation", async ({ page }) => {
    const seen = track(page);
    for (const route of ROUTES) {
      await openHydrated(page, "/");
      const entering = await storage(page);
      await page.locator("#nav").getByRole("button", { name: "Ingresar", exact: true }).click();
      const item = page.getByRole("menuitem", { name: route.menu, exact: true });
      await expect(item).toHaveAttribute("href", route.path);
      await item.click();
      await page.waitForURL(`**${route.path}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(route.heading);
      expect(await storage(page)).toEqual(entering);
    }
    expect(mutations(seen)).toEqual([]);
    expect(foreignReads(seen)).toEqual([]);
  });
});

// UISC-02 keyboard focus: every enabled auth control must be a real Tab stop
// whose focus paint is a visible outline or ring, reached with genuine keyboard
// modality rather than programmatic focus.
test.describe("login auth placeholder keyboard focus", () => {
  test.use({ viewport: DESKTOP });
  for (const route of ROUTES) {
    test(`${route.path} reaches every auth control over real Tab with visible focus`, async ({ page }) => {
      await openHydrated(page, route.path);
      const expected = [
        { name: "Ingresar", locator: page.getByRole("button", { name: "Ingresar", exact: true }) },
        { name: "Continuar con Google", locator: page.getByRole("button", { name: "Continuar con Google", exact: true }) },
        { name: `Continuar con ${route.provider}`, locator: page.getByRole("button", { name: `Continuar con ${route.provider}`, exact: true }) },
        { name: "¿Olvidaste tu contraseña?", locator: page.getByRole("button", { name: "¿Olvidaste tu contraseña?", exact: true }) },
        { name: route.action, locator: page.getByRole("button", { name: route.action, exact: true }) },
        { name: "Mantener sesión iniciada", locator: page.getByRole("checkbox") },
      ];
      const names = new Map<number, string>();
      for (const { name, locator } of expected) names.set(await controlIndex(locator), name);
      expect(names.size).toBe(expected.length);

      const seen = new Set<number>();
      for (let index = 0; index < 40 && seen.size < expected.length; index += 1) {
        await page.keyboard.press("Tab");
        // The ring/outline transitions in; read the settled focus paint.
        await page.waitForTimeout(220);
        const stop = await activeFocusStop(page);
        if (!stop || !names.has(stop.index) || seen.has(stop.index)) continue;
        seen.add(stop.index);
        expect(stop.focusVisible, `${names.get(stop.index)} must receive the keyboard focus modality`).toBe(true);
        expect(hasVisibleFocus(stop), `${names.get(stop.index)} must show a visible outline or ring`).toBe(true);
      }
      expect(seen.size, `every auth control must be keyboard reachable on ${route.path}`).toBe(expected.length);
    });
  }
});
