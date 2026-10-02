import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const SETTINGS = "/empresa/configuracion";

test("employer sidebar and keyboard account menu expose only implemented destinations", async ({ page }) => {
  await page.goto("/empresa/dashboard");
  const sidebar = page.locator("[data-slot='sidebar-content']");
  await expect(sidebar.getByRole("link")).toHaveCount(6);
  for (const label of ["Mensajes", "Reportes"]) {
    await expect(sidebar.getByText(label, { exact: true })).toHaveCount(0);
  }
  await sidebar.getByRole("link", { name: "Configuración", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`${SETTINGS}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Configuración", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Tomás Ríos/ }).focus();
  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveCount(3);
  for (const [name, href] of [["Configuración", SETTINGS], ["Equipo", "/empresa/equipo"], ["Sitio de empleo", "/empresa/sitio"]]) {
    await expect(menu.getByRole("menuitem", { name, exact: true })).toHaveAttribute("href", href);
  }
  await menu.getByRole("menuitem", { name: "Equipo", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/empresa\/equipo$/);
  await expect(page.getByRole("heading", { level: 1, name: "Equipo", exact: true })).toBeVisible();
});

test("preferences stay local to the visit while the shared theme persists", async ({ page }) => {
  const mutations: string[] = [];
  page.on("request", request => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) && !new URL(request.url()).pathname.startsWith("/_next/")) mutations.push(request.url());
  });
  await page.goto(SETTINGS);
  const preference = page.getByRole("switch", { name: "Permitir postulaciones sin CV", exact: true });
  await expect(preference).toBeChecked();
  await preference.focus();
  await page.keyboard.press("Space");
  await expect(preference).not.toBeChecked();
  const security = page.getByRole("switch", { name: "Autenticación en dos pasos", exact: true });
  await security.click();
  await expect(security).not.toBeChecked();
  await page.getByRole("button", { name: "Cambiar contraseña", exact: true }).click();
  expect(await page.evaluate(() => ({ ...localStorage }))).toEqual({});
  expect(mutations).toEqual([]);
  await page.reload();
  await expect(preference).toBeChecked();

  await page.getByRole("combobox", { name: "Tema de la interfaz", exact: true }).click();
  await page.getByRole("option", { name: "Oscuro", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect(await page.evaluate(() => localStorage.getItem("pf-theme"))).toBe("dark");
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect(mutations).toEqual([]);
});

for (const [name, width, colorScheme] of [["desktop", 1440, "light"], ["mobile", 375, "dark"]] as const) {
  test(`settings has accessible sections without overflow on ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.goto(SETTINGS);
    const workspace = page.locator("[data-pf-employer-settings-workspace]");
    await expect(workspace.getByRole("heading", { level: 2 })).toHaveCount(5);
    await workspace.getByRole("link", { name: "Seguridad", exact: true }).click();
    await expect(page).toHaveURL(/#empresa-seguridad$/);
    await expect(workspace.getByRole("heading", { name: "Seguridad", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    expect(await workspace.locator("[data-slot='item-description']").evaluateAll(nodes => nodes.every(node => node.scrollHeight <= node.clientHeight + 1))).toBe(true);
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations.filter(entry => ["serious", "critical"].includes(entry.impact ?? ""))).toEqual([]);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: test.info().outputPath(`employer-settings-${name}.png`), fullPage: true });
  });
}
