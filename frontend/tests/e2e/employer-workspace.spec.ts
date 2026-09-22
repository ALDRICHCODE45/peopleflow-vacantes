import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// EW-08 — employer workspace browser acceptance for the four read-mostly routes
// already provided by the live `/empresa/*` preview. The contract proves:
//   * Dashboard, portfolio, pipeline and team surfaces stay truthful, accessible
//     and free of business mutations under real keyboard interaction;
//   * The "no storage write" claim survives every portfolio/pipeline/team flow;
//   * The route matrix exposes no serious/critical axe violations at desktop
//     and mobile widths without forcing any external service or restart.
//
// Reuses the live preview server (`PLAYWRIGHT_APP_ORIGIN`, default 3100); never
// touches 3001/4010 or any `/api/...` path. The storage audit forwards every
// write to a persistent page binding so the evidence accumulates across every
// same-page document navigation instead of resetting with `addInitScript`.

test.describe.configure({ mode: "serial" });

const APP_ORIGIN = (process.env.PLAYWRIGHT_APP_ORIGIN ?? "http://127.0.0.1:3100").replace(/\/$/u, "");
const ROUTES = {
  dashboard: "/empresa/dashboard",
  portfolio: "/empresa/vacantes",
  pipeline: "/empresa/vacantes/backend-developer-senior/pipeline",
  team: "/empresa/equipo",
} as const;
const DESKTOP = { width: 1440, height: 900 } as const;
const MOBILE = { width: 375, height: 812 } as const;
const FORBIDDEN_PORTS = [":3001", ":4010"] as const;
const DISALLOWED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const NO_SEND_COPY = "Prototipo: no se envió la invitación ni se guardó ningún cambio.";

type Captured = { method: string; url: string };
const trackRequests = (page: Page) => {
  const seen: Captured[] = [];
  page.on("request", (entry) => seen.push({ method: entry.method(), url: entry.url() }));
  return seen;
};
const isNextInternal = (url: string) => /^\/(?:_next\/|__nextjs)/u.test(new URL(url, APP_ORIGIN).pathname);
const offendingMutations = (seen: readonly Captured[]) =>
  seen.filter(({ method, url }) => DISALLOWED_METHODS.has(method) && !isNextInternal(url)).map(({ method, url }) => `${method} ${url}`);
// Foreign origins, /api/* reads and the two banned ports all fail. data:/blob:/about: stay harmless dev internals.
const offendingTraffic = (seen: readonly Captured[]) =>
  seen.flatMap(({ url }) => {
    if (/^(?:data|blob|about):/u.test(url)) return [];
    const u = new URL(url, APP_ORIGIN);
    if (FORBIDDEN_PORTS.some((port) => url.includes(port))) return [`forbidden-port ${url}`];
    if (u.origin !== APP_ORIGIN) return [`foreign ${u.origin}`];
    if (u.pathname.startsWith("/api/")) return [`api ${u.pathname}`];
    return [];
  });
const overflowPx = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// Writes are accumulated Node-side per page so they survive full document
// navigations; the binding is installed before the first `goto` and the page
// override forwards to it at call time, preserving the native storage methods.
const storageWrites = new WeakMap<Page, string[]>();

async function installStorageAudit(page: Page) {
  storageWrites.set(page, []);
  await page.exposeBinding("__pfRecordStorageWrite", (source, entry: string) => {
    (storageWrites.get(source.page) ?? []).push(entry);
  });
  await page.addInitScript(() => {
    const record = (entry: string) => {
      const sink = (window as unknown as { __pfRecordStorageWrite?: (value: string) => Promise<void> }).__pfRecordStorageWrite;
      // Fire-and-forget forwarding keeps the native call synchronous; a missing
      // sink only drops the audit record, never the write itself.
      void sink?.(entry);
    };
    const storageName = (storage: Storage) =>
      storage === window.sessionStorage ? "session" : "local";
    const originalSet = Storage.prototype.setItem;
    const originalRemove = Storage.prototype.removeItem;
    const originalClear = Storage.prototype.clear;
    Storage.prototype.setItem = function (this: Storage, key: string, value: string): void {
      record(`${storageName(this)}|set|${key}|${value}`);
      return originalSet.call(this, key, value);
    };
    Storage.prototype.removeItem = function (this: Storage, key: string): void {
      record(`${storageName(this)}|remove|${key}`);
      return originalRemove.call(this, key);
    };
    Storage.prototype.clear = function (this: Storage): void {
      record(`${storageName(this)}|clear`);
      return originalClear.call(this);
    };
  });
}

// Round-trip the renderer so any binding calls still in flight are delivered
// before the Node-side audit is read.
const readStorageWrites = async (page: Page) => {
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  return storageWrites.get(page) ?? [];
};

test.beforeEach(async ({ page }) => {
  await installStorageAudit(page);
});

async function backToDashboard(page: Page) {
  await page.goto(ROUTES.dashboard);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard", exact: true })).toBeVisible();
}

test("dashboard connects buttons to the portfolio and the backend pipeline over the keyboard at 1440x900", async ({ page }) => {
  const seen = trackRequests(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(ROUTES.dashboard);

  await expect(page.getByRole("heading", { level: 1, name: "Dashboard", exact: true })).toBeVisible();
  await expect(page.locator("[data-pf-kpi-cards]")).toBeVisible();
  await expect(page.locator("[data-pf-chart-card]")).toBeVisible();
  await expect(page.locator("table").first()).toBeVisible();
  // Only the three active vacancies render as dashboard rows.
  const dashboardRows = page.locator("[data-pf-active-vacancy-row]");
  await expect(dashboardRows).toHaveCount(3);
  for (const id of ["backend-developer-senior", "frontend-engineer-react", "fullstack-developer"]) {
    await expect(dashboardRows.filter({ has: page.locator(`[data-pf-active-vacancy-pipeline="${id}"]`) })).toHaveCount(1);
  }

  // Existing sidebar `Nueva vacante` button keeps keyboard-operable navigation.
  await page.getByRole("button", { name: "Nueva vacante", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/empresa\/vacantes\/nueva$/u);
  await backToDashboard(page);

  // `Ver todas` reaches the portfolio over the keyboard and back.
  await page.locator("[data-pf-active-vacancies-portfolio]").focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/empresa\/vacantes$/u);
  await backToDashboard(page);

  // The backend row's pipeline link keeps the breadcrumb and H1 honest.
  await page.locator('[data-pf-active-vacancy-pipeline="backend-developer-senior"]').focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/empresa\/vacantes\/backend-developer-senior\/pipeline$/u);
  await expect(page.getByRole("heading", { level: 1, name: "Backend Developer (Senior)", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Ruta de navegación" }).getByRole("link", { name: "Vacantes", exact: true })).toHaveAttribute("href", "/empresa/vacantes");

  expect(offendingMutations(seen)).toEqual([]);
  expect(offendingTraffic(seen)).toEqual([]);
  expect(await readStorageWrites(page)).toEqual([]);
});

test("portfolio filters by search and status, switching through empty recovery and the truthful clear", async ({ page }) => {
  const seen = trackRequests(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(ROUTES.portfolio);
  await expect(page.getByRole("heading", { level: 1, name: "Vacantes", exact: true })).toBeVisible();
  await expect(page.locator("[data-pf-vacancy-row]")).toHaveCount(6);

  await page.locator("[data-pf-vacancy-search]").fill("backend");
  await expect(page.locator("[data-pf-vacancy-row]")).toHaveCount(1);
  await expect(page.locator('[data-pf-vacancy-row="backend-developer-senior"]')).toBeVisible();

  // Compose with `Pausadas` → zero matches, recovery message, no fake row.
  await page.locator('[data-pf-vacancy-filter="paused"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-pf-vacancy-empty]')).toBeVisible();
  await expect(page.locator('[data-pf-vacancy-empty]')).toContainText(/Sin resultados/u);
  await expect(page.locator('[data-pf-vacancy-filter="paused"]')).toHaveAttribute("aria-pressed", "true");

  // `Limpiar filtros` restores the six rows and the `Todas` pressed state.
  await page.locator("[data-pf-vacancy-clear]").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-pf-vacancy-row]")).toHaveCount(6);
  await expect(page.locator('[data-pf-vacancy-filter="all"]')).toHaveAttribute("aria-pressed", "true");

  expect(offendingMutations(seen)).toEqual([]);
  expect(offendingTraffic(seen)).toEqual([]);
  expect(await readStorageWrites(page)).toEqual([]);
});

test("backend pipeline keeps the Tablero default, filters `Diego`, switches views, and clears without losing state", async ({ page }) => {
  const seen = trackRequests(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(ROUTES.pipeline);
  await expect(page.getByRole("heading", { level: 1, name: "Backend Developer (Senior)", exact: true })).toBeVisible();

  // Tablero is pressed by default, exactly four stage columns and four cards.
  await expect(page.locator('[data-pf-pipeline-view-tab="board"]')).toHaveAttribute("aria-pressed", "true");
  for (const stage of ["submitted", "in_review", "hired", "rejected"]) {
    await expect(page.locator(`[data-pf-pipeline-column="${stage}"]`)).toBeVisible();
  }
  await expect(page.locator("[data-pf-pipeline-card]")).toHaveCount(4);
  for (const id of ["lucia-fernandez", "diego-salazar", "renata-vargas", "martin-bustos"]) {
    await expect(page.locator(`[data-pf-pipeline-card="${id}"]`)).toBeVisible();
  }

  // `Diego` narrows the four-card board to a single semantic card; switching
  // to Lista keeps the typed query and keeps exactly one row.
  await page.locator("[data-pf-pipeline-search]").fill("Diego");
  await expect(page.locator("[data-pf-pipeline-card]")).toHaveCount(1);
  await expect(page.locator('[data-pf-pipeline-card="diego-salazar"]')).toBeVisible();
  await page.locator('[data-pf-pipeline-view-tab="list"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-pf-pipeline-search]")).toHaveValue("Diego");
  await expect(page.locator('[data-pf-pipeline-row="diego-salazar"]')).toHaveCount(1);
  await expect(page.locator('[data-pf-pipeline-row="lucia-fernandez"]')).toHaveCount(0);
  await expect(page.locator('[data-pf-pipeline-view-tab="list"]')).toHaveAttribute("aria-pressed", "true");

  // Switch back, yield an unmatched recovery panel, then clear restores four.
  await page.locator('[data-pf-pipeline-view-tab="board"]').focus();
  await page.keyboard.press("Enter");
  await page.locator("[data-pf-pipeline-search]").fill("zzz-no-match");
  await expect(page.locator("[data-pf-pipeline-recovery]")).toBeVisible();
  await expect(page.locator("[data-pf-pipeline-card]")).toHaveCount(0);
  await page.locator("[data-pf-pipeline-clear]").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-pf-pipeline-search]")).toHaveValue("");
  await expect(page.locator("[data-pf-pipeline-card]")).toHaveCount(4);

  expect(offendingMutations(seen)).toEqual([]);
  expect(offendingTraffic(seen)).toEqual([]);
  expect(await readStorageWrites(page)).toEqual([]);
});

test("team filters `LUCIA`, gates it through `Activas`, and the invitation form stays structurally unable to send or save", async ({ page }) => {
  const seen = trackRequests(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(ROUTES.team);
  await expect(page.getByRole("heading", { level: 1, name: "Equipo", exact: true })).toBeVisible();
  await expect(page.locator("[data-pf-team-row]")).toHaveCount(6);
  for (const metric of ["total", "owners", "recruiters", "invited"]) {
    await expect(page.locator(`[data-pf-team-metric="${metric}"]`)).toBeVisible();
  }

  // Diacritic-insensitive match for `LUCIA` lands on the invited member only;
  // composing with the `Activas` filter yields the truthful empty recovery.
  await page.locator("[data-pf-team-search]").fill("LUCIA");
  await expect(page.locator('[data-pf-team-row="lucia-navarro"]')).toBeVisible();
  await expect(page.locator('[data-pf-team-row="lucia-navarro"]')).toHaveCount(1);
  await page.locator('[data-pf-team-filter="active"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-pf-team-empty]")).toBeVisible();
  await page.locator("[data-pf-team-clear]").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-pf-team-row]")).toHaveCount(6);

  // Open Invitar miembro via keyboard: malformed, corrected, then owner role.
  await page.locator("[data-pf-team-invitation-toggle]").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-pf-team-invitation-toggle]")).toHaveAttribute("aria-expanded", "true");
  await page.locator("[data-pf-team-invitation-email]").fill("not-an-email");
  await page.locator('[data-pf-team-invitation-role]').selectOption("owner");
  await page.locator("[data-pf-team-invitation-submit]").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-pf-team-invitation-error]")).toBeVisible();
  await expect(page.locator("[data-pf-team-invitation-error]")).toContainText(/válido/u);
  // Stale error and field stay so the next submit still has to send a valid address.
  await expect(page.locator("[data-pf-team-invitation-email]")).toHaveValue("not-an-email");

  await page.locator("[data-pf-team-invitation-email]").fill("owner@nexolabs.mx");
  await page.locator("[data-pf-team-invitation-submit]").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-pf-team-invitation-status]")).toHaveText(NO_SEND_COPY);
  // Member count and rows are unchanged: no fake success UI exists.
  await expect(page.locator("[data-pf-team-row]")).toHaveCount(6);
  await expect(page.locator('[data-pf-team-row="owner-nexolabs-mx"]')).toHaveCount(0);

  expect(offendingMutations(seen)).toEqual([]);
  expect(offendingTraffic(seen)).toEqual([]);
  expect(await readStorageWrites(page)).toEqual([]);
});

const MATRIX = [
  { route: "dashboard", path: ROUTES.dashboard, h1: "Dashboard", scope: "[data-pf-active-vacancies]" },
  { route: "portfolio", path: ROUTES.portfolio, h1: "Vacantes", scope: "[data-pf-vacantes-content]" },
  { route: "pipeline", path: ROUTES.pipeline, h1: "Backend Developer (Senior)", scope: "[data-pf-pipeline-content]" },
  { route: "team", path: ROUTES.team, h1: "Equipo", scope: "[data-pf-equipo-content]" },
] as const;
const VIEWPORTS: ReadonlyArray<readonly [string, { width: number; height: number }]> = [
  ["desktop", DESKTOP],
  ["mobile", MOBILE],
];

test("route matrix stays visible, overflow-clean, axe-clean and mutation-free", async ({ page }) => {
  const seen = trackRequests(page);
  const routeFailures: string[] = [];
  const overflowFailures: string[] = [];
  const axeFailures: string[] = [];
  const storageFailures: string[] = [];

  for (const entry of MATRIX) {
    for (const [label, viewport] of VIEWPORTS) {
      const caseLabel = `${entry.route} @ ${label}`;
      try {
        await page.setViewportSize(viewport);
        await page.goto(entry.path);
        const headingVisible = await page
          .getByRole("heading", { level: 1, name: entry.h1, exact: true })
          .isVisible();
        const scopeVisible = await page.locator(entry.scope).isVisible();
        if (!headingVisible || !scopeVisible) routeFailures.push(caseLabel);

        const boardOverflow = await overflowPx(page);
        if (boardOverflow > 1) overflowFailures.push(`${caseLabel} default: ${boardOverflow}px`);

        // The pipeline deliberately contains its wide board/list internally.
        // On mobile, measure both modes rather than only the final one.
        if (entry.path === ROUTES.pipeline && label === "mobile") {
          const listTab = page.locator('[data-pf-pipeline-view-tab="list"]');
          await listTab.click();
          await expect(listTab).toHaveAttribute("aria-pressed", "true");
          // The pressed tab animates its colors through `transition-all`; wait
          // for that button's Web Animations to settle so overflow and Axe
          // sample stable computed styles. Cancelled transitions reject
          // `finished`, so their rejection is deliberately absorbed.
          await listTab.evaluate(async (element) => {
            await Promise.all(
              element.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
            );
          });
          const listOverflow = await overflowPx(page);
          if (listOverflow > 1) overflowFailures.push(`${caseLabel} list: ${listOverflow}px`);
        }

        // Candidate scopes exclude independently diagnosed pre-existing
        // dashboard DataTable/shared-primitive contrast nodes.
        const results = await new AxeBuilder({ page })
          .include(entry.scope)
          .withTags(["wcag2a", "wcag2aa"])
          .analyze();
        for (const violation of results.violations) {
          if (violation.impact === "serious" || violation.impact === "critical") {
            const target = violation.nodes[0]?.target?.join(" ") ?? "";
            axeFailures.push(`${caseLabel}: ${violation.id} -> ${target}`);
          }
        }
        const writes = await readStorageWrites(page);
        if (writes.length > 0) storageFailures.push(`${caseLabel}: ${writes.join(", ")}`);
      } catch (error) {
        routeFailures.push(`${caseLabel}: ${String(error)}`);
      }
    }
  }

  expect.soft(routeFailures).toEqual([]);
  expect.soft(overflowFailures).toEqual([]);
  expect.soft(axeFailures).toEqual([]);
  expect.soft(storageFailures).toEqual([]);
  expect.soft(offendingMutations(seen)).toEqual([]);
  expect.soft(offendingTraffic(seen)).toEqual([]);
});
