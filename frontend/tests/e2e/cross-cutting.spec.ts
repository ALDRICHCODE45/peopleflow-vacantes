/**
 * Task 6.1 RED — cross-cutting integration evidence for the public job discovery
 * experience.  Complements the existing committed spec suite:
 *
 *   root.spec.ts          — foundation matrix, WCAG, Inter, b27M1Ev2 preset,
 *                           focus, images, no-ad-hoc-override, no root API requests
 *   vacantes.spec.ts      — canonical URL, MXN/USD currency, back-from-list,
 *                           mobile Sheet, overflow, empty reset, retry, pending,
 *                           filters, cursor, chip states
 *   vacante-detalle.spec.ts — malformed UUID guard, validated contract, safe markup,
 *                           404 branded, failures retryable, keyboard Tab+Enter,
 *                           long-content overflow
 *   vacantes-a11y.spec.ts — axe WCAG A/AA matrix, mobile Sheet title/Escape/focus,
 *                           keyboard focus visibility, overflow, typography tokens,
 *                           reduced motion
 *
 * This file covers only the cross-route/Forward/USD-profile gaps not addressed by
 * those files:
 *
 *   1. Root → listing → detail navigation chain (root → /vacantes → detail)
 *   2. Browser Back + Forward with canonical filtered results (Forward not in suite)
 *   3. Detail back preserves multi-filter list URL (both filters, not one)
 *   4. USD salary evidence profile — intentionally RED until Task 6.2 GREEN
 */

import { expect, test } from "@playwright/test";

const APP_ORIGIN = process.env.PLAYWRIGHT_APP_ORIGIN ?? "http://127.0.0.1:3000";
const FIXTURE_ORIGIN =
 process.env.PLAYWRIGHT_FIXTURE_ORIGIN ?? "http://127.0.0.1:4010";

// Fixture contract for Task 6.2 GREEN: the dedicated currency-proof vacancy
// that Task 6.2 fixture work must add.  The exact title, salary fields, and
// rendered format are pinned here so GREEN work produces a verifiable match.
//
// Fixture fields → rendered format:
//   title:           "Ingeniera Currency Proof"
//   salary_currency: "USD"
//   salary_min:      100000
//   salary_max:      120000
//   → renders as:   "USD 100,000 – USD 120,000"  (vacantes.spec.ts formatter contract)
const DEDICATED_TITLE = "Ingeniera Currency Proof";
const USD_SALARY_RENDERED = "USD 100,000 – USD 120,000";
// Generic MXN fallback that the dedicated profile must suppress on this query.
const GENERIC_MXN_SALARY = "MXN 25,000 – MXN 40,000";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ request }) => {
 await request.get(`${FIXTURE_ORIGIN}/__reset`);
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Root link opens the list and a vacancy opens its detail
// ─────────────────────────────────────────────────────────────────────────────

test("root link opens the list and a vacancy opens its detail", async ({
 page,
}) => {
 await page.goto(`${APP_ORIGIN}/`);

 const vacantesLink = page.getByRole("link", { name: /vacantes/i });
 await expect(vacantesLink).toBeVisible();
 await vacantesLink.click();

 await expect(page).toHaveURL(/\/vacantes$/);
 await expect(
  page.getByRole("heading", { level: 2, name: /vacantes disponibles/i }),
 ).toBeVisible();

 const vacancyTitle = page.getByRole("link", { name: /ingeniera frontend/i });
 await expect(vacancyTitle).toBeVisible();
 await vacancyTitle.first().click();

 await expect(page).toHaveURL(/\/vacantes\/[a-f0-9-]+$/);
 const article = page.getByRole("article");
 await expect(article.getByRole("heading", { level: 1 })).toBeVisible();
 await expect(article.getByText("Acme")).toBeVisible();
 await expect(
  article.getByRole("link", { name: /volver a vacantes/i }),
 ).toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Browser Back and Forward restore canonical filtered results
// ─────────────────────────────────────────────────────────────────────────────

test("browser Back and Forward restore canonical filtered results", async ({
 page,
}) => {
 await page.goto(`${APP_ORIGIN}/vacantes`);
 await expect(
  page.getByRole("heading", { level: 2, name: /vacantes disponibles/i }),
 ).toBeVisible();

 const searchInput = page.getByLabel(/buscar vacantes/i);
 await searchInput.fill("frontend");
 await page.getByRole("button", { name: /^buscar$/i }).click();
 await expect(page).toHaveURL(/\/vacantes\?q=frontend$/);
 await expect(searchInput).toHaveValue("frontend");
 await expect(page.getByRole("list")).toContainText("Ingeniera Frontend");

 await searchInput.fill("empty");
 await page.getByRole("button", { name: /^buscar$/i }).click();
 await expect(page).toHaveURL(/\/vacantes\?q=empty$/);
 await expect(searchInput).toHaveValue("empty");
 await expect(page.getByText(/no hay vacantes/i)).toBeVisible();

 await page.goBack();
 await expect(page).toHaveURL(/\/vacantes\?q=frontend$/);
 await expect(searchInput).toHaveValue("frontend");
 await expect(page.getByRole("list")).toContainText("Ingeniera Frontend");

 await page.goForward();
 await expect(page).toHaveURL(/\/vacantes\?q=empty$/);
 await expect(searchInput).toHaveValue("empty");
 await expect(page.getByText(/no hay vacantes/i)).toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Detail navigation preserves the filtered list URL on Back
// ─────────────────────────────────────────────────────────────────────────────

test("detail navigation preserves the filtered list URL on Back", async ({
 page,
}) => {
 // Canonical serialization order: q=<value>&currency=<value>
 const multiFilterUrl = `${APP_ORIGIN}/vacantes?q=frontend&currency=USD`;
 await page.goto(multiFilterUrl);

 await expect(page).toHaveURL(/\/vacantes\?q=frontend&currency=USD$/);
 await expect(page.getByLabel(/buscar vacantes/i)).toHaveValue("frontend");
 await expect(page.getByRole("list")).toContainText("Ingeniera Frontend");

 await page
  .getByRole("link", { name: /ingeniera frontend/i })
  .first()
  .click();
 await expect(page).toHaveURL(/\/vacantes\/[a-f0-9-]+$/);
 await expect(page.getByRole("article")).toBeVisible();

 await page.goBack();
 await expect(page).toHaveURL(/\/vacantes\?q=frontend&currency=USD$/);
 await expect(page.getByLabel(/buscar vacantes/i)).toHaveValue("frontend");
 await expect(page.getByRole("list")).toContainText("Ingeniera Frontend");
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. INTENTIONAL RED — renders exact USD salary data from the currency evidence
//    profile.  Task 6.2 GREEN adds the dedicated fixture vacancy; this test
//    fails now because that vacancy does not yet exist in the fixture.
//
//    Harness proof before the RED gate:
//    - Direct GET /jobs?q=currency-proof&currency=USD returns HTTP 200 with a
//      valid items array (fixture is healthy; generic MXN data is served).
//    - The PeopleFlow list shell renders (HTTP 200, results area present).
//
//    RED gate — the dedicated title and USD salary are absent because the
//    Task 6.2 fixture vacancy does not exist yet.
// ─────────────────────────────────────────────────────────────────────────────

test.fail("renders exact USD salary data from the currency evidence profile", async ({
 page,
 request,
}) => {
 // Harness proof A: fixture endpoint is reachable and schema-valid.
 // Current generic fixture returns HTTP 200 + valid items array.
 // This assertion stays green after Task 6.2 when the dedicated vacancy lands.
 const apiResponse = await request.get(
  `${FIXTURE_ORIGIN}/jobs?q=currency-proof&currency=USD`,
 );
 expect(apiResponse.status()).toBe(200);
 const apiBody = (await apiResponse.json()) as { items?: unknown[] };
 expect(Array.isArray(apiBody.items)).toBe(true);

 // Harness proof B: PeopleFlow list shell renders with valid structure.
 await page.goto(`${APP_ORIGIN}/vacantes?q=currency-proof&currency=USD`);
 await expect(
  page.getByRole("heading", { level: 2, name: /vacantes disponibles/i }),
 ).toBeVisible();
 // The list container itself is present (schema-valid PeopleFlow shell).
 await expect(page.getByRole("list")).toBeVisible();

 // RED gate — these fail now, pass after Task 6.2 GREEN.
 // Exact accessible link name (not regex): the dedicated title is unique and
 // absent from generic fixture data, so absence = profile missing.
 await expect(page.getByRole("link", { name: DEDICATED_TITLE })).toBeVisible();

 // Exact USD salary range rendered by the proven vacantes.spec.ts formatter.
 await expect(page.getByRole("list")).toContainText(USD_SALARY_RENDERED);

 // The generic MXN fallback must be absent once the dedicated profile exists.
 // (Currently passes because generic MXN data is served; remains green after
 // Task 6.2 because the dedicated profile replaces the generic vacancy.)
 await expect(page.getByRole("list")).not.toContainText(GENERIC_MXN_SALARY);
});
