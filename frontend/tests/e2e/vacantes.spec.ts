import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";

const fixtureUrl = process.env.JOBS_FIXTURE_ORIGIN ?? "http://127.0.0.1:4010";
// Task 8.4 — the default fixture vacancy whose visibility the request-time
// freshness matrix mutates through the fixture's `/__visibility` control.
const MAIN_VACANCY_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
const MAIN_VACANCY_TITLE = "Ingeniera Frontend";
const appUrl = process.env.PLAYWRIGHT_APP_ORIGIN ?? "http://127.0.0.1:3100";
const errorHarnessUrl = "http://127.0.0.1:3101/__vacantes-error";
// The Base UI development diagnostic that fires whenever a shared `Button`
// renders a root that is not a native <button>.
const NATIVE_BUTTON_DIAGNOSTIC = /nativeButton|expected a native <button>/u;
// Document horizontal overflow in pixels; anything above zero fails.
const overflowPx = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
// The navigation island's paragraph live region; prototype feedback statuses are spans.
const navStatus = (page: Page) => page.locator("p[role='status']");

async function bufferMainDocuments(
  page: Page,
  url: string,
  completedStatuses: number[],
) {
  await page.route(url, async (route) => {
    if (route.request().resourceType() !== "document")
      return route.continue();
    const upstream = await route.fetch();
    const body = await upstream.body();
    completedStatuses.push(upstream.status());
    await route.fulfill({ response: upstream, body });
  });
}

type HarnessServer = {
  close(): Promise<void>;
  listen(): Promise<void>;
  middlewares: {
    use(
      path: string,
      handler: (_r: unknown, response: ServerResponse) => void,
    ): void;
  };
  transformIndexHtml(path: string, html: string): Promise<string>;
};
const errorHarnessHtml = `<main id="root"></main><script type="module">import { createElement } from "react"; import { createRoot } from "react-dom/client"; import VacantesError from "/src/app/(candidato)/vacantes/error.tsx"; createRoot(document.getElementById("root")).render(createElement(VacantesError, { error: new Error("fixture failure"), reset() {} }));</script>`;
let errorHarness: HarnessServer | undefined;

// Each test resets its fixture state; a failure must not hide later coverage.
test.describe.configure({ mode: "default" });
test.beforeAll(async () => {
  const viteRequire = createRequire(require.resolve("vitest/package.json"));
  const vite = (await import(
    pathToFileURL(viteRequire.resolve("vite")).href
  )) as {
    createServer(options: Record<string, unknown>): Promise<HarnessServer>;
  };
  errorHarness = await vite.createServer({
    root: process.cwd(),
    resolve: { alias: { "@": resolve(process.cwd(), "src") } },
    define: { "process.env": "{}" },
    esbuild: { jsx: "automatic" },
    server: { host: "127.0.0.1", port: 3101, strictPort: true },
    plugins: [
      {
        name: "vacantes-error-harness",
        configureServer(server: HarnessServer) {
          server.middlewares.use(
            "/__vacantes-error",
            async (_request, response) => {
              response.setHeader("Content-Type", "text/html");
              response.end(
                await server.transformIndexHtml(
                  "/__vacantes-error",
                  errorHarnessHtml,
                ),
              );
            },
          );
        },
      },
    ],
  });
  await errorHarness.listen();
});
test.afterAll(async () => errorHarness?.close());
test.beforeEach(async ({ context, request }) => {
  // Isolate explicit navigations from Next's speculative DETAIL prefetches
  // only. Aborting a prefetch can leave a failed router-cache entry, so the
  // next navigation to that URL may be dropped: list, login and other routes
  // must keep their prefetches (measured: aborting all of them made the quick
  // filter «Todas» lose its navigation 2 of 5 runs). Exact fixture history
  // assertions still fail on any extra list read or canonicalization access.
  await context.route("**/*", route =>
    route.request().headers()["next-router-prefetch"] === "1" &&
    /^\/vacantes\/[^/?]+/u.test(new URL(route.request().url()).pathname)
      ? route.abort()
      : route.continue(),
  );
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
  await expect(page.getByLabel(/moneda/i)).toHaveText(/^MXN/);
  const canonicalUrl = page.url();
  await page.reload();
  await expect(page).toHaveURL("/vacantes");
  await expect(page.getByLabel(/buscar/i)).toHaveValue("");
  await expect(page.getByLabel(/moneda/i)).toHaveText(/^MXN/);
  await expect(page.getByRole("list", { name: "Listado de vacantes" })).toContainText("Ingeniera Frontend");
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
    await expect(shared.getByLabel(/moneda/i)).toHaveText(/^MXN/);
    await expect
      .poll(async () => (await request.get(`${fixtureUrl}/__requests`)).json())
      .toEqual(["", "", ""]);
    await expect(shared.getByRole("list", { name: "Listado de vacantes" })).toContainText("Ingeniera Frontend");
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
      name: /encuentra tu próximo trabajo/i,
    }),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "Listado de vacantes" })).toContainText("Ingeniera Frontend");
  await expect(page.getByLabel(/buscar/i)).toBeVisible();
  // Labeled scalar filters live in the sidebar form; the hero location
  // input shares the "Ubicación" label, so scope to the form.
  const filtersForm = page.getByRole("form", { name: "Filtros" });
  for (const label of [
    /^Seniority$/,
    /^Modalidad$/,
    /^Jornada$/,
    /^Tipo de contrato$/,
    /^Área profesional$/,
    /^Estado$/,
    /^Municipio$/,
    /^Moneda$/,
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
      name: "Encuentra tu próximo trabajo",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Vacantes disponibles" }),
  ).toBeVisible();

  const header = page.locator("main > header");
  await expect(header.getByText("Vacantes", { exact: true })).toBeVisible();
  await expect(header.getByRole("button", { name: /toggle sidebar/i })).toBeVisible();
  await expect(header.getByRole("button", { name: /cambiar tema/i })).toHaveCount(1);
  await expect(page.locator("[data-pf-public-navbar], [data-pf-nav-floating]")).toHaveCount(0);
  await expect(page.locator("footer")).toHaveCount(0);
  const sidebar = page.locator("[data-slot=sidebar-content]");
  await expect(sidebar.getByRole("link", { name: "Vacantes", exact: true })).toHaveAttribute("href", "/vacantes");
  await expect(sidebar.getByRole("link")).toHaveCount(1);

  // The visible control really flips and persists the document theme: a clean
  // page owns no explicit choice, one click stores the opposite of the resolved
  // system theme, and the pre-paint bootstrap re-applies it after a reload.
  const themeToggle = header.getByRole("button", { name: /cambiar tema/i });
  const html = page.locator("html");
  expect(await page.evaluate(() => localStorage.getItem("pf-theme"))).toBeNull();
  const startedDark = await html.evaluate((el) =>
    el.classList.contains("dark"),
  );
  const flipped = startedDark ? "light" : "dark";
  await themeToggle.click();
  await expect(html).toHaveAttribute("data-theme", flipped);
  expect(await html.evaluate((el) => el.classList.contains("dark"))).toBe(
    flipped === "dark",
  );
  expect(await page.evaluate(() => localStorage.getItem("pf-theme"))).toBe(
    flipped,
  );
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", flipped);
  expect(await page.evaluate(() => localStorage.getItem("pf-theme"))).toBe(
    flipped,
  );
  // Restore the prior preference through the same single key, then confirm the
  // document falls back to system resolution.
  await page.evaluate(() => localStorage.removeItem("pf-theme"));
  await page.reload();
  expect(await page.evaluate(() => localStorage.getItem("pf-theme"))).toBeNull();
  expect(await html.evaluate((el) => el.getAttribute("data-theme"))).toBeNull();

  // Supported quick chips only, with honest pressed state.
  const quickFilters = page.getByRole("group", { name: "Filtros rápidos", exact: true });
  await expect(quickFilters.getByRole("button")).toHaveCount(4);
  const todas = quickFilters.getByRole("button", { name: "Todas", exact: true });
  await expect(todas).toHaveAttribute("aria-pressed", "true");
  for (const label of [
    "Remoto",
    "Híbrido",
    "Tiempo completo",
  ]) {
    await expect(
      quickFilters.getByRole("button", { name: label, exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
  }
  await expect(
    quickFilters.getByRole("button", { name: /prácticas|beca|presencial|medio|senior/i }),
  ).toHaveCount(0);

  // A chip commits through the canonical scalar pipeline and the pressed
  // state follows the resulting canonical URL.
  await quickFilters.getByRole("button", { name: "Remoto", exact: true }).click();
  await expect(page).toHaveURL("/vacantes?work_mode=remote");
  await expect(todas).toHaveAttribute("aria-pressed", "false");
  await expect(
    quickFilters.getByRole("button", { name: "Remoto", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  // Wait for the initiating quick filter's pending state to settle before
  // beginning a second navigation (URL commits before its effect clears).
  await expect(navStatus(page)).not.toContainText(/cargando/i);
  await expect(quickFilters.getByRole("button", { name: "Remoto", exact: true })).toBeEnabled();
  // The reset chip returns to the unfiltered canonical list.
  await todas.click();
  await expect(page).toHaveURL("/vacantes");
  await expect(todas).toHaveAttribute("aria-pressed", "true");

  // Real pointer targets, measured in the browser at the reference widths
  // instead of inferred from classes.
  const measureHeader = async (viewport: { width: number; height: number }) => {
    await page.setViewportSize(viewport);
    await page.goto("/vacantes");
    // The visitor sign-in link exists once the session resolves; md:hidden keeps
    // it out of the desktop header, so assert what the user sees, not DOM count.
    const headerLogin = page.locator('main > header a[href^="/candidato/login"]');
    if (viewport.width < 768) await expect(headerLogin).toBeVisible();
    else await expect(headerLogin).toBeHidden();
    return page.evaluate(() => {
      const header = document.querySelector("main > header")!;
      const linkByName = (name: string) =>
        [...header.querySelectorAll("a")].find(
          (a) => a.textContent?.trim() === name,
        ) ?? null;
      const login = linkByName("Ingresar");
      const rectOf = (element: Element | null) => {
        if (!element) return null;
        const { width, height } = element.getBoundingClientRect();
        return { width: Math.round(width), height: Math.round(height) };
      };
      return {
        sidebarTrigger: rectOf(header.querySelector("[data-slot=sidebar-trigger]")),
        login: rectOf(login),
        themeToggle: rectOf(header.querySelector("[data-pf-theme-toggle]")),
        overflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      };
    });
  };

  const desktop = await measureHeader({ width: 1440, height: 900 });
  test
    .info()
    .annotations.push({ type: "header targets @1440", description: JSON.stringify(desktop) });
  for (const name of ["sidebarTrigger", "themeToggle"] as const) {
    expect(desktop[name], `${name} exists @1440`).not.toBeNull();
    expect(
      desktop[name]!.height,
      `${name} target height @1440`,
    ).toBeGreaterThanOrEqual(40);
  }
  expect(desktop.themeToggle!.width).toBeGreaterThanOrEqual(40);
  expect(desktop.sidebarTrigger!.width).toBeGreaterThanOrEqual(40);
  expect(desktop.overflow).toBeLessThanOrEqual(0);

  const mobile = await measureHeader({ width: 375, height: 812 });
  test
    .info()
    .annotations.push({ type: "header targets @375", description: JSON.stringify(mobile) });
  for (const name of ["sidebarTrigger", "themeToggle", "login"] as const) {
    expect(
      mobile[name]!.height,
      `${name} target height @375`,
    ).toBeGreaterThanOrEqual(40);
  }
  expect(mobile.login!.width).toBeGreaterThanOrEqual(40);
  expect(mobile.sidebarTrigger!.width).toBeGreaterThanOrEqual(40);
  expect(mobile.overflow).toBeLessThanOrEqual(0);
});

test("public vacancies use the app shell, visitor card and mobile login instead of floating chrome", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/vacantes?q=frontend");
  const header = page.locator("main > header");
  await expect(page.locator("[data-slot=sidebar-wrapper]")).toHaveCount(1);
  await expect(page.locator("[data-pf-public-navbar], [data-pf-nav-floating]")).toHaveCount(0);
  await expect(page.locator("footer")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  const nav = page.locator("[data-slot=sidebar-content]");
  await expect(nav.getByRole("link")).toHaveCount(1);
  await expect(nav.locator("a[data-active]")).toHaveText("Vacantes");
  const footer = page.locator("[data-slot=sidebar-footer]");
  await expect(footer).toContainText("Guarda tu búsqueda y sigue tus postulaciones");
  const loginHref = "/candidato/login?next=%2Fvacantes%3Fq%3Dfrontend";
  for (const name of ["Crear cuenta", "Iniciar sesión"]) await expect(footer.getByRole("link", { name, exact: true })).toHaveAttribute("href", loginHref);
  await expect(footer.getByRole("link", { name: "¿Eres empresa? Publica vacantes" })).toHaveAttribute("href", "/empresa/login");

  await header.getByRole("button", { name: /toggle sidebar/i }).click();
  await expect(footer.getByRole("link")).toHaveCount(1);
  const railLogin = footer.getByRole("link", { name: "Iniciar sesión" });
  await expect(railLogin).toHaveAttribute("href", loginHref);
  const railBox = await railLogin.boundingBox();
  expect(railBox!.width).toBe(40); expect(railBox!.height).toBe(40);

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/vacantes?q=frontend");
  await expect(header.getByRole("link", { name: "Ingresar", exact: true })).toHaveAttribute("href", loginHref);
  const trigger = header.getByRole("button", { name: /toggle sidebar/i });
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "Navegación" });
  await expect(drawer.getByRole("link", { name: "Vacantes", exact: true })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Crear cuenta" })).toHaveAttribute("href", loginHref);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(await overflowPx(page)).toBeLessThanOrEqual(0);

  // Theme persistence is not regressed by the reuse.
  const themeToggle = header.getByRole("button", { name: /cambiar tema/i });
  const html = page.locator("html");
  const startedDark = await html.evaluate((el) =>
    el.classList.contains("dark"),
  );
  await themeToggle.click();
  await expect(html).toHaveAttribute("data-theme", startedDark ? "light" : "dark");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", startedDark ? "light" : "dark");
  await page.evaluate(() => localStorage.removeItem("pf-theme"));
  await page.reload();
});

test("uses a 240–280px desktop filter column beside flexible results", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/vacantes");
  const filters = page.getByRole("form", { name: /filtros/i });
  const [filterBox, resultsBox] = await Promise.all([
    filters.boundingBox(),
    page.getByRole("list", { name: "Listado de vacantes" }).boundingBox(),
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
  await expect(page.getByLabel(/moneda/i)).toHaveText(/^MXN/);
  await expect(page.getByRole("list", { name: "Listado de vacantes" })).toContainText("Ingeniera Frontend");
  await expect(emptyHeading).toHaveCount(0);
});

test("renders a retryable Spanish error without vacancy rows", async ({
  page,
}) => {
  await page.goto("/vacantes?q=error");
  await expect(
    page.getByRole("alert").filter({ hasText: /intentar de nuevo/i }),
  ).toContainText(/intentar de nuevo/i);
  await expect(page.getByRole("list", { name: "Listado de vacantes" })).toHaveCount(0);
});

const recoverySearch = "?q=frontend&salary_min=1&salary_currency=MXN&salary_period=monthly&salary_basis=gross";

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
  await expect(page.getByRole("list", { name: "Listado de vacantes" })).toHaveCount(0);

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
  await expect(page.getByLabel("Buscar vacantes")).toHaveValue("frontend");
  await expect(page.getByLabel(/moneda/i)).toHaveText(/MXN/);

  await page.getByRole("button", { name: /intentar de nuevo/i }).click();

  await expect(page).toHaveURL(`/vacantes${recoverySearch}`);
  await expect(page.getByLabel("Buscar vacantes")).toHaveValue("frontend");
  await expect(page.getByLabel(/moneda/i)).toHaveText(/MXN/);
  await expect(alert).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Listado de vacantes" })).toContainText("Ingeniera Frontend");

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
  const status = navStatus(page);
  await expect(status).toHaveAttribute("aria-live", "polite");
  await expect(status).toContainText(/cargando/i);
  await expect(initiating).toBeDisabled();
  await expect(usable).toBeEnabled();
  await expect(
    page.getByRole("link", { name: /ver más vacantes/i }),
  ).not.toHaveAttribute("aria-busy", "true");
}

test("announces pending search navigation without blocking filters", async ({
  page, request,
}) => {
  await page.goto("/vacantes");
  await request.get(`${fixtureUrl}/__delay?ms=1000`);
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
  await expect(navStatus(page)).not.toContainText(/cargando/i);
  await expect(search).toBeEnabled();
});

test("announces pending scalar-filter navigation without blocking search", async ({
  page,
  request,
}) => {
  const usdSearch = "?salary_min=1&salary_currency=USD&salary_period=monthly&salary_basis=gross";
  const results = page.getByRole("list", { name: "Listado de vacantes" });
  await page.goto("/vacantes");
  await page.getByLabel("Salario desde", { exact: true }).fill("1");
  await request.get(`${fixtureUrl}/__delay?ms=500`);
  await page.getByLabel(/moneda/i).click();
  await page.getByRole("option", { name: "USD" }).click();
  const submit = page.getByRole("button", { name: /aplicar filtros/i });
  await submit.click();
  await expectPending(
    page,
    submit,
    page.getByRole("button", { name: /^buscar$/i }),
  );
  await expect(page).toHaveURL(/salary_currency=USD/);
  await expect(navStatus(page)).not.toContainText(/cargando/i);

  // The scalar navigation commits the exact canonical URL, keeps the USD
  // selection in the control, and both the fixture log and the rendered
  // rows prove the exact USD result selection (the fixture evaluates the
  // mixed MXN/USD pool currency-exactly, so the ordinary MXN fallback job
  // can no longer satisfy a currency=USD request).
  await expect(page).toHaveURL(`/vacantes${usdSearch}`);
  await expect
    .poll(async () => (await request.get(`${fixtureUrl}/__requests`)).json())
    .toEqual(["", usdSearch]);
  await expect(page.getByLabel(/moneda/i)).toHaveText(/^USD/);
  await expect(results).toContainText("Ingeniera Currency Proof");
  await expect(results).not.toContainText("Ingeniera Frontend");

  // Refreshing and reopening the captured URL in a second page restore
  // the USD selection with visible results; owned pages are closed
  // before the test ends.
  const usdUrl = page.url();
  await page.reload();
  await expect(page).toHaveURL(`/vacantes${usdSearch}`);
  await expect(page.getByLabel(/moneda/i)).toHaveText(/^USD/);
  await expect(page.getByLabel(/buscar/i)).toHaveValue("");
  await expect(results).toContainText("Ingeniera Currency Proof");
  await expect
    .poll(async () => (await request.get(`${fixtureUrl}/__requests`)).json())
    .toEqual(["", usdSearch, usdSearch]);
  const shared = await page.context().newPage();
  try {
    await shared.goto(usdUrl);
    await expect(shared).toHaveURL(`/vacantes${usdSearch}`);
    await expect(shared.getByLabel(/moneda/i)).toHaveText(/^USD/);
    await expect(shared.getByLabel(/buscar/i)).toHaveValue("");
    await expect
      .poll(async () => (await request.get(`${fixtureUrl}/__requests`)).json())
      .toEqual(["", usdSearch, usdSearch, usdSearch]);
    await expect(shared.getByRole("list", { name: "Listado de vacantes" })).toContainText(
      "Ingeniera Currency Proof",
    );
    await expect(shared.getByRole("list", { name: "Listado de vacantes" })).not.toContainText(
      "Ingeniera Frontend",
    );
  } finally {
    await shared.close();
  }
});

// Task 8.3 / C1 — focused fixture-backed proofs over mixed vacancies:
// exact currency selection and full-AND combined filtering must be
// observable in the rendered result set, not only in the forwarded URL.
test("renders only the actual USD vacancy for a USD salary range over the mixed fixture pool", async ({
  page,
}) => {
  await page.goto("/vacantes?salary_min=1&salary_currency=USD&salary_period=monthly&salary_basis=gross");
  const list = page.getByRole("list", { name: "Listado de vacantes" });
  // The fixture pool spans MXN and USD vacancies: exact USD selection must
  // render the actual USD result and never the ordinary MXN fallback job.
  await expect(list).toContainText("Ingeniera Currency Proof");
  await expect(list).toContainText("$100,000");
  await expect(list).toContainText("USD");
  await expect(list).not.toContainText("Ingeniera Frontend");
  await expect(list).not.toContainText(/MXN/);
});

test("renders only the vacancy matching every predicate of the combined scalar-filter request", async ({
  page,
}) => {
  await page.goto(
    "/vacantes?q=and-proof&work_mode=remote&seniority=senior&work_schedule=full_time&state=19&salary_min=1&salary_currency=MXN&salary_period=monthly&salary_basis=gross",
  );
  const list = page.getByRole("list", { name: "Listado de vacantes" });
  // The fixture and-proof pool holds one exact six-predicate match plus
  // three single-predicate near misses; only the exact AND match may
  // render, so a forwarding-only or partial-OR result set fails here.
  await expect(list).toContainText("Ingeniera And Proof");
  await expect(list).toContainText("Monterrey");
  await expect(list).toContainText(/\$[\d,]+/);
  await expect(list).toContainText("MXN");
  await expect(list.locator(":scope > li")).toHaveCount(1);
  await expect(list).not.toContainText(/And Proof (Híbrida|Junior|Dólares)/);
});

test("announces pending next navigation and preserves its opaque cursor", async ({
  page, request,
}) => {
  // `react` spans two fixture pages, so a real next link exists.
  await page.goto("/vacantes?q=react&salary_min=1&salary_currency=MXN&salary_period=monthly&salary_basis=gross");
  const next = page.getByRole("link", { name: /ver más vacantes/i });
  await expect(next).toHaveAttribute(
    "href",
    /q=react.*salary_currency=MXN.*cursor=opaque\+a%2Bb%2Fc%3D/,
  );
  await request.get(`${fixtureUrl}/__delay?ms=1000`);
  await next.click();
  await expect(navStatus(page)).toHaveAttribute("aria-live", "polite");
  await expect(navStatus(page)).toContainText(/cargando/i);
  await expect(next).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("button", { name: /^buscar$/i })).toBeEnabled();
  await expect(page).toHaveURL(/cursor=opaque\+a%2Bb%2Fc%3D/);
  await expect(navStatus(page)).not.toContainText(/cargando/i);
});

test("forwards all six filters AND-shaped, resets the cursor on filter submission, preserves it on next, and omits pagination on the nonempty final page", async ({
  page,
  request,
}) => {
  const six =
    "q=frontend&state=19&work_mode=remote&seniority=senior&work_schedule=full_time&salary_min=1&salary_currency=MXN&salary_period=monthly&salary_basis=gross";
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
  await expect(page.getByRole("list", { name: "Listado de vacantes" })).toContainText("Ingeniera Frontend");
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
  await expect(navStatus(page)).not.toContainText(/cargando/i);
  await expect(page.getByRole("list", { name: "Listado de vacantes" })).toContainText("Ingeniera Frontend");
  await expectNoPagination();
});

test("opens a titled Base UI mobile filters sheet", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/vacantes");
  const filters = page.getByRole("button", { name: /filtros/i });
  await expect(filters).toBeVisible();
  await filters.click();
  await expect(page.getByRole("dialog")).toHaveAccessibleName("Filtrar vacantes");
  await expect(page.getByRole("dialog").getByLabel(/moneda/i)).toBeVisible();
});

test("omits unavailable optional metadata", async ({ page }) => {
  await page.goto("/vacantes?currency=MXN");
  await expect(page.getByRole("list", { name: "Listado de vacantes" })).not.toContainText(
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
  await page.getByLabel("Salario desde", { exact: true }).fill("1");
  await page.getByLabel(/moneda/i).click();
  await page.getByRole("option", { name: "USD" }).click();
  await page.getByRole("button", { name: /aplicar filtros/i }).click();
  await page.waitForURL(/q=frontend&salary_min=1&salary_currency=USD&salary_period=monthly&salary_basis=gross/);
  await page.goBack();
  await expect(page).toHaveURL(/\/vacantes\?q=frontend$/);
  await expect(page.getByLabel(/moneda/i)).toHaveText(/^MXN/);
  await expect(page.getByLabel("Salario desde", { exact: true })).toHaveValue("");
  await page.goBack();
  await expect(page).toHaveURL(/\/vacantes$/);
  await expect(page.getByLabel("Buscar vacantes")).toHaveValue("");
});

test("clears one scalar through its explicit null option", async ({ page }) => {
  await page.goto("/vacantes?q=frontend&work_schedule=full_time");
  await page.getByLabel("Jornada", { exact: true }).click();
  await page.getByRole("option", { name: "Todas las opciones", exact: true }).click();
  await page.getByRole("button", { name: /aplicar filtros/i }).click();
  await expect(page).toHaveURL(/\/vacantes\?q=frontend$/);
});

test("modified next-link clicks keep native new-tab semantics", async ({
  page,
}) => {
  await page.goto("/vacantes?work_schedule=full_time");
  const next = page.getByRole("link", { name: /ver más vacantes/i });
  const [popup] = await Promise.all([
    page.context().waitForEvent("page"),
    next.click({ modifiers: ["ControlOrMeta"] }),
  ]);
  expect(popup).toBeTruthy();
  await expect(page).toHaveURL("/vacantes?work_schedule=full_time");
  await expect(navStatus(page)).not.toContainText(/cargando/i);
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
  await expect(dialog).toHaveAccessibleName("Filtrar vacantes");
  await expect(
    dialog.getByRole("button", { name: "Cerrar filtros" }),
  ).toBeVisible();
});

test("long vacancy content remains readable", async ({ page, request }) => {
  const longTitleSegment =
    "plataformaoperativadedatosyobservabilidadintegraldistribuida";
  const longCompany =
    "Consultoría Integral de Ingeniería de Software y Datos Confiables";
  const longLocation = "Zona Metropolitana Extendida Noreste";
  // The v2 list projection owns the excerpt budget. Every code point of that
  // authoritative excerpt, plus the explicit truncation mark, reaches the DOM.
  const [longJob] = (await (await request.get(`${fixtureUrl}/v2/jobs?q=long-content`)).json()).items as { excerpt: string; excerpt_truncated: boolean }[];
  expect(longJob.excerpt_truncated).toBe(true);
  const longDescription = `${longJob.excerpt}…`;
  expect(Array.from(longDescription).length).toBeGreaterThan(220);
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
    const list = page.getByRole("list", { name: "Listado de vacantes" });
    const title = page.getByRole("link", { name: /observabilidad/i });
    const company = list.getByText(longCompany);
    const location = list.getByText(longLocation);

    // Every supplied long text renders inside the semantic row.
    await expect(title).toBeVisible();
    await expect(title).toContainText(longTitleSegment);
    await expect(company).toBeVisible();
    await expect(location).toBeVisible();
    await expect(list).toContainText("$1,234,567 – $98,765,432");
    await expect(list).toContainText("MXN");
    await expect(list).toContainText("Mensual · Bruto");

    // The row and the whole document stay inside the viewport.
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

    // The wire-only card keeps its wire facts and its canonical CTA.
    for (const value of ["Híbrido", "Servicios profesionales", "Líder", "Ver vacante", longDescription])
      await expect(list).toContainText(value);

    // Nothing but the excerpt may actually clip. Native Card/Avatar overflow
    // containment and the CTA's nowrap are legitimate only when content fits.
    const row = list.locator(":scope > li");
    const clipping = await row.evaluate((li) => {
      const excerpt = li.querySelector("p.line-clamp-2");
      const excerptStyle = excerpt === null ? null : getComputedStyle(excerpt);
      return {
        text: excerpt?.textContent ?? null,
        textOnly: excerpt !== null && [...excerpt.childNodes].every(node => node.nodeType === Node.TEXT_NODE || node.nodeType === Node.COMMENT_NODE),
        elements: excerpt?.children.length ?? null,
        overflow: excerptStyle?.overflowY ?? null,
        clamp: excerptStyle?.webkitLineClamp ?? null,
        clamped: excerpt !== null && excerpt.scrollHeight > excerpt.clientHeight + 1,
        clipped: [li, ...li.querySelectorAll("h3, div, span, a, p:not(.line-clamp-2)")].filter((el) => {
          const style = getComputedStyle(el);
          return (
            style.textOverflow === "ellipsis" ||
            el.scrollWidth > el.clientWidth + 1 ||
            el.scrollHeight > el.clientHeight + 1
          );
        }).length,
      };
    });
    // React may separate excerpt and ellipsis with a hydration comment; both
    // remain inert text, with zero elements and the exact complete wire excerpt.
    expect([clipping.text, clipping.textOnly, clipping.elements, clipping.overflow, clipping.clamp, clipping.clamped, clipping.clipped]).toEqual([longDescription, true, 0, "hidden", "2", true, 0]);

    // Native Card composition: header, content and footer are stacked,
    // non-overlapping and inside the row at both reference widths (§6).
    const childBoxes = await row.locator('[data-slot="card"]').evaluate((card) => Array.from(card.children).map((child) => {
      const box = child.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
    }));
    expect(childBoxes).toHaveLength(3);
    test.info().annotations.push({ type: `board card regions @${viewport.width}`, description: JSON.stringify(childBoxes) });
    for (let index = 0; index < childBoxes.length; index++) {
      const box = childBoxes[index];
      expect(box.left).toBeGreaterThanOrEqual(listBox!.x);
      expect(box.right).toBeLessThanOrEqual(listBox!.x + listBox!.width);
      if (index > 0) expect(childBoxes[index - 1].bottom).toBeLessThanOrEqual(box.top + 1);
    }

    // Every rendered text range stays horizontally inside the viewport.
    for (const text of [title, company, location]) {
      for (const rect of await rectsOf(text)) {
        expect(rect.left).toBeGreaterThanOrEqual(0);
        expect(rect.right).toBeLessThanOrEqual(viewport.width);
      }
    }

    // The narrow viewport wraps the long title onto multiple rendered lines.
    if (viewport.width === 375) {
      expect((await rectsOf(title)).length).toBeGreaterThanOrEqual(2);
    }
  }
});

// Task 8.4 / C2 — visibility freshness: hiding and re-showing the fixture
// vacancy must flip the rendered list across separate request-time renders
// (fresh document requests), which is only possible with dynamic `no-store`
// reads; no same-document client cache can serve the mutated state.
test("C2: visibility mutations flip the rendered list across separate request-time renders", async ({
  page,
  request,
}) => {
  // Select only the mutable vacancy: the v2 default pool has other jobs.
  // Visible → hidden.
  await page.goto("/vacantes?q=frontend");
  await expect(page.getByRole("list", { name: "Listado de vacantes" })).toContainText("Ingeniera Frontend");
  const hide = await request.get(`${fixtureUrl}/__visibility?hidden=1`);
  expect(hide.status()).toBe(200);
  expect(await hide.json()).toEqual({ ok: true, hidden: true });
  await page.reload();
  await expect(page.getByText(/no hay vacantes/i)).toBeVisible();
  await expect(page.getByRole("main").getByRole("listitem")).toHaveCount(0);

  // Hidden → visible: the next request-time render restores the vacancy.
  const show = await request.get(`${fixtureUrl}/__visibility?hidden=0`);
  expect(show.status()).toBe(200);
  expect(await show.json()).toEqual({ ok: true, hidden: false });
  await page.reload();
  await expect(page.getByRole("list", { name: "Listado de vacantes" })).toContainText("Ingeniera Frontend");
  await expect(page.getByText(/no hay vacantes/i)).toHaveCount(0);
});

// Task 8.4 / C2 — completed-response buffering matrix (list half): each
// navigation arms a deterministic fixture delay, captures the document
// response, waits until that HTTP response completes, and only then asserts
// the final document state (correctness never depends on partial streams).
test("C2: buffered list success renders final rows after the response completes", async ({
  page,
  request,
}) => {
  const armed = await request.get(`${fixtureUrl}/__delay?ms=300`);
  expect(armed.status()).toBe(200);
  expect(await armed.json()).toEqual({ ok: true, ms: 300 });
  const response = await page.goto("/vacantes");
  expect(response?.status()).toBe(200);
  await response!.finished();
  await expect(page.getByRole("list", { name: "Listado de vacantes" })).toContainText("Ingeniera Frontend");
});

test("C2: buffered list empty renders the final empty state after the response completes", async ({
  page,
  request,
}) => {
  const armed = await request.get(`${fixtureUrl}/__delay?ms=300`);
  expect(armed.status()).toBe(200);
  const response = await page.goto("/vacantes?q=empty");
  expect(response?.status()).toBe(200);
  await response!.finished();
  await expect(page.getByText(/no hay vacantes/i)).toBeVisible();
  await expect(page.getByRole("main").getByRole("listitem")).toHaveCount(0);
});

test("C2: buffered list error renders the final retryable state after the response completes", async ({
  page,
  request,
}) => {
  const armed = await request.get(`${fixtureUrl}/__delay?ms=300`);
  expect(armed.status()).toBe(200);
  const response = await page.goto("/vacantes?q=error");
  await response!.finished();
  await expect(
    page.getByRole("alert").filter({ hasText: /intentar de nuevo/i }),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "Listado de vacantes" })).toHaveCount(0);
});

    test("renders only the USD target when every list predicate is active", async ({
      page,
      request,
    }) => {
      // Every supported list predicate is active at once. The URL owns the
      // canonical conjunctive state, and the fixture must answer it with the
      // single vacancy matching all six predicates, never an OR of them.
      const conjunctiveSearch =
        "?q=conjuntiva&state=19&work_mode=remote&seniority=senior&work_schedule=full_time&salary_min=1&salary_currency=USD&salary_period=monthly&salary_basis=gross";
      await page.goto(`/vacantes${conjunctiveSearch}`);
      await expect(page).toHaveURL(`/vacantes${conjunctiveSearch}`);

      // The real list UI reflects the URL-owned active predicates.
      await expect(page.getByLabel("Buscar vacantes")).toHaveValue("conjuntiva");
      await expect(page.getByLabel(/moneda/i)).toHaveText(/^USD/);

      // One exact server request carries all six predicates AND-shaped.
      await expect
        .poll(async () => (await request.get(`${fixtureUrl}/__requests`)).json())
        .toEqual([conjunctiveSearch]);

      // Only the one vacancy matching every active predicate may render.
      const list = page.getByRole("list", { name: "Listado de vacantes" });
      await expect(list.locator(":scope > li")).toHaveCount(1);
      await expect(list).toContainText("Analista Conjuntiva de Datos");
      await expect(list.getByText("$100,000 – $120,000")).toBeVisible();
      await expect(list).toContainText("USD");

      // Each decoy fails exactly one predicate, so an OR evaluation would
      // leak at least one decoy into the rendered list; AND must hide all.
      for (const decoy of [
        "Desarrolladora Senior de Plataformas",
        "Ingeniera Conjuntiva Lead",
        "Diseñadora Conjuntiva Híbrida",
        "Scrum Master Conjuntiva",
        "QA Conjuntiva Guadalajara",
        "DevOps Conjuntiva MXN",
      ])
        await expect(list).not.toContainText(decoy);
    });
test("reflects request-time vacancy visibility across separate renders", async ({
  page,
  request,
}) => {
  // The fixture owns the vacancy's visibility; every `page.goto` is a
  // separate request-time render that must consume the fixture state at
  // that request (`cache: "no-store"`, no ISR, no cross-request cache).
  const setVisibility = (visible: boolean) =>
    request.get(
      `${fixtureUrl}/__visibility?id=${MAIN_VACANCY_ID}&visible=${visible}`,
    );
  const requestHistory = async () =>
    (await (await request.get(`${fixtureUrl}/__requests`)).json()) as string[];
  const expectRequestLog = (renderCount: number) =>
    expect
      .poll(requestHistory)
      .toEqual(Array.from({ length: renderCount }, () => "?q=frontend"));

  // Hidden→visible: restrict the query to the mutable vacancy, so hiding it
  // empties this result set even though the v2 default pool has other jobs.
  await setVisibility(false);
  await page.goto("/vacantes?q=frontend");
  await expect(page.getByRole("main")).not.toContainText(MAIN_VACANCY_TITLE);
  await expect(page.getByText(/no hay vacantes/i)).toBeVisible();
  await expectRequestLog(1);

  // The mutation lands out of band; only a fresh request-time render
  // observes it: the same canonical URL now surfaces the vacancy.
  await setVisibility(true);
  await page.goto("/vacantes?q=frontend");
  await expect(page.getByRole("list", { name: "Listado de vacantes" })).toContainText(MAIN_VACANCY_TITLE);
  await expectRequestLog(2);

  // Visible→hidden: a new render must drop the vacancy again.
  await setVisibility(false);
  await page.goto("/vacantes?q=frontend");
  await expect(page.getByRole("main")).not.toContainText(MAIN_VACANCY_TITLE);
  await expect(page.getByText(/no hay vacantes/i)).toBeVisible();
  await expectRequestLog(3);
});

test("buffers each completed list response with its final state", async ({
  page,
}) => {
  const completedStatuses: number[] = [];
  await bufferMainDocuments(page, "**/vacantes*", completedStatuses);

  const success = await page.goto("/vacantes");
  expect(success?.status()).toBe(200);
  expect(completedStatuses).toEqual([200]);
  await expect(page.getByRole("list", { name: "Listado de vacantes" })).toContainText(MAIN_VACANCY_TITLE);

  const empty = await page.goto("/vacantes?q=empty");
  expect(empty?.status()).toBe(200);
  expect(completedStatuses).toEqual([200, 200]);
  await expect(page.getByText(/no hay vacantes/i)).toBeVisible();
  await expect(page.getByRole("list", { name: "Listado de vacantes" })).toHaveCount(0);

  const failure = await page.goto("/vacantes?q=error");
  expect(failure?.status()).toBe(200);
  expect(completedStatuses).toEqual([200, 200, 200]);
  await expect(
    page.getByRole("alert").filter({ hasText: /intentar de nuevo/i }),
  ).toContainText(/intentar de nuevo/i);
  await expect(page.getByRole("list", { name: "Listado de vacantes" })).toHaveCount(0);
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

test("keeps button-styled board navigation on real links without native-button diagnostics", async ({
  page,
}) => {
  // These five button-styled board actions must render native anchors, with
  // correct link roles and no native-button diagnostics.
  const diagnostics: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && NATIVE_BUTTON_DIAGNOSTIC.test(message.text()))
      diagnostics.push(message.text().split("\n")[0]);
  });
  // The currency Select opens only hydrated, which also flushes diagnostics.
  // Every action remains an anchor, including StateCard's composed Button.
  const expectHydrated = async () => {
    await page.locator("#desktop-salary_currency").click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
  };
  const expectActionLink = async (link: Locator, href: string | RegExp) => {
    await expect(link).toHaveAttribute("href", href);
    const semantics = await link.evaluate(el => ({
      tag: el.tagName, role: el.getAttribute("role"), type: el.getAttribute("type"), slot: el.getAttribute("data-slot"),
    }));
    // StateCard composes the shared Button as an explicit nativeButton=false
    // anchor. Both paths must retain real link semantics, never role=button.
    expect(semantics).toEqual(semantics.slot === "button"
      ? { tag: "A", role: "link", type: null, slot: "button" }
      : { tag: "A", role: null, type: null, slot: null });
    await expect(link).toBeVisible();
  };
  const states = [
    { url: "/vacantes", actions: [[/limpiar filtros/i, "/vacantes"], [/ver más vacantes/i, /^\/vacantes\?cursor=/]] },
    { url: "/vacantes?q=empty", actions: [[/quitar filtros/i, "/vacantes"]] },
    // Retrying is an action (a button that refreshes the server data); the
    // error state's navigation link is the way back to the full list.
    { url: "/vacantes?q=error", actions: [[/ver todas las vacantes/i, "/vacantes"]] },
  ];
  for (const { url, actions } of states) {
    await page.goto(url);
    for (const [name, href] of actions)
      await expectActionLink(page.getByRole("link", { name }), href);
    await expectHydrated();
  }
  // The mobile reset link only mounts with the Sheet, whose open dialog is the
  // fifth site's client proof.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/vacantes");
  await page.getByRole("button", { name: /filtros/i }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toHaveAccessibleName("Filtrar vacantes");
  await expectActionLink(
    sheet.getByRole("link", { name: /limpiar filtros/i }),
    "/vacantes",
  );
  expect(diagnostics).toEqual([]);
});
