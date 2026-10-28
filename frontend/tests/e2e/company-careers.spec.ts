import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Production Next on :3100, existing HTTP fixture on :4010. No auth bypass:
// employer cookies are supplied by the harness and never read or logged here.
const APP = process.env.PLAYWRIGHT_APP_ORIGIN ?? "http://localhost:3100";
const FIXTURE = process.env.PLAYWRIGHT_FIXTURE_ORIGIN ?? process.env.JOBS_FIXTURE_ORIGIN ?? "http://127.0.0.1:4010";
const PUBLIC = `${APP}/empresas/nexo-labs`;
const EDITOR = `${APP}/empresa/sitio`;
const HERO = "Tu siguiente gran paso empieza aquí";
const storageState = process.env.PLAYWRIGHT_EMPLOYER_STORAGE_STATE;
const fixtureHeaders = { authorization: "Bearer e2e-fixture-only" };

// The mutable fixture is shared: each scenario starts independently, in order.
test.describe.configure({ mode: "default" });
test.beforeEach(async ({ request }) => {
  const reset = await request.get(`${FIXTURE}/__reset`);
  expect(reset.ok(), "Start tests/fixtures/jobs-server.mjs on :4010 before this suite").toBe(true);
});

async function editHero(page: Page, title: string) {
  await page.goto(EDITOR);
  await expect(page.getByRole("button", { name: "Seleccionar Portada", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Seleccionar Portada", exact: true }).click();
  await page.getByLabel("Título principal", { exact: true }).fill(title);
  await expect(page.frameLocator('iframe[title="Vista previa del sitio"]').getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(page.getByRole("status", { name: "Estado del guardado" })).toHaveText("Cambios guardados");
}

test("public site renders its hero, own navigation, all jobs and working filters", async ({ page }) => {
  await page.goto(PUBLIC);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(HERO);
  const nav = page.getByRole("navigation", { name: "Secciones de la empresa" });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link", { name: "Ver vacantes", exact: true })).toHaveAttribute("href", /#bloque-/);
  await expect(page.getByRole("link", { name: "PeopleFlow para empresas" })).toHaveAttribute("href", "/");
  const jobs = page.locator('[aria-label="Vacantes de la empresa"]');
  await expect(jobs.getByRole("link")).toHaveCount(7);
  await page.getByLabel("Buscar por título", { exact: true }).fill("plataforma");
  await expect(jobs.getByRole("link")).toHaveCount(1);
  await expect(jobs.getByRole("link", { name: "Ingeniera de plataforma" })).toHaveAttribute("href", /\/vacantes\/b478/);
  await page.getByLabel("Buscar por título", { exact: true }).fill("");
  await page.getByRole("button", { name: "Filtros", exact: true }).click();
  await page.getByRole("combobox", { name: "Modalidad", exact: true }).click();
  await page.getByRole("option", { name: "Remoto", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("status").filter({ hasText: "2 vacantes coinciden" })).toBeVisible();
  await page.getByRole("button", { name: "Ver resultados", exact: true }).click();
  await expect(jobs.getByRole("link")).toHaveCount(2);
  await page.getByRole("button", { name: "Filtros (1)", exact: true }).click();
  await page.getByRole("combobox", { name: "Estado", exact: true }).click();
  await page.getByRole("option", { name: "Nuevo León", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Ver resultados", exact: true }).click();
  await expect(jobs.getByRole("link")).toHaveCount(1);
  await expect(jobs.getByRole("link")).toHaveAccessibleName("Ingeniera de plataforma");
});

test("old slug permanently redirects to the current slug", async ({ request, page }) => {
  const response = await request.get(`${APP}/empresas/nexo-equipo`, { maxRedirects: 0 });
  expect(response.status()).toBe(308);
  expect(new URL(response.headers().location, APP).pathname).toBe("/empresas/nexo-labs");
  await page.goto(`${APP}/empresas/nexo-equipo`);
  await expect(page).toHaveURL(PUBLIC);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(HERO);
});

test("unknown slug shows the unavailable site state, never a prototype", async ({ page }) => {
  const response = await page.goto(`${APP}/empresas/empresa-desconocida`);
  expect(response?.status()).toBe(404);
  await expect(page.getByText("Este sitio no está disponible", { exact: true })).toBeVisible();
  await expect(page.locator('[aria-label="Vacantes de la empresa"]')).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`public careers site is accessible in ${theme} @a11y`, async ({ page }) => {
    await page.addInitScript(value => localStorage.setItem("pf-theme", value), theme);
    await page.goto(PUBLIC);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(HERO);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.evaluate(() => document.fonts.ready);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}

test.describe("employer careers builder", () => {
  test.use({ storageState, viewport: { width: 1440, height: 1000 } });
  test.beforeEach(() => {
    test.skip(!storageState, "Set PLAYWRIGHT_EMPLOYER_STORAGE_STATE to a valid localhost employer session to run editor scenarios.");
  });

  test("selecting and editing the hero updates preview and autosaves", async ({ page, request }) => {
    const title = "Construye tu futuro con Nexo";
    await editHero(page, title);
    const draft = await request.get(`${FIXTURE}/v2/me/company/site`, { headers: fixtureHeaders });
    expect(draft.ok()).toBe(true);
    expect((await draft.json()).draft.blocks.find((block: { type: string }) => block.type === "hero").content.title).toBe(title);
    // Autosave changes the draft, not the public snapshot.
    await page.goto(PUBLIC);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(HERO);
  });

  test("a taken slug stays local and does not poison unrelated autosaves", async ({ page, request }) => {
    await page.goto(EDITOR);
    await page.getByRole("tab", { name: "Ajustes", exact: true }).click();
    await page.getByLabel("Dirección pública", { exact: true }).fill("otra-empresa");
    await expect(page.getByRole("status", { name: "Disponibilidad de dirección" })).toHaveText("En uso");
    await page.getByLabel("Título SEO", { exact: true }).fill("Nuestro equipo Nexo");
    await expect(page.getByRole("status", { name: "Estado del guardado" })).toHaveText("Cambios guardados");
    const response = await request.get(`${FIXTURE}/v2/me/company/site`, { headers: fixtureHeaders });
    expect(response.ok()).toBe(true);
    expect((await response.json()).draft).toMatchObject({ slug: "nexo-labs", seo: { title: "Nuestro equipo Nexo" } });
    await expect(page.getByRole("link", { name: "/empresas/nexo-labs", exact: true })).toBeVisible();
  });

  test("confirmed publication exposes the saved hero on the public page", async ({ page }) => {
    const title = "Tu talento transforma Nexo";
    await editHero(page, title);
    await page.getByRole("button", { name: "Publicar", exact: true }).click();
    const confirmation = page.getByRole("alertdialog", { name: "¿Publicar tu sitio?" });
    await expect(confirmation.getByRole("button", { name: "Cancelar", exact: true })).toBeFocused();
    await confirmation.getByRole("button", { name: "Publicar sitio", exact: true }).click();
    await expect(page.locator("#publication-status")).toHaveText("Sitio publicado");
    await page.goto(PUBLIC);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  });

  test("recruiters edit the draft but cannot publish", async ({ page, request }) => {
    expect((await request.get(`${FIXTURE}/__site-draft?role=recruiter`)).ok()).toBe(true);
    await page.goto(EDITOR);
    await expect(page.getByRole("button", { name: "Publicar", exact: true })).toBeDisabled();
    await expect(page.getByText("Solo la persona dueña de la empresa puede publicar. Tus cambios quedan guardados en el borrador.", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Título principal", { exact: true })).toBeEnabled();
  });
});
