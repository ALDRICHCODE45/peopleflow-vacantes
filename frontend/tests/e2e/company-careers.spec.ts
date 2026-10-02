import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const COMPANY_PATH = "/empresas/0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f";
const FRONTEND_DETAIL = "/vacantes/0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
// The local jobs API this fully local prototype route must never reach.
const fixtureUrl = process.env.JOBS_FIXTURE_ORIGIN ?? "http://127.0.0.1:4010";
// Every enriched prototype extra the redesigned page must stop rendering.
const ENRICHMENT_COPY = /Destacada|Verificada por PeopleFlow|postulantes|Responde en|SALARIO MENSUAL/iu;
// UISC-03A: no rendered implementation-status vocabulary may survive either.
const PROHIBITED_DISPLAY_COPY = /demostraci|fictici|\bprototipo\b|no se guarda|no se env[ií]a|no se copi[oó]|no se comparti[oó]/iu;
// Document horizontal overflow in pixels; anything above zero fails.
const overflowPx = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("company careers keeps the editorial hero, working anchors, and a wire-only vacancy list", async ({ page }) => {
  // A mutation would be any non-GET request; an API call would be any request
  // to the jobs fixture, which this route never needs.
  const nonGet: string[] = [], apiTraffic: string[] = [];
  page.on("request", (entry) => {
    if (entry.url().startsWith(fixtureUrl)) apiTraffic.push(`${entry.method()} ${entry.url()}`);
    if (["POST", "PUT", "PATCH", "DELETE"].includes(entry.method())) nonGet.push(`${entry.method()} ${entry.url()}`);
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(COMPANY_PATH);

  // Exactly one H1, and both hero anchors jump to real in-page sections.
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Acme");

  // The hero is an immersive photo overlay: the copy rides the image through a
  // dark scrim, and no opaque card wraps the headline.
  const hero = page.locator("[data-pf-hero]");
  await expect(hero).toBeVisible();
  await expect(hero).toHaveAttribute("data-pf-hero-cover", "true");
  await expect(hero.locator("[data-pf-hero-overlay]")).toHaveCount(1);
  // No opaque card sits between the headline and the photo-backed overlay.
  const opaqueAncestor = await page
    .getByRole("heading", { level: 1 })
    .evaluate((node) => {
      for (let el = node.parentElement; el instanceof HTMLElement; el = el.parentElement) {
        if (el.hasAttribute("data-pf-hero")) break;
        if (el.className.includes("bg-background") || el.className.includes("bg-card")) {
          return el.className;
        }
      }
      return null;
    });
  expect(opaqueAncestor).toBeNull();
  expect((await hero.boundingBox())?.height ?? 0).toBeGreaterThan(480);

  await page.getByRole("link", { name: "Conoce la empresa" }).click();
  await expect(page).toHaveURL(/#sobre-empresa$/u);
  await expect(page.locator("#sobre-empresa")).toBeVisible();
  await page.getByRole("link", { name: "Ver vacantes" }).click();
  await expect(page).toHaveURL(/#vacantes$/u);
  await expect(page.locator("#vacantes")).toBeVisible();

  // The vacancy list is wire-backed only: canonical links, no enrichment,
  // no save control, and the company never links back to the employer route.
  const list = page.getByRole("list", { name: "Vacantes en Acme" });
  await expect(list).toBeVisible();
  const rows = list.getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.first().getByRole("heading", { level: 3 }).getByRole("link")).toHaveAttribute("href", FRONTEND_DETAIL);
  await expect(list).not.toContainText(ENRICHMENT_COPY);
  await expect(list).not.toContainText(PROHIBITED_DISPLAY_COPY);
  await expect(list.getByRole("button")).toHaveCount(0);
  await expect(list.getByRole("note")).toHaveCount(0);
  await expect(list.locator("[data-prototype-featured]")).toHaveCount(0);
  expect([await list.getByRole("link").count(), await list.getByRole("link", { name: "Acme" }).count()]).toEqual([4, 0]);

  // Mobile: the same list keeps zero horizontal overflow.
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(rows.first()).toBeVisible();
  expect(await overflowPx(page)).toBeLessThanOrEqual(0);

  // Frozen local fixtures: the page reaches neither the jobs API nor a mutation.
  expect(apiTraffic).toEqual([]);
  const diagnostics = nonGet.filter((entry) => entry.includes("__nextjs") || entry.includes("/_next/"));
  test.info().annotations.push({ type: "non-GET requests", description: JSON.stringify({ diagnostics, mutations: nonGet.filter((e) => !diagnostics.includes(e)) }) });
  expect(nonGet.filter((entry) => !diagnostics.includes(entry))).toEqual([]);
});

// The complete 92-test acceptance corpus had no company-page axe scan, so the
// root/list/detail/company WCAG A/AA matrix was incomplete; this closes it.
const COMPANY_VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 375, height: 812 },
} as const;

const COMPANY_SCHEMES = ["light", "dark"] as const;

test.describe("company careers axe WCAG A/AA matrix", () => {
  for (const scheme of COMPANY_SCHEMES) {
    for (const [label, viewport] of Object.entries(COMPANY_VIEWPORTS)) {
      test.describe(`${scheme} scheme, ${label} ${viewport.width}x${viewport.height}`, () => {
        test.use({ colorScheme: scheme, viewport });

        test(`company careers has no WCAG A/AA violations at ${label} width in ${scheme} scheme @a11y`, async ({
          page,
        }) => {
          await page.goto(COMPANY_PATH);
          await expect(
            page.getByRole("list", { name: "Vacantes en Acme" }),
          ).toBeVisible();
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
