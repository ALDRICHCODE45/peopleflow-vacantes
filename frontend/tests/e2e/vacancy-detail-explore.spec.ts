import { expect, test } from "@playwright/test";

// Uses the existing jobs-server / company-sites fixtures. Run with the regular
// detail harness, not browser request interception: related reads are server-side.
const fixtureOrigin = process.env.PLAYWRIGHT_FIXTURE_ORIGIN ?? "http://127.0.0.1:4010";
const nexoJob = "b478fb93-71b8-47bf-8eaa-b726d63e02a0";
const acmeJob = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d92";

test.beforeEach(async ({ request }) => {
  await request.get(`${fixtureOrigin}/__reset`);
});

for (const width of [375, 1440]) {
  for (const theme of ["light", "dark"] as const) {
    test(`exploration and apply at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.goto(`/vacantes/${nexoJob}`);
      await page.evaluate(value => {
        document.documentElement.classList.toggle("dark", value === "dark");
      }, theme);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      const company = page.getByRole("region", { name: "Sobre Nexo Labs" });
      await expect(company).toBeVisible();
      await expect(company).toContainText("Somos un equipo de tecnología en México");
      await expect(company.getByRole("link", { name: "Conoce la empresa" })).toHaveAttribute("href", "/empresas/nexo-labs");
      const rows = company.locator('a[href^="/vacantes/"]');
      expect(await rows.count()).toBeGreaterThan(0);
      expect(await rows.count()).toBeLessThanOrEqual(3);
      for (const link of await rows.all()) {
        await expect(link).toHaveAttribute("href", /^\/vacantes\/[\da-f-]+$/);
        await expect(link).not.toHaveAttribute("href", `/vacantes/${nexoJob}`);
      }
      const similar = page.getByRole("region", { name: "Vacantes similares" });
      await expect(similar).toBeVisible();
      expect(await similar.getByRole("link").count()).toBeGreaterThan(0);
      expect(await similar.getByRole("link").count()).toBeLessThanOrEqual(3);
      await expect(similar).not.toContainText("Nexo Labs");
      const first = similar.getByRole("link").first();
      await first.focus();
      await expect(first).toBeFocused();
      await expect(first).toHaveCSS("outline-style", "none");
      expect(await first.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe("none");
      const searches = page.getByRole("region", { name: "Sigue buscando" });
      await expect(searches).toBeVisible();
      await expect(searches.getByRole("link").first()).toHaveAttribute("href", /professional_area=technology_systems/);
      const rail = page.getByRole("complementary", { name: "Compensación y postulación" });
      const mobile = page.locator('[aria-labelledby="mobile-apply-heading"]');
      if (width < 1024) {
        await expect(mobile).toBeVisible();
        await expect(mobile.getByRole("link", { name: "Postularme" })).toHaveAttribute("href", await rail.getByRole("link", { name: "Postularme" }).getAttribute("href") as string);
        // scrollIntoViewIfNeeded treats fixed overlays as visible viewport.
        // At the document end, reserved space must clear the sticky bar.
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const last = searches.getByRole("link").last();
        const contentBox = await last.boundingBox();
        const barBox = await mobile.boundingBox();
        expect(contentBox!.y + contentBox!.height).toBeLessThanOrEqual(barBox!.y);
      } else {
        await expect(mobile).toBeHidden();
        const geometry = await company.evaluate(element => {
          const grid = element.closest('[data-slot="public-job-detail"]')!.lastElementChild!;
          const left = grid.children[0].getBoundingClientRect();
          const aside = grid.children[1].getBoundingClientRect();
          return { beside: aside.left >= left.right, sameColumn: grid.children[0].contains(element) };
        });
        expect(geometry).toEqual({ beside: true, sameColumn: true });
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
  }
}

test("a company without a published slug shows only its other vacancies", async ({ page }) => {
  await page.goto("/vacantes/0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e");
  const company = page.getByRole("region", { name: "Sobre Acme" });
  await expect(company).toBeVisible();
  await expect(company.getByRole("heading", { name: "Más vacantes de Acme" })).toBeVisible();
  await expect(company.getByRole("link").first()).toHaveAttribute("href", /^\/vacantes\//);
  await expect(company.locator('a[href^="/empresas/"]')).toHaveCount(0);
  await expect(company.getByRole("link", { name: /Conoce la empresa|Ver todas/ })).toHaveCount(0);
});

test("failed company profile omits only that region, preserving detail and similar jobs", async ({ page }) => {
  // The fixture has no public company profile for Acme but has catalog matches.
  await page.goto(`/vacantes/${acmeJob}`);
  await expect(page.getByRole("heading", { level: 1, name: "Desarrolladora Go" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Vacantes similares" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Sobre Acme" })).toHaveCount(0);
});
