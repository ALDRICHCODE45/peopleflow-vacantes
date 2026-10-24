import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Run against a Next server configured with the jobs fixture API, with a real
// authenticated employer session supplied by the harness. The fixture does not
// mint tokens or disable the workspace's server-side identity/company gates.
// PLAYWRIGHT_EMPLOYER_STORAGE_STATE points to harness-owned browser state;
// this spec never logs it. Do not run against a personal production account.
const APP_ORIGIN = process.env.PLAYWRIGHT_APP_ORIGIN ?? "http://localhost:3000";
const FIXTURE_ORIGIN = process.env.PLAYWRIGHT_FIXTURE_ORIGIN ?? "http://127.0.0.1:4010";
const DASHBOARD = `${APP_ORIGIN}/empresa/dashboard`;
const VACANCY_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
const PIPELINE = `/empresa/vacantes/${VACANCY_ID}/pipeline`;
test.use({ storageState: process.env.PLAYWRIGHT_EMPLOYER_STORAGE_STATE });
test.describe.configure({ mode: "serial" });
test.beforeEach(async ({ request }) => {
  const response = await request.get(`${FIXTURE_ORIGIN}/__employer-dashboard?mode=filled`);
  expect(response.ok(), "Start the existing fixture harness before this suite").toBe(true);
});
test.afterEach(async ({ request }) => {
  await request.get(`${FIXTURE_ORIGIN}/__employer-dashboard?mode=filled`);
});

test("fixture exposes strict real dashboard fields and a published draft-list row", async ({ request }) => {
  const headers = { authorization: "Bearer e2e-fixture-only" };
  const response = await request.get(`${FIXTURE_ORIGIN}/v2/me/company/dashboard`, { headers });
  expect(response.headers()["cache-control"]).toBe("no-store");
  const data = await response.json();
  expect(Object.keys(data).sort()).toEqual(["in_process", "origin_by_day", "pool_added_last_7_days", "positions", "published_vacancies", "recent"]);
  expect(data.origin_by_day).toHaveLength(90);
  expect(data.positions).toEqual({ covered: 3, required: 5 });
  const drafts = await request.get(`${FIXTURE_ORIGIN}/v2/me/company/job-drafts`, { headers });
  expect((await drafts.json()).items[0]).toMatchObject({ id: VACANCY_ID, status: "published", candidates: { in_process: 5 } });
});

test("dashboard renders endpoint counts, real origins and recent incorporations", async ({ page }) => {
  await page.goto(DASHBOARD);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard", exact: true })).toBeVisible();
  const cards = page.locator("[data-pf-kpi-cards]");
  await expect(cards).toContainText("Vacantes publicadas");
  await expect(cards).toContainText("Candidatos en proceso");
  await expect(cards).toContainText("Nuevos en la base");
  await expect(cards).toContainText("Agregados en los últimos 7 días");
  await expect(cards).toContainText("3/5");
  await expect(cards.locator("[data-pf-metric-icon] svg")).toHaveCount(4);
  await expect(cards.getByRole("progressbar", { name: "Posiciones cubiertas" })).toHaveAttribute("aria-valuenow", "60");
  await expect(page.getByRole("heading", { name: "Origen de las postulaciones" })).toBeVisible();
  await page.getByRole("button", { name: "Últimos 7 días", exact: true }).click();
  await expect(page.getByRole("button", { name: "Últimos 7 días", exact: true })).toHaveAttribute("aria-pressed", "true");
  const table = page.getByRole("table");
  await expect(table.getByRole("link", { name: "Ana Dashboard" })).toHaveAttribute("href", PIPELINE);
  await expect(table).toContainText("Orgánico");
  await expect(table).toContainText("Manual");
  await expect(table).toContainText("María Equipo");
  await expect(table).toContainText("23 oct 2026");
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect(page.locator("[data-pf-active-vacancy-row]")).toHaveCount(1);
  await expect(page.locator("[data-pf-active-vacancies]")).toContainText("5 candidatos en proceso");
  await expect(page.locator("[data-pf-active-vacancies]")).not.toContainText("Vacante pausada");
  await expect(page.getByRole("link", { name: "Ver pipeline de Plataforma Dashboard" })).toHaveAttribute("href", PIPELINE);
});

test("recent name link and active vacancy link are keyboard-operable canonical board routes", async ({ page }) => {
  for (const name of ["Ana Dashboard", "Ver pipeline de Plataforma Dashboard"]) {
    await page.goto(DASHBOARD);
    const link = page.getByRole("link", { name, exact: true });
    await expect(link).toBeVisible();
    await link.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${PIPELINE}$`));
  }
  await page.goto(DASHBOARD);
  await page.getByRole("link", { name: "Ver todas", exact: true }).click();
  await expect(page).toHaveURL(/\/empresa\/vacantes$/);
});

test("empty response has truthful zero cards and shared empty states", async ({ page, request }) => {
  await request.get(`${FIXTURE_ORIGIN}/__employer-dashboard?mode=empty`);
  await page.goto(DASHBOARD);
  await expect(page.getByText("Sin candidatos", { exact: true })).toBeVisible();
  await expect(page.getByText("No hay vacantes activas", { exact: true })).toBeVisible();
  await expect(page.locator("[data-pf-kpi-cards]")).toContainText("0/0");
  await expect(page.getByRole("table")).toHaveCount(1);
  await expect(page.getByRole("tab", { name: "Todos 0" })).toBeAttached();
});

test("an explicit retry recovers a server error without showing fallback data", async ({ page, request }) => {
  await request.get(`${FIXTURE_ORIGIN}/__employer-dashboard?mode=error`);
  await page.goto(DASHBOARD);
  await expect(page.getByRole("alert")).toContainText("No se pudo cargar el dashboard");
  await expect(page.locator("[data-pf-kpi-cards]")).toHaveCount(0);
  await request.get(`${FIXTURE_ORIGIN}/__employer-dashboard?mode=filled`);
  await page.getByRole("button", { name: "Reintentar", exact: true }).click();
  await expect(page.locator("[data-pf-kpi-cards]")).toContainText("3/5");
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
  test(`dashboard is accessible without document overflow at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(DASHBOARD);
    await expect(page.getByRole("heading", { name: "Candidatos recientes" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const results = await new AxeBuilder({ page }).include("[data-pf-page-content]").withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations.filter(item => item.impact === "serious" || item.impact === "critical")).toEqual([]);
  });
}
