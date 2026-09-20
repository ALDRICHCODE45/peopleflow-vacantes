import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

const COMPANY_PATH = "/empresas/0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f";
const FRONTEND_DETAIL = "/vacantes/0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
// The local jobs API this fully local prototype route must never reach.
const fixtureUrl = process.env.JOBS_FIXTURE_ORIGIN ?? "http://127.0.0.1:4010";
// Mirrors the shared disclosure primitive of every prototype card, kept a
// literal so this browser contract never imports the app's React modules.
const PROTOTYPE_DISCLOSURE = "Datos y acciones de demostración: este prototipo no se conecta a ningún backend, no guarda información y no envía postulaciones reales.";
// Every prototype extra the two frozen Acme fixtures authorize and disclose.
const CARD_LABELS = ["Destacada", "Hace 2 h", "24 postulantes", "Hace 5 h", "41 postulantes", "Ingeniería", "Plataforma", "Habilidades", "Beneficios", "SALARIO MENSUAL", "Responde en ~3 días", "Verificada por PeopleFlow"] as const;
const cardsOf = (page: Page) => page.getByRole("list", { name: "Vacantes en Acme" }).getByRole("listitem");
// Document horizontal overflow in pixels; anything above zero fails.
const overflowPx = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
// The two direct card regions, in viewport coordinates.
const regionsOf = (card: Locator) => card.evaluate((li) => Array.from(li.children).map((child) => {
  const box = child.getBoundingClientRect();
  return { top: Math.round(box.top), bottom: Math.round(box.bottom), left: Math.round(box.left), right: Math.round(box.right) };
}));

test("company careers cards keep the reference region contract and disclose every prototype extra", async ({ page }) => {
  // A mutation would be any non-GET request; an API call would be any request
  // to the jobs fixture, which this route never needs.
  const nonGet: string[] = [], apiTraffic: string[] = [];
  page.on("request", (entry) => {
    if (entry.url().startsWith(fixtureUrl)) apiTraffic.push(`${entry.method()} ${entry.url()}`);
    if (["POST", "PUT", "PATCH", "DELETE"].includes(entry.method())) nonGet.push(`${entry.method()} ${entry.url()}`);
  });

  // Desktop: content region left, salary rail right, one integrated divider.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(COMPANY_PATH);
  await expect(cardsOf(page)).toHaveCount(2);
  const [content, rail] = await regionsOf(cardsOf(page).first());
  const edges = await cardsOf(page).first().evaluate((li) => {
    const style = getComputedStyle(li.children[1]);
    return { top: Number.parseFloat(style.borderTopWidth), left: Number.parseFloat(style.borderLeftWidth), divider: style.borderLeftColor, border: getComputedStyle(li).borderTopColor };
  });
  test.info().annotations.push({ type: "company card regions @1440", description: JSON.stringify({ content, rail, edges }) });
  expect([rail.left >= content.right, Math.abs(rail.top - content.top) <= 1]).toEqual([true, true]);
  expect([edges.top, edges.left > 0, edges.divider === edges.border]).toEqual([0, true, true]);
  expect([await overflowPx(page), await cardsOf(page).evaluateAll((cards) => cards.map((li) => li.children.length))]).toEqual([0, [2, 2]]);

  // Both cards expose every authorized prototype extra, each scoped by the
  // shared note, and the company is never linked back to this route.
  const list = page.getByRole("list", { name: "Vacantes en Acme" });
  await expect(list.getByRole("heading", { level: 3 }).first().getByRole("link")).toHaveAttribute("href", FRONTEND_DETAIL);
  for (const label of CARD_LABELS) await expect(list).toContainText(label);
  await expect(list.getByRole("note")).toHaveCount(2);
  await expect(list.getByRole("note").first()).toHaveText(PROTOTYPE_DISCLOSURE);
  expect([await list.getByRole("link").count(), await list.getByRole("link", { name: "Acme" }).count()]).toEqual([4, 0]);
  // Wire markup-like text stays text: characters, never a rendered element.
  expect([await list.locator("script, img, iframe, b").count(), await list.getByText("<script>alert('xss')</script>").count()]).toEqual([0, 1]);

  // Mobile: the same two regions stack below the content without overflow.
  await page.setViewportSize({ width: 375, height: 812 });
  const [mobileContent, mobileRail] = await regionsOf(cardsOf(page).first());
  test.info().annotations.push({ type: "company card regions @375", description: JSON.stringify({ mobileContent, mobileRail }) });
  expect([mobileRail.top >= mobileContent.bottom, Math.abs(mobileRail.left - mobileContent.left) <= 1]).toEqual([true, true]);
  expect(await overflowPx(page)).toBeLessThanOrEqual(0);

  // The same shared card island hydrates on this route: the enriched card's
  // bookmark toggles in memory and announces truthful demo feedback, scoped to
  // this card so the board's full interaction contract is not duplicated.
  const frontendCard = list.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3, name: "Ingeniera Frontend" }) });
  const bookmark = frontendCard.getByRole("button");
  await expect(bookmark).toHaveAttribute("aria-pressed", "false");
  await bookmark.click();
  await expect(bookmark).toHaveAttribute("aria-pressed", "true");
  await expect(bookmark).toHaveAttribute("aria-label", "Guardar vacante (marcada solo en esta demostración)");
  await expect(frontendCard.getByRole("status")).toHaveText("Guardado de demostración activado: no se guardó nada real.");

  // Frozen local fixtures: no card interaction reaches the jobs API, and the
  // canonical CTA navigates without any mutating request.
  expect(apiTraffic).toEqual([]);
  await cardsOf(page).first().getByRole("link", { name: "Ver vacante" }).click();
  await expect(page).toHaveURL(FRONTEND_DETAIL);
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
