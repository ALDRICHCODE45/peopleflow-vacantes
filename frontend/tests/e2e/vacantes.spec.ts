import { createRequire } from "node:module";
import type { ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { expect, test, type Locator } from "@playwright/test";

const fixtureUrl = "http://127.0.0.1:4010";
const appUrl = process.env.PLAYWRIGHT_APP_ORIGIN ?? "http://127.0.0.1:3100";
const errorHarnessUrl = "http://127.0.0.1:3101/__vacantes-error";
type HarnessServer = {
  close(): Promise<void>;
  listen(): Promise<void>;
  middlewares: {
    use(path: string, handler: (_request: unknown, response: ServerResponse) => void): void;
  };
  transformIndexHtml(path: string, html: string): Promise<string>;
};
let errorHarness: HarnessServer | undefined;

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  const viteRequire = createRequire(require.resolve("vitest/package.json"));
  const vite = (await import(pathToFileURL(viteRequire.resolve("vite")).href)) as {
    createServer(options: Record<string, unknown>): Promise<HarnessServer>;
  };
  errorHarness = await vite.createServer({
    root: process.cwd(),
    server: { host: "127.0.0.1", port: 3101, strictPort: true },
    plugins: [{
      name: "vacantes-error-harness",
      configureServer(server: HarnessServer) {
        server.middlewares.use("/__vacantes-error", async (_request, response) => {
          const html = await server.transformIndexHtml("/__vacantes-error", `<main id="root"></main><script type="module">import { createElement } from "react"; import { createRoot } from "react-dom/client"; import VacantesError from "/src/app/(public)/vacantes/error.tsx"; createRoot(document.getElementById("root")).render(createElement(VacantesError, { error: new Error("fixture failure"), reset() {} }));</script>`);
          response.setHeader("Content-Type", "text/html");
          response.end(html);
        });
      },
    }],
  });
  await errorHarness.listen();
});
test.afterAll(async () => errorHarness?.close());
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

  // The canonical URL owns the state: default controls show an empty
  // search and the default currency, and the exact URL survives refresh.
  await expect(page.getByLabel(/buscar/i)).toHaveValue("");
  await expect(page.getByLabel(/moneda/i)).toHaveText(/Todas/);
  const canonicalUrl = page.url();
  await page.reload();
  await expect(page).toHaveURL("/vacantes");
  await expect(page.getByLabel(/buscar/i)).toHaveValue("");
  await expect(page.getByLabel(/moneda/i)).toHaveText(/Todas/);
  await expect(page.getByRole("list")).toContainText("Ingeniera Frontend");
  await expect
    .poll(async () => (await request.get(`${fixtureUrl}/__requests`)).json())
    .toEqual(["", ""]);

  // Reopening the captured canonical URL in a second page reproduces the
  // same unfiltered results from the fixture log; the owned page is
  // closed before the test ends.
  const shared = await page.context().newPage();
  try {
    await shared.goto(canonicalUrl);
    await expect(shared).toHaveURL("/vacantes");
    await expect(shared.getByLabel(/buscar/i)).toHaveValue("");
    await expect(shared.getByLabel(/moneda/i)).toHaveText(/Todas/);
    await expect
      .poll(async () => (await request.get(`${fixtureUrl}/__requests`)).json())
      .toEqual(["", "", ""]);
    await expect(shared.getByRole("list")).toContainText("Ingeniera Frontend");
  } finally {
    await shared.close();
  }
});

test("renders validated semantic vacancies with labeled scalar desktop filters", async ({
  page,
}) => {
  await page.goto("/vacantes?currency=MXN");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: /encuentra tu próximo trabajo en tech/i,
    }),
  ).toBeVisible();
  await expect(page.getByRole("list")).toContainText("Ingeniera Frontend");
  await expect(page.getByLabel(/buscar/i)).toBeVisible();
  // Labeled scalar filters live in the sidebar form; the hero location
  // input shares the "Ubicación" label, so scope to the form.
  const filtersForm = page.getByRole("form", { name: "Filtros" });
  for (const label of [
    /senioridad/i,
    /modalidad/i,
    /tipo de empleo/i,
    /^Ubicación$/,
    /moneda/i,
  ])
    await expect(filtersForm.getByLabel(label)).toBeVisible();
});

test("renders the approved hero and supported quick chips with honest state", async ({
  page,
}) => {
  await page.goto("/vacantes");

  // Hero composition: eyebrow, approved H1, and results heading.
  await expect(page.getByText("Bolsa de trabajo")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Encuentra tu próximo trabajo en tech",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Vacantes disponibles" }),
  ).toBeVisible();

  // Truthful public chrome only: no theme toggle, auth, or publish actions.
  await expect(page.locator("header").getByRole("button")).toHaveCount(0);
  await expect(
    page.getByText(/publicar vacante|ingresar|iniciar sesión/i),
  ).toHaveCount(0);

  // Supported quick chips only, with honest pressed state.
  const todas = page.getByRole("button", { name: "Todas", exact: true });
  await expect(todas).toHaveAttribute("aria-pressed", "true");
  for (const label of [
    "Remoto",
    "Híbrido",
    "Tiempo completo",
    "Medio",
    "Senior",
  ]) {
    await expect(
      page.getByRole("button", { name: label, exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
  }
  await expect(
    page.getByRole("button", { name: /prácticas|beca|presencial/i }),
  ).toHaveCount(0);

  // A chip commits through the canonical scalar pipeline and the pressed
  // state follows the resulting canonical URL.
  await page.getByRole("button", { name: "Remoto", exact: true }).click();
  await expect(page).toHaveURL("/vacantes?work_mode=remote");
  await expect(todas).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByRole("button", { name: "Remoto", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  // The reset chip returns to the unfiltered canonical list.
  await todas.click();
  await expect(page).toHaveURL("/vacantes");
  await expect(todas).toHaveAttribute("aria-pressed", "true");
});

test("renders surfaced vacancy cards with API-backed metadata only", async ({
  page,
}) => {
  await page.goto("/vacantes?currency=MXN");
  const list = page.getByRole("list");
  await expect(list.getByRole("listitem").first()).toBeVisible();

  // Supported metadata from the fixture vacancy is surfaced.
  await expect(list).toContainText("Ingeniera Frontend");
  await expect(list).toContainText("Acme");
  await expect(list).toContainText("Remoto");
  await expect(list).toContainText("Tiempo completo");

  // A deterministic company-initials tile accompanies each card.
  await expect(list.locator("span[aria-hidden='true']").first()).toHaveText(
    /^[A-ZÁÉÍÓÚÑÜ·]{1,2}$/,
  );

  // No fabricated or unsupported metadata: no featured state, relative
  // time, or salary period.
  await expect(page.getByText(/destacada/i)).toHaveCount(0);
  await expect(list).not.toContainText(/hace \d+/);
  await expect(list).not.toContainText(/\/ mes/);
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

test("activates the empty-state reset to the unfiltered canonical list", async ({
  page,
}) => {
  await page.goto("/vacantes?q=empty");
  const emptyHeading = page.getByText(/no hay vacantes/i);
  await expect(emptyHeading).toBeVisible();
  await page.getByRole("link", { name: /quitar filtros/i }).click();

  // The reset action lands on the exact canonical route with no query
  // state, default controls, and the unfiltered result list restored.
  await expect(page).toHaveURL("/vacantes");
  await expect(page.getByLabel(/buscar/i)).toHaveValue("");
  await expect(page.getByLabel(/moneda/i)).toHaveText(/Todas/);
  await expect(page.getByRole("list")).toContainText("Ingeniera Frontend");
  await expect(emptyHeading).toHaveCount(0);
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

const recoverySearch = "?q=recovery&currency=MXN";

/** Drives one armed-failure recovery: the fixture fails the initial
 * request persistently, recovers healthily while keeping its request
 * history, and the retry activation must restore the exact URL-owned
 * controls and results with a fresh matching server request. */
async function expectRecoveryAfterRetry(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
  kind: "5xx" | "schema" | "timeout",
) {
  await request.get(`${fixtureUrl}/__failure?kind=${kind}`);
  await page.goto(`/vacantes${recoverySearch}`);
  const alert = page
    .getByRole("alert")
    .filter({ hasText: /intentar de nuevo/i });
  await expect(alert).toContainText(/intentar de nuevo/i);
  await expect(page.getByRole("list")).toHaveCount(0);

  // The fixture recovers without clearing its request history: the
  // armed initial failure is the last logged request, and the retry
  // activation must append a fresh matching request after it.
  await request.get(`${fixtureUrl}/__recover`);
  const before = (await (
    await request.get(`${fixtureUrl}/__requests`)
  ).json()) as string[];
  await expect(before[before.length - 1]).toBe(recoverySearch);

  // URL-owned control state is preserved before the retry click.
  await expect(page).toHaveURL(`/vacantes${recoverySearch}`);
  await expect(page.getByLabel("Buscar vacantes")).toHaveValue("recovery");
  await expect(page.getByLabel(/moneda/i)).toHaveText(/MXN/);

  await page.getByRole("link", { name: /intentar de nuevo/i }).click();

  await expect(page).toHaveURL(`/vacantes${recoverySearch}`);
  await expect(page.getByLabel("Buscar vacantes")).toHaveValue("recovery");
  await expect(page.getByLabel(/moneda/i)).toHaveText(/MXN/);
  await expect(alert).toHaveCount(0);
  await expect(page.getByRole("list")).toContainText("Ingeniera Frontend");

  // A fresh same-query server request proves the recovery actually
  // re-fetched (the last logged request matches the current query).
  await expect
    .poll(async () => {
      const history = (await request
        .get(`${fixtureUrl}/__requests`)
        .then((response) => response.json())) as string[];
      return (
        history.length > before.length &&
        history[history.length - 1] === recoverySearch
      );
    })
    .toBe(true);
}

test("recovers after HTTP 5xx", async ({ page, request }) => {
  await expectRecoveryAfterRetry(page, request, "5xx");
});

test("recovers after invalid schema", async ({ page, request }) => {
  await expectRecoveryAfterRetry(page, request, "schema");
});

test("recovers after timeout", async ({ page, request }) => {
  await expectRecoveryAfterRetry(page, request, "timeout");
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
  request,
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

  // The scalar navigation commits the exact canonical URL, keeps the USD
  // selection in the control, and the fixture log proves the exact USD
  // server requests (the fixture returns the same payload for every
  // filter, so row text alone cannot prove which request was made).
  await expect(page).toHaveURL("/vacantes?currency=USD");
  await expect
    .poll(async () => (await request.get(`${fixtureUrl}/__requests`)).json())
    .toEqual(["", "?currency=USD"]);
  await expect(page.getByLabel(/moneda/i)).toHaveText(/^USD/);

  // Refreshing and reopening the captured URL in a second page restore
  // the USD selection with visible results; owned pages are closed
  // before the test ends.
  const usdUrl = page.url();
  await page.reload();
  await expect(page).toHaveURL("/vacantes?currency=USD");
  await expect(page.getByLabel(/moneda/i)).toHaveText(/^USD/);
  await expect(page.getByLabel(/buscar/i)).toHaveValue("");
  await expect(page.getByRole("list")).toContainText("Ingeniera Frontend");
  await expect
    .poll(async () => (await request.get(`${fixtureUrl}/__requests`)).json())
    .toEqual(["", "?currency=USD", "?currency=USD"]);
  const shared = await page.context().newPage();
  try {
    await shared.goto(usdUrl);
    await expect(shared).toHaveURL("/vacantes?currency=USD");
    await expect(shared.getByLabel(/moneda/i)).toHaveText(/^USD/);
    await expect(shared.getByLabel(/buscar/i)).toHaveValue("");
    await expect
      .poll(async () => (await request.get(`${fixtureUrl}/__requests`)).json())
      .toEqual(["", "?currency=USD", "?currency=USD", "?currency=USD"]);
    await expect(shared.getByRole("list")).toContainText("Ingeniera Frontend");
  } finally {
    await shared.close();
  }
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

test("forwards all six filters AND-shaped, resets the cursor on filter submission, preserves it on next, and omits pagination on the nonempty final page", async ({
  page,
  request,
}) => {
  const six =
    "q=frontend&seniority=senior&work_mode=remote&employment_type=full_time&location=Monterrey&currency=MXN";
  const cursor = "cursor=opaque+a%2Bb%2Fc%3D";
  const filtered = (q: string) => six.replace("q=frontend", `q=${q}`);

  // Prohibited pagination: forward next links/buttons, reverse controls,
  // and numbered/total placeholders must be absent on every final page.
  const expectNoPagination = async () => {
    await expect(
      page.getByRole("link", { name: /ver más vacantes|siguiente/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /ver más|siguiente/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: /anterior|página anterior/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /anterior|página anterior/i }),
    ).toHaveCount(0);
    await expect(page.getByText(/página \d+/i)).toHaveCount(0);
    await expect(page.getByText(/de \d+ páginas?/i)).toHaveCount(0);
    await expect(page.getByText(/\d+ vacantes/i)).toHaveCount(0);
  };

  // A canonical load with every supported filter plus an existing cursor
  // forwards all six values AND-shaped in one exact server request; a
  // cursor request answers the nonempty final page, so results are
  // visible while every pagination control is omitted.
  await page.goto(`/vacantes?${filtered("frontend")}&${cursor}`);
  await expect(page).toHaveURL(`/vacantes?${filtered("frontend")}&${cursor}`);
  await expect
    .poll(async () => (await request.get(`${fixtureUrl}/__requests`)).json())
    .toEqual([`?${filtered("frontend")}&${cursor}`]);
  await expect(page.getByRole("list")).toContainText("Ingeniera Frontend");
  await expectNoPagination();

  // Submitting a changed filter preserves all six active filters and
  // resets pagination: the committed canonical URL omits the old cursor.
  await page.getByLabel("Buscar vacantes").fill("react");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  const commitUrl = `/vacantes?${filtered("react")}`;
  await expect(page).toHaveURL(commitUrl);
  await expect
    .poll(async () => (await request.get(`${fixtureUrl}/__requests`)).json())
    .toEqual([`?${filtered("frontend")}&${cursor}`, `?${filtered("react")}`]);

  // The next link carries all six filters plus the exact fixture cursor
  // (decoded value `opaque a+b/c=`); activating it requests that exact
  // URL, which is again the nonempty final page without pagination.
  const nextHref = `${commitUrl}&${cursor}`;
  await expect(
    page.getByRole("link", { name: /ver más vacantes/i }),
  ).toHaveAttribute("href", nextHref);
  await page.getByRole("link", { name: /ver más vacantes/i }).click();
  await expect(page).toHaveURL(nextHref);
  await expect(page.getByLabel("Buscar vacantes")).toHaveValue("react");
  await expect
    .poll(async () => (await request.get(`${fixtureUrl}/__requests`)).json())
    .toEqual([
      `?${filtered("frontend")}&${cursor}`,
      `?${filtered("react")}`,
      `?${filtered("react")}&${cursor}`,
    ]);
  await expect(page.getByRole("status")).not.toContainText(/cargando/i);
  await expect(page.getByRole("list")).toContainText("Ingeniera Frontend");
  await expectNoPagination();
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

test("long vacancy content remains readable", async ({ page }) => {
  const longTitleSegment =
    "plataformaoperativadedatosyobservabilidadintegraldistribuida";
  const longCompany =
    "Consultoría Integral de Ingeniería de Software y Datos Confiables";
  const longLocation = "Zona Metropolitana Extendida Noreste";
  const rectsOf = (locator: Locator) =>
    locator.evaluate((el) =>
      Array.from(el.getClientRects()).map((rect) => ({
        left: rect.left,
        right: rect.right,
      })),
    );

  for (const viewport of [
    { width: 375, height: 812 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/vacantes?q=long-content");
    const list = page.getByRole("list");
    const title = page.getByRole("link", { name: /observabilidad/i });
    const company = list.getByText(longCompany);
    const location = list.getByText(longLocation);

    // Every supplied long text renders inside the semantic row.
    await expect(title).toBeVisible();
    await expect(title).toContainText(longTitleSegment);
    await expect(company).toBeVisible();
    await expect(location).toBeVisible();
    await expect(list).toContainText("MXN 1,234,567");
    await expect(list).toContainText("MXN 98,765,432");

    // The row and the whole document stay inside the viewport: the
    // uninterrupted title segment must not force horizontal overflow.
    const listBox = await list.boundingBox();
    expect(listBox).not.toBeNull();
    expect(listBox!.x).toBeGreaterThanOrEqual(0);
    expect(listBox!.x + listBox!.width).toBeLessThanOrEqual(viewport.width);
    const documentWidth = await page.evaluate(() => ({
      scrollWidth: document.scrollingElement!.scrollWidth,
      clientWidth: document.scrollingElement!.clientWidth,
    }));
    expect(documentWidth.scrollWidth).toBeLessThanOrEqual(
      documentWidth.clientWidth,
    );

    // No text box is clipped, truncated, nowrap, or fixed-height loss:
    // no element in the row hides overflow, shows an ellipsis, or has
    // content wider/taller than its own box.
    const row = list.getByRole("listitem");
    const clipped = await row.evaluate(
      (li) =>
        [li, ...li.querySelectorAll("h2, div, span, a")].filter((el) => {
          const style = getComputedStyle(el);
          return (
            style.overflowX === "hidden" ||
            style.overflowY === "hidden" ||
            style.textOverflow === "ellipsis" ||
            style.whiteSpace === "nowrap" ||
            el.scrollWidth > el.clientWidth + 1 ||
            el.scrollHeight > el.clientHeight + 1
          );
        }).length,
    );
    expect(clipped).toBe(0);

    // Heading and detail boxes stack without overlapping.
    const childBoxes = await row.evaluate((li) =>
      Array.from(li.children).map((child) => {
        const box = child.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom };
      }),
    );
    expect(childBoxes).toHaveLength(2);
    expect(childBoxes[0].bottom).toBeLessThanOrEqual(childBoxes[1].top);

    // Every rendered text range stays horizontally inside the viewport.
    for (const text of [title, company, location]) {
      for (const rect of await rectsOf(text)) {
        expect(rect.left).toBeGreaterThanOrEqual(0);
        expect(rect.right).toBeLessThanOrEqual(viewport.width);
      }
    }

    // The narrow viewport demonstrably wraps the long title onto
    // multiple rendered lines.
    if (viewport.width === 375) {
      expect((await rectsOf(title)).length).toBeGreaterThanOrEqual(2);
    }
  }
});

test("renders the real list error boundary with one h1", async ({ page }) => {
  await page.goto(errorHarnessUrl);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "No se pudieron cargar las vacantes",
    }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 2 })).toHaveCount(0);
});
