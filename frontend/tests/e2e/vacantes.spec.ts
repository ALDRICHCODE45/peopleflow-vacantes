import { createRequire } from "node:module";
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
// The canonical company microsite the known prototype vacancy links to.
const PROTOTYPE_COMPANY_HREF = "/empresas/0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f";
// UISC-03A: no rendered implementation-status vocabulary may survive on the
// public board. Every banned token is prose, never a route, id, or fixture.
const PROHIBITED_DISPLAY_COPY = /demostraci|fictici|\bprototipo\b|no se guarda|no se env[ií]a|no se copi[oó]|no se comparti[oó]/iu;
// Every R2/R3 authorized prototype extra of the enriched fixture vacancy.
const PROTOTYPE_CARD_LABELS = ["Destacada", "Hace 2 h", "24 postulantes", "Ingeniería", "Habilidades", "Beneficios", "SALARIO MENSUAL", "Responde en ~3 días", "Verificada por PeopleFlow"] as const;
// The Base UI development diagnostic that fires whenever a shared `Button`
// renders a root that is not a native <button>.
const NATIVE_BUTTON_DIAGNOSTIC = /nativeButton|expected a native <button>/u;
// Every prototype-only label an unknown wire id must never render.
const PROTOTYPE_ONLY_LABELS = ["Destacada", "postulante", "Responde en", "Verificada por PeopleFlow", "Prototipo", "Habilidades", "Beneficios", "SALARIO MENSUAL"] as const;
// Document horizontal overflow in pixels; anything above zero fails.
const overflowPx = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
// The two direct card regions, in viewport coordinates.
const regionsOf = (card: Locator) => card.evaluate((li) => Array.from(li.children).map((child) => {
  const box = child.getBoundingClientRect();
  return { top: Math.round(box.top), bottom: Math.round(box.bottom), left: Math.round(box.left), right: Math.round(box.right) };
}));
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
const errorHarnessHtml = `<main id="root"></main><script type="module">import { createElement } from "react"; import { createRoot } from "react-dom/client"; import VacantesError from "/src/app/(public)/vacantes/error.tsx"; createRoot(document.getElementById("root")).render(createElement(VacantesError, { error: new Error("fixture failure"), reset() {} }));</script>`;
let errorHarness: HarnessServer | undefined;

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  const viteRequire = createRequire(require.resolve("vitest/package.json"));
  const vite = (await import(
    pathToFileURL(viteRequire.resolve("vite")).href
  )) as {
    createServer(options: Record<string, unknown>): Promise<HarnessServer>;
  };
  errorHarness = await vite.createServer({
    root: process.cwd(),
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

  // Truthful public chrome: the shared floating navbar carries one persisted
  // theme toggle plus real destinations only; no legal or employer copy is
  // fabricated.
  const header = page.locator("header");
  await expect(
    header.getByRole("button", { name: /cambiar tema/i }),
  ).toHaveCount(1);
  for (const [label, href] of [
    ["Vacantes", "/vacantes"],
    ["Empresas", "/empresas/0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f"],
    ["Publicar vacante", "/empresa/vacantes/nueva"],
  ] as const) {
    await expect(
      header.getByRole("link", { name: label, exact: true }),
    ).toHaveAttribute("href", href);
  }
  // The unsupported Recursos placeholder is gone: every public anchor is real.
  await expect(
    header.getByRole("link", { name: "Recursos", exact: true }),
  ).toHaveCount(0);
  // The login entry is one menu trigger now, not a flat candidate-only link.
  await expect(header.getByRole("link", { name: "Ingresar", exact: true })).toHaveCount(0);
  await expect(header.getByRole("button", { name: "Ingresar", exact: true })).toHaveCount(1);

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

  // Real pointer targets, measured in the browser at the reference widths
  // instead of inferred from classes.
  const measureHeader = async (viewport: { width: number; height: number }) => {
    await page.setViewportSize(viewport);
    await page.goto("/vacantes");
    return page.evaluate(() => {
      const header = document.querySelector("header")!;
      const linkByName = (name: string) =>
        [...header.querySelectorAll("a")].find(
          (a) => a.textContent?.trim() === name,
        ) ?? null;
      const menuTrigger = header.querySelector("button[aria-haspopup='menu']");
      const rectOf = (element: Element | null) => {
        if (!element) return null;
        const { width, height } = element.getBoundingClientRect();
        return { width: Math.round(width), height: Math.round(height) };
      };
      return {
        logo: rectOf(header.querySelector("a[aria-label='PeopleFlow']")),
        navVacantes: rectOf(linkByName("Vacantes")),
        navEmpresas: rectOf(linkByName("Empresas")),
        login: rectOf(menuTrigger),
        publish: rectOf(linkByName("Publicar vacante")),
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
  for (const name of [
    "logo",
    "navVacantes",
    "navEmpresas",
    "login",
    "themeToggle",
  ] as const) {
    expect(desktop[name], `${name} exists @1440`).not.toBeNull();
    expect(
      desktop[name]!.height,
      `${name} target height @1440`,
    ).toBeGreaterThanOrEqual(40);
  }
  // The icon-only toggle needs a >=40px square; the publish CTA raises the
  // shared Button `lg` geometry to the same >=40px minimum.
  expect(desktop.themeToggle!.width).toBeGreaterThanOrEqual(40);
  expect(desktop.publish!.height).toBeGreaterThanOrEqual(40);
  expect(desktop.overflow).toBeLessThanOrEqual(0);

  const mobile = await measureHeader({ width: 375, height: 812 });
  test
    .info()
    .annotations.push({ type: "header targets @375", description: JSON.stringify(mobile) });
  // Desktop-only destinations collapse entirely; the retained targets keep
  // their size and the document stays overflow-free.
  for (const name of ["navVacantes", "navEmpresas"] as const) {
    expect(mobile[name]!.width, `${name} width @375`).toBe(0);
    expect(mobile[name]!.height, `${name} height @375`).toBe(0);
  }
  for (const name of ["logo", "themeToggle", "login"] as const) {
    expect(
      mobile[name]!.height,
      `${name} target height @375`,
    ).toBeGreaterThanOrEqual(40);
  }
  expect(mobile.login!.width).toBeGreaterThanOrEqual(40);
  expect(mobile.publish!.height).toBeGreaterThanOrEqual(40);
  expect(mobile.overflow).toBeLessThanOrEqual(0);
});

test("reuses the approved floating navbar on the public vacancy board", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/vacantes");

  // One sticky outer shell owns positioning; the detached capsule is inset.
  const header = page.locator("header[data-pf-public-navbar]");
  await expect(header).toHaveCount(1);
  await expect(header).toHaveCSS("position", "sticky");
  await expect(header).toHaveCSS("top", "0px");
  const capsule = header.locator("[data-pf-nav-floating]");
  await expect(capsule).toHaveCount(1);
  const [headerBox, capsuleBox] = await Promise.all([
    header.boundingBox(),
    capsule.boundingBox(),
  ]);
  test.info().annotations.push({
    type: "public floating navbar @1440",
    description: JSON.stringify({ headerBox, capsuleBox }),
  });
  expect(Math.round(headerBox!.y)).toBe(0);
  expect(capsuleBox!.x).toBeGreaterThan(0);
  expect(Math.round(capsuleBox!.y)).toBeGreaterThan(0);
  // Positive right inset: a real gutter on both sides proves the capsule is
  // inset, which a bare `<= viewport` check would also accept at zero.
  const desktopViewport = await page.evaluate(() => window.innerWidth);
  const desktopRightInset =
    desktopViewport - Math.round(capsuleBox!.x + capsuleBox!.width);
  expect(desktopRightInset, "capsule right inset @1440").toBeGreaterThanOrEqual(1);

  // Exact closed-state inventory: every public anchor and action is enumerated
  // by name and destination, so an unexpected or fake link cannot pass. The
  // two popup login destinations belong to the Ingresar menu and must be absent
  // until that menu opens.
  const closedAnchors = await header.locator("a").evaluateAll((anchors) =>
    anchors
      .map((anchor) => ({ name: anchor.getAttribute("aria-label") ?? anchor.textContent?.trim() ?? "", href: anchor.getAttribute("href") }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  );
  expect(closedAnchors).toEqual([
    { name: "Empresas", href: PROTOTYPE_COMPANY_HREF },
    { name: "PeopleFlow", href: "/" },
    { name: "Publicar vacante", href: "/empresa/vacantes/nueva" },
    { name: "Vacantes", href: "/vacantes" },
  ]);
  const closedActions = await header.locator("button").evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "").sort(),
  );
  expect(closedActions).toEqual(["Cambiar tema", "Ingresar"]);
  for (const destination of ["/candidato/login", "/empresa/login"] as const)
    await expect(header.locator(`a[href="${destination}"]`)).toHaveCount(0);

  // Sticky is proven after scrolling far enough, not merely at page top: the
  // shell stays pinned at its `top: 0` inset while the capsule stays visible.
  const maxScroll = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  expect(maxScroll, "board is scrollable enough to exercise sticky").toBeGreaterThan(0);
  await page.evaluate((top) => window.scrollTo(0, top), maxScroll);
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(maxScroll);
  const pinned = await page.evaluate(() => {
    const shell = document.querySelector("header[data-pf-public-navbar]")!;
    const surfaceRect = shell.querySelector("[data-pf-nav-floating]")!.getBoundingClientRect();
    return {
      innerHeight: window.innerHeight,
      shellTop: Math.round(shell.getBoundingClientRect().top),
      surfaceTop: Math.round(surfaceRect.top),
      surfaceBottom: Math.round(surfaceRect.bottom),
    };
  });
  test.info().annotations.push({
    type: "public floating navbar scrolled @1440",
    description: JSON.stringify(pinned),
  });
  expect(pinned.shellTop).toBe(0);
  expect(pinned.surfaceTop).toBeGreaterThan(0);
  expect(pinned.surfaceBottom).toBeLessThanOrEqual(pinned.innerHeight);

  // 375px: desktop destinations collapse, retained controls stay reachable,
  // the capsule stays inset, and the document never overflows.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/vacantes");
  for (const name of ["Vacantes", "Empresas"] as const) {
    await expect(header.getByRole("link", { name, exact: true })).toBeHidden();
  }
  for (const name of ["Ingresar", "cambiar tema"] as const) {
    await expect(header.getByRole("button", { name })).toBeVisible();
  }
  const publish = header.getByRole("link", {
    name: "Publicar vacante",
    exact: true,
  });
  await expect(publish).toBeVisible();
  await expect(publish).toHaveText("Publicar vacante");
  expect(await overflowPx(page)).toBeLessThanOrEqual(0);
  const mobileCapsule = (await capsule.boundingBox())!;
  test.info().annotations.push({
    type: "public floating navbar @375",
    description: JSON.stringify(mobileCapsule),
  });
  expect(mobileCapsule.x).toBeGreaterThan(0);
  const mobileViewport = await page.evaluate(() => window.innerWidth);
  const mobileRightInset =
    mobileViewport - Math.round(mobileCapsule.x + mobileCapsule.width);
  expect(mobileRightInset, "capsule right inset @375").toBeGreaterThanOrEqual(1);

  // The shared dual-login menu still opens, closes on Escape, and returns focus.
  const trigger = header.getByRole("button", { name: "Ingresar", exact: true });
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveCount(2);
  await expect(
    menu.getByRole("menuitem", { name: "Candidato" }),
  ).toHaveAttribute("href", "/candidato/login");
  await expect(
    menu.getByRole("menuitem", { name: "Empresa" }),
  ).toHaveAttribute("href", "/empresa/login");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();

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

test("widens only the /vacantes island by 7px at desktop and floats the featured status bubble", async ({
  page,
}) => {
  const island = page.locator("[data-jobs-navigation-island]");
  const card = page.getByRole("list").getByRole("listitem").first();
  const featured = card.locator("[data-prototype-featured]");

  // Island outward expansion, resolved margins, and document overflow.
  const measureIsland = () =>
    island.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const parentBox = element.parentElement!.getBoundingClientRect();
      const style = getComputedStyle(element);
      return [
        parentBox.left - box.left,
        box.right - parentBox.right,
        style.marginLeft,
        style.marginRight,
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ] as const;
    });

  // Pill straddle, containment, right inset, and bookmark/salary clearance.
  const measureBubble = (withSalary: boolean) =>
    featured.evaluate((element, salary) => {
      const owner = element.closest("li")!;
      const box = element.getBoundingClientRect();
      const cardBox = owner.getBoundingClientRect();
      const bookmarkBox = owner.querySelector("button")!.getBoundingClientRect();
      const salaryBox = [...owner.querySelectorAll("p")]
        .find((node) => node.textContent?.startsWith("SALARIO"))!
        .getBoundingClientRect();
      const overlaps = (a: DOMRect, b: DOMRect) =>
        a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      return [
        box.top < cardBox.top && box.bottom > cardBox.top,
        box.left >= cardBox.left && box.right <= cardBox.right,
        cardBox.right - box.right > 0,
        overlaps(box, bookmarkBox),
        salary ? overlaps(box, salaryBox) : false,
      ];
    }, withSalary);

  // Desktop 1440 and 1024: 7px outward per side, no document overflow, and one
  // featured pill straddling the top border clear of bookmark and salary rail.
  for (const [width, height] of [[1440, 900], [1024, 768]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("/vacantes?currency=MXN");
    await expect(island).toHaveCount(1);
    const [left, right, marginLeft, marginRight, overflow] = await measureIsland();
    expect([marginLeft, marginRight]).toEqual(["-7px", "-7px"]);
    expect([Math.abs(left - 7) <= 1, Math.abs(right - 7) <= 1, overflow <= 0]).toEqual([true, true, true]);
    await expect(featured).toHaveCount(1);
    await expect(featured).toHaveText("Destacada");
    await expect(featured).toBeVisible();
    await expect(featured.locator("[data-prototype-featured-dot]")).toHaveCount(1);
    expect(await card.evaluate((li) => li.children.length)).toBe(2);
    expect(await measureBubble(true)).toEqual([true, true, true, false, false]);
  }

  // 375px: no added negative margin, flush with the content box, no document
  // overflow, and the pill still straddles the top edge clear of the bookmark.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/vacantes?currency=MXN");
  const [left, right, marginLeft, marginRight, overflow] = await measureIsland();
  expect([marginLeft, marginRight]).toEqual(["0px", "0px"]);
  expect([Math.abs(left) <= 1, Math.abs(right) <= 1, overflow <= 0]).toEqual([true, true, true]);
  expect(await measureBubble(false)).toEqual([true, true, true, false, false]);
});

test("renders the known vacancy as a disclosed prototype card with the reference layout and zero mutations", async ({
  page,
}) => {
  // Any non-GET request is a mutation except Next's dev-only diagnostics.
  const nonGet: string[] = [];
  page.on("request", (entry) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(entry.method()))
      nonGet.push(`${entry.method()} ${entry.url()}`);
  });

  // Desktop: one horizontal row, salary rail right of the content, no overflow.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/vacantes?currency=MXN");
  const list = page.getByRole("list");
  const card = list.getByRole("listitem").first();
  await expect(list.getByRole("listitem")).toHaveCount(1);
  for (const value of ["Ingeniera Frontend", "Remoto", "Tiempo completo", "Senior"])
    await expect(list).toContainText(value);
  await expect(card.getByRole("heading", { level: 3 })).toHaveText(MAIN_VACANCY_TITLE);
  await expect(card.getByRole("heading", { level: 3 }).getByRole("link")).toHaveAttribute("href", `/vacantes/${MAIN_VACANCY_ID}`);
  await expect(card.getByRole("link", { name: "Acme" })).toHaveAttribute("href", PROTOTYPE_COMPANY_HREF);
  expect(await card.evaluate((li) => li.children.length)).toBe(2);
  // The R2/R3 authorized extras are visible without any implementation-status copy.
  for (const label of PROTOTYPE_CARD_LABELS)
    await expect(card).toContainText(label);
  await expect(card.getByRole("note")).toHaveCount(0);
  await expect(list).not.toContainText(PROHIBITED_DISPLAY_COPY);
  const [content, rail] = await regionsOf(card);
  const edges = await card.evaluate((li) => {
    const style = getComputedStyle(li.children[1]);
    return { top: Number.parseFloat(style.borderTopWidth), left: Number.parseFloat(style.borderLeftWidth), divider: style.borderLeftColor, border: getComputedStyle(li).borderTopColor, shadow: getComputedStyle(li).boxShadow };
  });
  test.info().annotations.push({ type: "card regions @1440", description: JSON.stringify({ content, rail, edges }) });
  expect([rail.left >= content.right, Math.abs(rail.top - content.top) <= 1]).toEqual([true, true]);
  expect([edges.top, edges.left > 0, edges.divider === edges.border, edges.shadow]).toEqual([0, true, true, "none"]);
  expect(await overflowPx(page)).toBeLessThanOrEqual(0);

  // Desktop hover polish: a small upward shift, a stronger border, a shadow.
  await card.evaluate((li) => li.scrollIntoView({ block: "center" }));
  const restingY = await card.evaluate((li) => Math.round(li.getBoundingClientRect().top));
  await card.hover();
  await expect.poll(async () => card.evaluate((li) => Math.round(li.getBoundingClientRect().top))).toBeLessThan(restingY);
  const hovered = await card.evaluate((li) => ({ top: Math.round(li.getBoundingClientRect().top), shadow: getComputedStyle(li).boxShadow, border: getComputedStyle(li).borderTopColor, translate: getComputedStyle(li).translate }));
  test.info().annotations.push({ type: "card hover @1440", description: JSON.stringify({ restingY, delta: hovered.top - restingY, hovered }) });
  expect([hovered.top < restingY, hovered.top - restingY >= -4, hovered.shadow !== "none", hovered.border !== edges.border]).toEqual([true, true, true, true]);

  // Canonical CTA >=40px and keyboard-reachable with a ring; the save control
  // is an enabled, intentionally inert placeholder.
  const cta = card.getByRole("link", { name: "Ver vacante" });
  const bookmark = card.getByRole("button");
  const [ctaBox, bookmarkBox] = await Promise.all([cta.boundingBox(), bookmark.boundingBox()]);
  test.info().annotations.push({ type: "card targets @1440", description: JSON.stringify({ ctaBox, bookmarkBox }) });
  expect([Math.round(ctaBox!.height), Math.round(bookmarkBox!.width), Math.round(bookmarkBox!.height)], "card target sizes").toEqual([40, 40, 40]);
  await expect(bookmark).toBeEnabled();
  await expect(bookmark).toHaveAttribute("type", "button");
  await expect(bookmark).toHaveAttribute("aria-label", "Guardar vacante");
  await expect(bookmark).not.toHaveAttribute("aria-pressed");
  await expect(card.getByRole("status")).toHaveCount(0);

  // Keyboard and mouse: activation changes neither the label nor a pressed state.
  await bookmark.focus();
  await page.keyboard.press("Space");
  await expect(bookmark).toHaveAttribute("aria-label", "Guardar vacante");
  await expect(bookmark).not.toHaveAttribute("aria-pressed");
  await bookmark.click();
  await expect(bookmark).toHaveAttribute("aria-label", "Guardar vacante");
  await expect(card.getByRole("status")).toHaveCount(0);

  // The interaction preserves the canonical two-region geometry and card identity.
  expect(await card.evaluate((li) => li.children.length)).toBe(2);
  const [contentAfter, railAfter] = await regionsOf(card);
  expect([railAfter.left >= contentAfter.right, Math.abs(railAfter.top - contentAfter.top) <= 1]).toEqual([true, true]);

  for (let tab = 0; tab < 60; tab++) {
    await page.keyboard.press("Tab");
    if (await cta.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(cta).toBeFocused();
  const focus = await cta.evaluate((el) => ({ visible: el.matches(":focus-visible"), width: Number.parseFloat(getComputedStyle(el).outlineWidth || "0") }));
  expect([focus.visible, focus.width > 0]).toEqual([true, true]);
  // The placeholder control never navigates; the canonical CTA still does.
  await expect(page).toHaveURL("/vacantes?currency=MXN");
  await cta.click();
  await expect(page).toHaveURL(`/vacantes/${MAIN_VACANCY_ID}`);

  // An unknown id stays wire-only: two regions, the canonical CTA, no company
  // link, no prototype label, no note, and no save/bookmark control or status.
  await page.goto("/vacantes?q=long-content");
  const wireOnly = page.getByRole("list").getByRole("listitem").first();
  await expect(wireOnly.getByRole("heading", { level: 3 }).getByRole("link")).toHaveAttribute("href", /\/vacantes\/[0-9a-f-]+$/u);
  expect(await wireOnly.evaluate((li) => li.children.length)).toBe(2);
  for (const absent of PROTOTYPE_ONLY_LABELS) await expect(wireOnly).not.toContainText(absent);
  await expect(wireOnly).not.toContainText(/hace \d+|\d+ postulantes/iu);
  await expect([await wireOnly.getByRole("note").count(), await wireOnly.getByRole("button").count(), await wireOnly.getByRole("status").count()]).toEqual([0, 0, 0]);
  await expect(wireOnly.getByRole("link", { name: "Consultoría Integral de Ingeniería de Software y Datos Confiables" })).toHaveCount(0);

  const diagnostics = nonGet.filter((entry) => entry.includes("__nextjs") || entry.includes("/_next/"));
  test.info().annotations.push({ type: "non-GET requests", description: JSON.stringify({ diagnostics, mutations: nonGet.filter((e) => !diagnostics.includes(e)) }) });
  expect(nonGet.filter((entry) => !diagnostics.includes(entry))).toEqual([]);
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
  await expect(navStatus(page)).not.toContainText(/cargando/i);
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
  await expect(navStatus(page)).not.toContainText(/cargando/i);

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
  await expect(navStatus(page)).not.toContainText(/cargando/i);
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
  await expect(dialog).toHaveAccessibleName(/filtros/i);
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
  // The fixture's authoritative description, normalized exactly as the card
  // normalizes it: every code point must reach the DOM, so any pre-render
  // character budget — the truncation this scenario exists to catch — breaks it.
  const [longJob] = (await (await request.get(`${fixtureUrl}/jobs?q=long-content`)).json()).items as { description: string }[];
  const longDescription = longJob.description.replace(/\s+/gu, " ").trim();
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
    for (const value of ["Híbrido", "Por contrato", "Líder", "SALARIO", "Ver vacante", longDescription])
      await expect(list).toContainText(value);

    // Nothing but the excerpt may clip: no other element in the row hides
    // overflow, shows an ellipsis, or has content wider or taller than its box.
    const row = list.getByRole("listitem");
    const clipping = await row.evaluate((li) => {
      const excerpt = li.querySelector("p.line-clamp-2");
      const excerptStyle = excerpt === null ? null : getComputedStyle(excerpt);
      return {
        text: excerpt?.textContent ?? null,
        nodes: excerpt?.childNodes.length ?? null, elements: excerpt?.children.length ?? null,
        markup: excerpt?.innerHTML ?? null,
        overflow: excerptStyle?.overflowY ?? null,
        clamp: excerptStyle?.webkitLineClamp ?? null,
        clamped: excerpt !== null && excerpt.scrollHeight > excerpt.clientHeight + 1,
        clipped: [li, ...li.querySelectorAll("h3, div, span, a, p:not(.line-clamp-2)")].filter((el) => {
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
      };
    });
    // The excerpt is the one authorized clip: a single text-only node holding
    // the complete normalized wire text, clamped to two lines by CSS.
    expect([clipping.text, clipping.nodes, clipping.elements, clipping.markup?.includes("<") ?? null, clipping.overflow, clipping.clamp, clipping.clamped, clipping.clipped]).toEqual([longDescription, 1, 0, false, "hidden", "2", true, 0]);

    // Regions never overlap: stacked at 375, side by side at desktop width.
    const childBoxes = await row.evaluate((li) => Array.from(li.children).map((child) => {
      const box = child.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
    }));
    expect(childBoxes).toHaveLength(2);
    test.info().annotations.push({ type: `board card regions @${viewport.width}`, description: JSON.stringify(childBoxes) });
    if (viewport.width === 375) {
      expect(childBoxes[0].bottom).toBeLessThanOrEqual(childBoxes[1].top + 1);
    } else {
      expect(childBoxes[0].right).toBeLessThanOrEqual(childBoxes[1].left + 1);
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

    test("renders only the USD target when every list predicate is active", async ({
      page,
      request,
    }) => {
      // Every supported list predicate is active at once. The URL owns the
      // canonical conjunctive state, and the fixture must answer it with the
      // single vacancy matching all six predicates, never an OR of them.
      const conjunctiveSearch =
        "?q=conjuntiva&seniority=senior&work_mode=remote&employment_type=full_time&location=Monterrey&currency=USD";
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
      const list = page.getByRole("list");
      await expect(list.getByRole("listitem")).toHaveCount(1);
      await expect(list).toContainText("Analista Conjuntiva de Datos");
      await expect(list.getByText("USD 100,000 – USD 120,000")).toBeVisible();

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
      .toEqual(Array.from({ length: renderCount }, () => ""));

  // Hidden→visible: this first render starts with the vacancy hidden, so
  // the unfiltered list must not surface it and must show the honest
  // empty state instead.
  await setVisibility(false);
  await page.goto("/vacantes");
  await expect(page.getByRole("main")).not.toContainText(MAIN_VACANCY_TITLE);
  await expect(page.getByText(/no hay vacantes/i)).toBeVisible();
  await expectRequestLog(1);

  // The mutation lands out of band; only a fresh request-time render
  // observes it: the same canonical URL now surfaces the vacancy.
  await setVisibility(true);
  await page.goto("/vacantes");
  await expect(page.getByRole("list")).toContainText(MAIN_VACANCY_TITLE);
  await expectRequestLog(2);

  // Visible→hidden: a new render must drop the vacancy again.
  await setVisibility(false);
  await page.goto("/vacantes");
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
  await expect(page.getByRole("list")).toContainText(MAIN_VACANCY_TITLE);

  const empty = await page.goto("/vacantes?q=empty");
  expect(empty?.status()).toBe(200);
  expect(completedStatuses).toEqual([200, 200]);
  await expect(page.getByText(/no hay vacantes/i)).toBeVisible();
  await expect(page.getByRole("list")).toHaveCount(0);

  const failure = await page.goto("/vacantes?q=error");
  expect(failure?.status()).toBe(200);
  expect(completedStatuses).toEqual([200, 200, 200]);
  await expect(
    page.getByRole("alert").filter({ hasText: /intentar de nuevo/i }),
  ).toContainText(/intentar de nuevo/i);
  await expect(page.getByRole("list")).toHaveCount(0);
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
  // CCP-R7B1: these five button-styled board actions are anchors, never Base UI
  // buttons, so they must keep their link role and log nothing.
  const diagnostics: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && NATIVE_BUTTON_DIAGNOSTIC.test(message.text()))
      diagnostics.push(message.text().split("\n")[0]);
  });
  // The currency Select opens only hydrated, which also flushes the diagnostic
  // effect; every action must be a real anchor with Base UI artifacts absent.
  const expectHydrated = async () => {
    await page.locator("#desktop-currency").click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
  };
  const expectActionLink = async (link: Locator, href: string | RegExp) => {
    await expect(link).toHaveAttribute("href", href);
    await expect(
      link.evaluate((el) =>
        [el.tagName, el.getAttribute("role"), el.getAttribute("type"), el.getAttribute("data-slot")].join("|"),
      ),
    ).resolves.toBe("A|||");
    await expect(link).toBeVisible();
  };
  const states = [
    { url: "/vacantes", actions: [[/limpiar filtros/i, "/vacantes"], [/ver más vacantes/i, /^\/vacantes\?cursor=/]] },
    { url: "/vacantes?q=empty", actions: [[/quitar filtros/i, "/vacantes"]] },
    { url: "/vacantes?q=error", actions: [[/intentar de nuevo/i, "/vacantes?q=error"]] },
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
  await expect(sheet).toHaveAccessibleName(/filtros/i);
  await expectActionLink(
    sheet.getByRole("link", { name: /limpiar filtros/i }),
    "/vacantes",
  );
  expect(diagnostics).toEqual([]);
});

test("keeps the dual-login menu runtime-safe on desktop and mobile", async ({
  page,
}) => {
  // Only the group crash is in scope; CCP-R7B1 owns the nativeButton sites.
  const groupErrors: string[] = [];
  page.on("pageerror", (error) => {
    if (/MenuGroupContext/.test(error.message)) groupErrors.push(error.message);
  });
  const trigger = page.locator("header").getByRole("button", { name: "Ingresar", exact: true });
  for (const [width, height] of [
    [1440, 900],
    [375, 812],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("/vacantes");
    await expect(trigger).toHaveCount(1);
    await expect(trigger).toBeVisible();
    expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(40);
    // One click opens the popup with exactly the two login destinations.
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveCount(2);
    for (const [name, href] of [
      ["Candidato", "/candidato/login"],
      ["Empresa", "/empresa/login"],
    ] as const)
      await expect(
        menu.getByRole("menuitem", { name, exact: true }),
      ).toHaveAttribute("href", href);
    // The open popup adds no overflow and stays inside the viewport.
    const popup = (await menu.boundingBox())!;
    expect([
      (await overflowPx(page)) <= 0,
      popup.x >= 0,
      Math.round(popup.x + popup.width) <= width,
    ]).toEqual([true, true, true]);
    // Escape closes with focus return; the keyboard re-opens without navigating.
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await page.keyboard.press(width === 375 ? "Space" : "Enter");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(page).toHaveURL("/vacantes");
  }
  expect(groupErrors).toEqual([]);
});
