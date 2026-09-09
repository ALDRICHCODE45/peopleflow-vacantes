import { expect, test, type APIRequestContext } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

const fixtureUrl = "http://127.0.0.1:4010";
// Fixture vacancies (tests/fixtures/jobs-server.mjs): main has no optional
// metadata, rich carries full metadata plus a markup-like description, and
// missing answers a backend 404. App origin comes from the harness baseURL.
const MAIN_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
const RICH_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d92";
const MISSING_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d99";
const richRequest = `/jobs/${RICH_ID}`;
const missingRequest = `/jobs/${MISSING_ID}`;
const NOT_FOUND_COPY = "Esta vacante no está disponible";
const XSS_TEXT = "<script>alert('xss')</script>";

const fixtureRequests = (request: APIRequestContext) =>
  request.get(`${fixtureUrl}/__requests`).then((r) => r.json());

const backLink = (scope: Page | Locator) =>
  scope.getByRole("link", { name: /volver a vacantes/i });

const robots = (page: Page) => page.locator('meta[name="robots"]');

async function expectBranded404(page: Page) {
  await expect(page.getByText(NOT_FOUND_COPY)).toBeVisible();
  await expect(backLink(page)).toHaveAttribute("href", "/vacantes");
  await expect(robots(page)).toHaveAttribute("content", /noindex/i);
}

test.describe.configure({ mode: "serial" });
test.beforeEach(async ({ request }) => {
  await request.get(`${fixtureUrl}/__reset`);
});

test("malformed UUID never reaches the API", async ({ page, request }) => {
  const response = await page.goto("/vacantes/not-a-uuid");
  expect(response?.status()).toBe(404);
  await expectBranded404(page);
  // Zero fixture requests: the malformed identifier is short-circuited.
  await expect.poll(() => fixtureRequests(request)).toEqual([]);
});

test("renders only validated contract data", async ({ page }) => {
  const response = await page.goto(`/vacantes/${MAIN_ID}`);
  expect(response?.status()).toBe(200);
  const article = page.getByRole("article");
  await expect(article).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(
    article.getByRole("heading", { level: 1, name: "Ingeniera Frontend" }),
  ).toBeVisible();
  await expect(article.getByText("Acme")).toBeVisible();
  for (const label of ["Remoto", "Tiempo completo", "Senior"]) {
    await expect(article.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(backLink(article)).toHaveAttribute("href", "/vacantes");
  // Omitted optionals stay omitted: no salary, date, or location copy.
  await expect(article).not.toContainText(/MXN|USD/);
  await expect(article).not.toContainText(/publicada/i);
  await expect(article).not.toContainText("undefined");
});

test("safe description and full metadata", async ({ page, baseURL }) => {
  const response = await page.goto(`/vacantes/${RICH_ID}`);
  expect(response?.status()).toBe(200);
  const article = page.getByRole("article");
  await expect(article.locator("script")).toHaveCount(0);
  await expect(article.locator("img")).toHaveCount(0);
  await expect(article.getByText(XSS_TEXT)).toBeVisible();
  // Blank lines split paragraphs; a single break stays inside one paragraph.
  const paragraphs = article.getByRole("paragraph");
  await expect(paragraphs).toHaveCount(4);
  await expect(paragraphs.last()).toHaveText(/Línea uno\nLínea dos\./);
  await expect(article.getByText(/MXN/)).toBeVisible();
  await expect(article.getByText(/publicada/i)).toBeVisible();
  await expect(article.getByText(/Monterrey/)).toBeVisible();
  // Dynamic title, self-canonical URL, and indexable robots metadata.
  await expect(page).toHaveTitle(/Desarrolladora Go \| PeopleFlow/);
  const canonical = page.locator('link[rel="canonical"]');
  const canonicalHref = `${baseURL}/vacantes/${RICH_ID}`;
  await expect(canonical).toHaveAttribute("href", canonicalHref);
  await expect(robots(page)).toHaveAttribute("content", /index/i);
  await expect(robots(page)).not.toHaveAttribute("content", /noindex/i);
});

test("dedupes metadata/page reads per request", async ({ page, request }) => {
  // One render issues exactly one detail read even though both the metadata
  // generation and the page read need the validated vacancy.
  await page.goto(`/vacantes/${RICH_ID}`);
  await expect.poll(() => fixtureRequests(request)).toEqual([richRequest]);
  // A second request re-reads the API: nothing persistent serves it.
  await request.get(`${fixtureUrl}/__reset`);
  await page.goto(`/vacantes/${RICH_ID}`);
  await expect.poll(() => fixtureRequests(request)).toEqual([richRequest]);
});

test("backend 404: noindex after API read", async ({ page, request }) => {
  const response = await page.goto(`/vacantes/${MISSING_ID}`);
  expect(response?.status()).toBe(404);
  await expectBranded404(page);
  // Unlike a malformed identifier, a valid UUID consults the API exactly once.
  await expect.poll(() => fixtureRequests(request)).toEqual([missingRequest]);
});

for (const kind of ["5xx", "schema", "timeout"] as const) {
  test(`${kind} failure stays retryable`, async ({ page, request }) => {
    await request.get(`${fixtureUrl}/__failure?kind=${kind}`);
    await page.goto(`/vacantes/${MAIN_ID}`);
    // Retryable failures never masquerade as the branded not-found page.
    await expect(page.getByText(NOT_FOUND_COPY)).toHaveCount(0);
    await expect(
      page.getByText(/intentar de nuevo|no se pudo cargar la vacante/i).first(),
    ).toBeVisible();
    const anyBack = page.getByRole("link", { name: /vacantes/i }).first();
    await expect(anyBack).toBeVisible();
  });
}
