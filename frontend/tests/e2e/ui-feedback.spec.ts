import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Opt-in isolated fixture: no product route, session, backend or simulated save.
const origin = process.env.PLAYWRIGHT_FEEDBACK_ORIGIN;
test.skip(!origin, "Run the dedicated UI feedback fixture first (see UI rules)." );

for (const theme of ["light", "dark"] as const) {
  test(`notifications follow manual ${theme} tokens rather than the OS @a11y`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme === "light" ? "dark" : "light" });
    await page.goto(origin!);
    await page.evaluate((value) => {
      document.documentElement.classList.toggle("dark", value === "dark");
      document.documentElement.dataset.theme = value;
    }, theme);
    await page.getByRole("button", { name: "Mostrar notificación de prueba", exact: true }).click();
    const toast = page.locator("[data-sileo-toast]");
    await expect(toast).toBeVisible();
    await expect(page.locator("[data-sileo-viewport]")).toHaveAttribute("aria-live", "polite");
    await expect(page.locator("[data-sileo-description]")).toBeVisible();
    const colors = await page.evaluate(() => {
      const description = document.querySelector("[data-sileo-description]")!;
      const probe = document.createElement("span");
      probe.style.color = "var(--popover-foreground)";
      document.body.append(probe);
      const expected = getComputedStyle(probe).color;
      probe.remove();
      return { actual: getComputedStyle(description).color, expected };
    });
    expect(colors.actual).toBe(colors.expected);
    await expect(page.locator("[data-sileo-title]")).toHaveCSS("text-transform", "none");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}

test("mobile loading and reduced-motion toast stay within the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(origin!);
  await expect(page.getByRole("status", { name: "Procesando prueba" })).toBeVisible();
  await expect(page.locator('[data-slot="skeleton"]').first()).toHaveCSS("animation-iteration-count", "1");
  await page.getByRole("button", { name: "Mostrar error de prueba", exact: true }).click();
  await expect(page.locator("[data-sileo-description]")).toBeVisible();
  // CSS alone cannot stop the package's JS-driven SVG morph: hide that layer.
  await expect(page.locator("[data-sileo-canvas]")).toBeHidden();
  const box = await page.locator("[data-sileo-toast]").boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
});
