import { expect, test } from "@playwright/test";

const fixtureUrl = "http://127.0.0.1:4010";
const appUrl = "http://127.0.0.1:3000";
test.describe.configure({ mode: "serial" });
test.beforeEach(async ({ request }) => {
  await request.get(`${fixtureUrl}/__reset`);
});

test("fixture remains healthy and accepts only test jobs requests", async ({
  request,
}) => {
  await expect
    .poll(async () => (await request.get(`${fixtureUrl}/__health`)).json())
    .toEqual({ ok: true });
  await request.get(`${fixtureUrl}/jobs?currency=MXN`);
  await expect
    .poll(async () => (await request.get(`${fixtureUrl}/__requests`)).json())
    .toEqual(["?currency=MXN"]);
});

test("canonicalizes before API access", async ({ page, request }) => {
  const apiRequests: string[] = [];
  page.on("request", (entry) => {
    if (entry.url().startsWith(fixtureUrl)) apiRequests.push(entry.url());
  });

  // The non-canonical request is inspected without following its redirect:
  // Node fetch in manual mode exposes the raw 307 and its Location header.
  const redirectResponse = await fetch(
    `${appUrl}/vacantes?currency=mxn&unknown=drop-me`,
    { redirect: "manual" },
  );
  await redirectResponse.body?.cancel();
  expect(redirectResponse.status).toBe(307);
  const location = new URL(redirectResponse.headers.get("location")!, appUrl);
  expect(location.pathname).toBe("/vacantes");
  expect(location.search).toBe("");

  // Zero API access for the redirecting request: browser and server logs agree.
  expect(apiRequests).toEqual([]);
  await expect
    .poll(async () => (await request.get(`${fixtureUrl}/__requests`)).json())
    .toEqual([]);

  // The canonical target is loaded separately and performs the expected
  // unfiltered server fetch.
  await page.goto("/vacantes");
  await expect
    .poll(async () => (await request.get(`${fixtureUrl}/__requests`)).json())
    .toEqual([""]);
  await expect(page).toHaveURL("/vacantes");
});

test("renders validated semantic vacancies with labeled scalar desktop filters", async ({
  page,
}) => {
  await page.goto("/vacantes?currency=MXN");
  await expect(
    page.getByRole("heading", { level: 1, name: /vacantes/i }),
  ).toBeVisible();
  await expect(page.getByRole("list")).toContainText("Ingeniera Frontend");
  await expect(page.getByLabel(/buscar/i)).toBeVisible();
  for (const label of [
    /senioridad/i,
    /modalidad/i,
    /tipo de empleo/i,
    /ubicación/i,
    /moneda/i,
  ])
    await expect(page.getByLabel(label)).toBeVisible();
});

test("uses a 240–280px desktop filter column beside flexible results", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/vacantes");
  const filters = page.getByRole("form", { name: /filtros/i });
  const [filterBox, resultsBox] = await Promise.all([
    filters.boundingBox(),
    page.getByRole("list").boundingBox(),
  ]);
  expect(filterBox).not.toBeNull();
  expect(resultsBox).not.toBeNull();
  expect(filterBox!.width).toBeGreaterThanOrEqual(240);
  expect(filterBox!.width).toBeLessThanOrEqual(280);
  expect(filterBox!.x + filterBox!.width).toBeLessThanOrEqual(resultsBox!.x);
  expect(resultsBox!.width).toBeGreaterThan(filterBox!.width);
});

test("renders empty results with an unfiltered reset link", async ({
  page,
}) => {
  await page.goto("/vacantes?q=empty");
  await expect(page.getByText(/no hay vacantes/i)).toBeVisible();
  await expect(
    page.getByRole("link", { name: /quitar filtros/i }),
  ).toHaveAttribute("href", "/vacantes");
});

test("renders a retryable Spanish error without vacancy rows", async ({
  page,
}) => {
  await page.goto("/vacantes?q=error");
  await expect(
    page.getByRole("alert").filter({ hasText: /intentar de nuevo/i }),
  ).toContainText(/intentar de nuevo/i);
  await expect(page.getByRole("list")).toHaveCount(0);
});

async function expectPending(
  page: import("@playwright/test").Page,
  initiating: import("@playwright/test").Locator,
  usable: import("@playwright/test").Locator,
) {
  const status = page.getByRole("status");
  await expect(status).toHaveAttribute("aria-live", "polite");
  await expect(status).toContainText(/cargando/i);
  await expect(initiating).toBeDisabled();
  await expect(usable).toBeEnabled();
  await expect(
    page.getByRole("link", { name: /ver más vacantes/i }),
  ).not.toHaveAttribute("aria-busy", "true");
}

test("announces pending search navigation without blocking filters", async ({
  page,
}) => {
  await page.goto("/vacantes");
  const search = page.getByLabel(/buscar/i),
    submit = page.getByRole("button", { name: /^buscar$/i });
  await search.fill("pending-search");
  await submit.click();
  await expectPending(
    page,
    submit,
    page.getByRole("button", { name: /aplicar filtros/i }),
  );
  await expect(page).toHaveURL(/q=pending-search/);
  await expect(page.getByRole("status")).not.toContainText(/cargando/i);
  await expect(search).toBeEnabled();
});

test("announces pending scalar-filter navigation without blocking search", async ({
  page,
}) => {
  await page.goto("/vacantes");
  await page.getByLabel(/moneda/i).click();
  await page.getByRole("option", { name: "USD" }).click();
  const submit = page.getByRole("button", { name: /aplicar filtros/i });
  await submit.click();
  await expectPending(
    page,
    submit,
    page.getByRole("button", { name: /^buscar$/i }),
  );
  await expect(page).toHaveURL(/currency=USD/);
  await expect(page.getByRole("status")).not.toContainText(/cargando/i);
});

test("announces pending next navigation and preserves its opaque cursor", async ({
  page,
}) => {
  await page.goto("/vacantes?q=frontend&currency=MXN");
  const next = page.getByRole("link", { name: /ver más vacantes/i });
  await expect(next).toHaveAttribute(
    "href",
    /q=frontend.*currency=MXN.*cursor=opaque\+a%2Bb%2Fc%3D/,
  );
  await next.click();
  await expect(page.getByRole("status")).toHaveAttribute("aria-live", "polite");
  await expect(page.getByRole("status")).toContainText(/cargando/i);
  await expect(next).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("button", { name: /^buscar$/i })).toBeEnabled();
  await expect(page).toHaveURL(/cursor=opaque\+a%2Bb%2Fc%3D/);
  await expect(page.getByRole("status")).not.toContainText(/cargando/i);
});

test("opens a titled Base UI mobile filters sheet", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/vacantes");
  const filters = page.getByRole("button", { name: /filtros/i });
  await expect(filters).toBeVisible();
  await filters.click();
  await expect(page.getByRole("dialog")).toHaveAccessibleName(/filtros/i);
  await expect(page.getByRole("dialog").getByLabel(/moneda/i)).toBeVisible();
});

test("omits unavailable optional metadata", async ({ page }) => {
  await page.goto("/vacantes?currency=MXN");
  await expect(page.getByRole("list")).not.toContainText(
    /undefined|ubicación no disponible|sueldo no disponible/i,
  );
});

test("raw empty and repeated query states redirect before API access", async ({
  request,
}) => {
  for (const [raw, target] of [
    ["/vacantes?q=", "/vacantes"],
    ["/vacantes?q=&q=frontend", "/vacantes"],
  ] as const) {
    const response = await fetch(`${appUrl}${raw}`, { redirect: "manual" });
    await response.body?.cancel();
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!, appUrl);
    expect(location.pathname + location.search).toBe(target);
    await expect
      .poll(async () => (await request.get(`${fixtureUrl}/__requests`)).json())
      .toEqual([]);
  }
});

test("browser Back restores URL-owned control values", async ({ page }) => {
  await page.goto("/vacantes");
  await page.getByLabel("Buscar vacantes").fill("frontend");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await page.waitForURL(/q=frontend/);
  await page.getByLabel(/moneda/i).click();
  await page.getByRole("option", { name: "USD" }).click();
  await page.getByRole("button", { name: /aplicar filtros/i }).click();
  await page.waitForURL(/q=frontend&currency=USD/);
  await page.goBack();
  await expect(page).toHaveURL(/\/vacantes\?q=frontend$/);
  await expect(page.getByLabel(/moneda/i)).toHaveText(/Todas/);
  await page.goBack();
  await expect(page).toHaveURL(/\/vacantes$/);
  await expect(page.getByLabel("Buscar vacantes")).toHaveValue("");
});

test("clears one scalar through its explicit null option", async ({ page }) => {
  await page.goto("/vacantes?q=frontend&currency=MXN");
  await page.getByLabel(/moneda/i).click();
  await page.getByRole("option", { name: "Todas" }).click();
  await page.getByRole("button", { name: /aplicar filtros/i }).click();
  await expect(page).toHaveURL(/\/vacantes\?q=frontend$/);
});

test("modified next-link clicks keep native new-tab semantics", async ({
  page,
}) => {
  await page.goto("/vacantes?currency=MXN");
  const next = page.getByRole("link", { name: /ver más vacantes/i });
  const [popup] = await Promise.all([
    page.context().waitForEvent("page"),
    next.click({ modifiers: ["Control"] }),
  ]);
  expect(popup).toBeTruthy();
  await expect(page).toHaveURL(/currency=MXN/);
  await expect(page.getByRole("status")).not.toContainText(/cargando/i);
  await expect(next).not.toHaveAttribute("aria-busy", "true");
  await popup.close();
});

test("mobile filters trigger meets touch-target size and dialog exposes Cerrar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/vacantes");
  const trigger = page.getByRole("button", { name: /filtros/i });
  await expect(trigger).toBeVisible();
  const box = await trigger.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAccessibleName(/filtros/i);
  await expect(
    dialog.getByRole("button", { name: "Cerrar filtros" }),
  ).toBeVisible();
});
