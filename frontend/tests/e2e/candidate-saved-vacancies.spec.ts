import { expect, test } from "@playwright/test";

// Run only against a disposable, authenticated candidate environment seeded with
// pending, applied, legacy and unavailable saved jobs. Session comes from the
// runner's existing storageState; this spec never creates credentials/services.
const origin = process.env.PLAYWRIGHT_SAVED_VACANCIES_ORIGIN;
test.skip(!origin, "Requires the disposable saved-vacancies candidate environment");

for (const mobile of [false, true]) {
  test(`saved next steps and safe bulk confirmation (${mobile ? "mobile" : "desktop"})`, async ({ page }) => {
    await page.setViewportSize(mobile ? { width: 375, height: 812 } : { width: 1440, height: 900 });
    await page.goto(`${origin}/candidato/guardadas`);
    await expect(page.getByRole("heading", { level: 1, name: "Vacantes guardadas" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Por postularte/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Ver postulación", exact: true }).first()).toHaveAttribute("href", /\/candidato\/postulaciones\?postulacion=/);
    const disclosure = page.getByRole("button", { name: /^Ya no disponibles/ });
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");
    await disclosure.click();
    const bulk = page.getByRole("button", { name: "Quitar las que ya no están disponibles", exact: true });
    await bulk.click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(page.locator('[data-slot="alert-dialog-overlay"]')).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancelar", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(bulk).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await bulk.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(bulk).toBeFocused();
  });
}

test("confirmed removal offers keyboard-accessible undo", async ({ page }) => {
  await page.goto(`${origin}/candidato/guardadas`);
  const pending = page.getByRole("list", { name: "Por postularte", exact: true });
  const row = pending.locator("[data-pf-saved-vacancy]").first();
  const id = await row.getAttribute("data-pf-saved-vacancy");
  await row.getByRole("button", { name: /^Quitar .* de guardadas$/ }).click();
  await expect(page.locator(`[data-pf-saved-vacancy="${id}"]`)).toHaveCount(0);
  const undo = page.getByRole("button", { name: "Deshacer", exact: true });
  await undo.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(`[data-pf-saved-vacancy="${id}"]`)).toBeVisible();
});
