import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// CCP-R7E — marketing → login acceptance on both routes. Real assertions only;
// the shader/pixel proof stays in login.spec.ts. Every mutation, storage and
// cross-origin boundary is observed, never assumed. Non-GETs are classified by
// exact Next internal path so no business mutation can hide behind them.

const APP_ORIGIN = process.env.PLAYWRIGHT_APP_ORIGIN ?? "http://127.0.0.1:3100";
const DISCLOSURE = "Vista previa: acceso aún no disponible.";
const DESKTOP = { width: 1280, height: 720 } as const;
const MOBILE = { width: 375, height: 812 } as const;
const PANEL = "[data-login-visual-panel]";
const FRAMEWORK_DIAGNOSTIC = "/__nextjs_original-stack-frames";
const ROUTES = [
  { path: "/empresa/login", heading: "Ingresa a tu cuenta", menu: "Empresa", reciprocal: "/candidato/login", provider: "Microsoft" },
  { path: "/candidato/login", heading: "Ingresa a tu perfil", menu: "Candidato", reciprocal: "/empresa/login", provider: "LinkedIn" },
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

async function assertTruthfulShell(page: Page, route: Route, mobile: boolean) {
  await expect(page.locator("main")).toHaveCount(1);
  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1).toHaveCount(1);
  await expect(h1).toHaveText(route.heading);
  await expect(page.getByText(DISCLOSURE)).toBeVisible();
  await expect(page.locator("form")).toHaveCount(0);
  // Exactly two readonly, fixed-empty credential inputs with no field name.
  const fields = page.locator('main input[type="email"], main input[type="password"]');
  await expect(fields).toHaveCount(2);
  for (let index = 0; index < 2; index += 1) {
    await expect(fields.nth(index)).toHaveAttribute("readonly", "");
    await expect(fields.nth(index)).toHaveValue("");
    expect(await fields.nth(index).getAttribute("name")).toBeNull();
  }
  // One disabled checkbox plus three disabled auth actions.
  await expect(page.getByRole("checkbox")).toBeDisabled();
  for (const name of ["Ingresar", "Continuar con Google", `Continuar con ${route.provider}`]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
  }
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
    // Disabled auth actions stay inert: asserted disabled, never force-clicked.
    for (const name of ["Ingresar", "Continuar con Google", "Continuar con Microsoft"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
    }
  });
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
