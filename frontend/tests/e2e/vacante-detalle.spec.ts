import { expect, test, type APIRequestContext } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

const fixtureUrl = "http://127.0.0.1:4010";
// Fixture vacancies (tests/fixtures/jobs-server.mjs): main has no optional
// metadata, rich carries full metadata plus a markup-like description, long
// has an uninterrupted title segment and full optionals, and missing answers
// a backend 404. App origin comes from the harness baseURL.
const MAIN_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
const RICH_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d92";
const MISSING_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d99";
const LONG_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d90";
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
  const headings = page.getByRole("heading", {
    level: 1,
    name: NOT_FOUND_COPY,
  });
  await expect(headings).toHaveCount(1);
  await expect(headings).toBeVisible();
  await expect(backLink(page)).toHaveAttribute("href", "/vacantes");
  await expect(robots(page)).toHaveAttribute("content", /noindex/i);
}

// Returns document scrollWidth - clientWidth; a value > 0 means horizontal overflow.
function documentOverflowPx(page: Page) {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
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
    const headings = page.getByRole("heading", {
      level: 1,
      name: "No se pudo cargar la vacante",
    });
    await expect(headings).toHaveCount(1);
    await expect(headings).toBeVisible();
    const anyBack = page.getByRole("link", { name: /vacantes/i }).first();
    await expect(anyBack).toBeVisible();
  });
}

test("keyboard Tab+Enter activates the return link", async ({ page }) => {
  await page.goto(`/vacantes/${MAIN_ID}`);
  const link = backLink(page.getByRole("article"));
  for (
    let presses = 0;
    presses < 20 &&
    !(await link.evaluate((el) => el === document.activeElement));
    presses++
  ) {
    await page.keyboard.press("Tab");
  }
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/vacantes$/);
});

for (const [label, viewport] of [
  ["narrow", { width: 375, height: 812 }],
  ["wide", { width: 1280, height: 720 }],
] as const) {
  test(`long detail content wraps at ${label} width`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(`/vacantes/${LONG_ID}`);
    await expect(page.getByRole("article")).toBeVisible();
    expect(await documentOverflowPx(page)).toBeLessThanOrEqual(0);
  });
}

test("detail preserves preset typography, tokens, radius, and bounded UI", async ({
  page,
}) => {
  await page.goto(`/vacantes/${MAIN_ID}`);
  const article = page.getByRole("article");
  const evidence = await article.evaluate((element) => {
    const probe = document.createElement("span");
    document.body.appendChild(probe);
    const resolveColor = (token: string) => {
      probe.style.color = `var(${token})`;
      return getComputedStyle(probe).color;
    };
    const heading = element.querySelector("h1")!;
    const description = element.querySelector("p")!;
    const badge = element.querySelector("li")!;
    const result = {
      bodyFont: getComputedStyle(document.body).fontFamily,
      headingFont: getComputedStyle(heading).fontFamily,
      headingColor: getComputedStyle(heading).color,
      foreground: resolveColor("--foreground"),
      badgeColor: getComputedStyle(badge).color,
      radius: getComputedStyle(document.documentElement)
        .getPropertyValue("--radius")
        .trim(),
      inlineStyles: element.querySelectorAll("[style]").length,
      descriptionColor: getComputedStyle(description).color,
      mutedForeground: resolveColor("--muted-foreground"),
    };
    probe.remove();
    return result;
  });

  expect(evidence.bodyFont).toMatch(/Inter/);
  expect(evidence.headingFont).toMatch(/Inter/);
  expect(evidence.headingColor).toBe(evidence.foreground);
  expect(evidence.badgeColor).toBe(evidence.mutedForeground);
  expect(evidence.descriptionColor).toBe(evidence.mutedForeground);
  expect(evidence.radius).toMatch(/^(?:0?\.)625rem$/);
  expect(evidence.inlineStyles).toBe(0);
  await expect(
    article.getByRole("button", {
      name: /guardar|compartir|postular|solicitar|aplicar|beneficios/i,
    }),
  ).toHaveCount(0);
});

// Task 8.4 / C2 — detail visibility freshness: the same detail URL renders
// the vacancy, then the branded 404 after the fixture hides it, then the
// vacancy again, each across separate request-time renders.
test("C2: visibility mutations flip the rendered detail across separate request-time renders", async ({
  page,
  request,
}) => {
  const article = page.getByRole("article");
  const heading = article.getByRole("heading", {
    level: 1,
    name: "Ingeniera Frontend",
  });

  // Visible → hidden: a fresh render of the same URL answers backend 404.
  await page.goto(`/vacantes/${MAIN_ID}`);
  await expect(heading).toBeVisible();
  const hide = await request.get(`${fixtureUrl}/__visibility?hidden=1`);
  expect(hide.status()).toBe(200);
  expect(await hide.json()).toEqual({ ok: true, hidden: true });
  const hiddenResponse = await page.reload();
  expect(hiddenResponse?.status()).toBe(404);
  await expectBranded404(page);

  // Hidden → visible: the next request-time render restores the vacancy.
  const show = await request.get(`${fixtureUrl}/__visibility?hidden=0`);
  expect(show.status()).toBe(200);
  const restoredResponse = await page.reload();
  expect(restoredResponse?.status()).toBe(200);
  await expect(heading).toBeVisible();
});

// Task 8.4 / C2 — completed-response buffering matrix (detail half): each
// navigation arms a deterministic fixture delay, captures the document
// response, waits until that HTTP response completes, and only then asserts
// the final document state.
test("C2: buffered detail success renders the final article after the response completes", async ({
  page,
  request,
}) => {
  const armed = await request.get(`${fixtureUrl}/__delay?ms=300`);
  expect(armed.status()).toBe(200);
  const response = await page.goto(`/vacantes/${MAIN_ID}`);
  expect(response?.status()).toBe(200);
  await response!.finished();
  await expect(
    page
      .getByRole("article")
      .getByRole("heading", { level: 1, name: "Ingeniera Frontend" }),
  ).toBeVisible();
});

test("C2: buffered detail error renders the final retryable state after the response completes", async ({
  page,
  request,
}) => {
  await request.get(`${fixtureUrl}/__failure?kind=5xx`);
  const armed = await request.get(`${fixtureUrl}/__delay?ms=300`);
  expect(armed.status()).toBe(200);
  const response = await page.goto(`/vacantes/${MAIN_ID}`);
  await response!.finished();
  await expect(page.getByText(NOT_FOUND_COPY)).toHaveCount(0);
  const headings = page.getByRole("heading", {
    level: 1,
    name: "No se pudo cargar la vacante",
  });
  await expect(headings).toHaveCount(1);
  await expect(headings).toBeVisible();
});

test("C2: buffered detail not-found renders the final branded 404 after the response completes", async ({
  page,
  request,
}) => {
  const armed = await request.get(`${fixtureUrl}/__delay?ms=300`);
  expect(armed.status()).toBe(200);
  const response = await page.goto(`/vacantes/${MISSING_ID}`);
  expect(response?.status()).toBe(404);
  await response!.finished();
  await expectBranded404(page);
  await expect.poll(() => fixtureRequests(request)).toEqual([missingRequest]);
});
