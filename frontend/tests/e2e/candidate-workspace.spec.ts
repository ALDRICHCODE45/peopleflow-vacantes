import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// CDP-10 — candidate workspace browser acceptance for the five real `/candidato/*`
// routes already served by the live preview. Reuses `PLAYWRIGHT_APP_ORIGIN`
// (default 3100) and never touches 3001/4010 or any `/api` path. Requests must be
// read-only (GET/HEAD), and axe measures the whole candidate document instead of
// only the workspace. The storage audit keeps a page-binding write log and also
// snapshots the real localStorage/sessionStorage state after every flow and case.
// Raw samples — captured requests, finite overflow values and executed axe rule
// counts — are asserted per flow and per case so no audit can pass vacuously.

test.describe.configure({ mode: "serial" });

const APP_ORIGIN = (process.env.PLAYWRIGHT_APP_ORIGIN ?? "http://127.0.0.1:3100").replace(/\/$/u, "");
const DESKTOP = { width: 1440, height: 900 } as const;
const MOBILE = { width: 375, height: 812 } as const;
const FORBIDDEN_PORTS = [":3001", ":4010"] as const;
const READ_METHODS = new Set(["GET", "HEAD"]);
const SIDEBAR_LINKS = '[data-slot="sidebar-content"] a';
const ACTIVE_LINK = `${SIDEBAR_LINKS}[data-active]`;

type Captured = { method: string; url: string };
const trackRequests = (page: Page) => {
  const seen: Captured[] = [];
  page.on("request", (entry) => seen.push({ method: entry.method(), url: entry.url() }));
  return seen;
};
// Every request must be a read: no method is exempt, Next internals included.
const offendingMutations = (seen: readonly Captured[]) =>
  seen.filter(({ method }) => !READ_METHODS.has(method)).map(({ method, url }) => `${method} ${url}`);
// Foreign origins, any `/api` read and the two banned ports all fail. data:/blob:/about: stay harmless dev internals.
const offendingTraffic = (seen: readonly Captured[]) =>
  seen.flatMap(({ url }) => {
    if (/^(?:data|blob|about):/u.test(url)) return [];
    const u = new URL(url, APP_ORIGIN);
    if (FORBIDDEN_PORTS.some((port) => url.includes(port))) return [`forbidden-port ${url}`];
    if (u.origin !== APP_ORIGIN) return [`foreign ${u.origin}`];
    if (u.pathname === "/api" || u.pathname.startsWith("/api/")) return [`api ${u.pathname}`];
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
      void sink?.(entry);
    };
    const storageName = (storage: Storage) => (storage === window.sessionStorage ? "session" : "local");
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

// The persisted state read from the document itself: an empty snapshot proves no
// key survived even if a property-style write bypassed the intercepted methods.
const storageSnapshot = (page: Page) =>
  page.evaluate(() => {
    const dump = (storage: Storage): Record<string, string> =>
      Object.fromEntries(
        Array.from({ length: storage.length }, (_, index) => {
          const key = storage.key(index) ?? "";
          return [key, storage.getItem(key) ?? ""] as const;
        }),
      );
    return { local: dump(window.localStorage), session: dump(window.sessionStorage) };
  });

test.beforeEach(async ({ page }) => {
  await installStorageAudit(page);
});

const expectClean = async (page: Page, seen: readonly Captured[]) => {
  // Non-vacuity: every flow must have produced real traffic before judging it.
  expect(seen.length).toBeGreaterThan(0);
  expect(offendingMutations(seen)).toEqual([]);
  expect(offendingTraffic(seen)).toEqual([]);
  expect(await readStorageWrites(page)).toEqual([]);
  expect(await storageSnapshot(page)).toEqual({ local: {}, session: {} });
};

const ROUTES = {
  dashboard: { path: "/candidato/dashboard", h1: "Dashboard", scope: "[data-pf-candidate-overview]" },
  postulaciones: { path: "/candidato/postulaciones", h1: "Postulaciones", scope: "[data-pf-applications-workspace]" },
  perfil: { path: "/candidato/perfil", h1: "Perfil", scope: "[data-pf-profile-workspace]" },
  cvs: { path: "/candidato/cvs", h1: "CVs", scope: "[data-pf-cv-workspace]" },
  cuenta: { path: "/candidato/cuenta", h1: "Cuenta", scope: "[data-pf-account-workspace]" },
} as const;
type Destination = keyof typeof ROUTES;
const ORDER: readonly Destination[] = ["dashboard", "postulaciones", "perfil", "cvs", "cuenta", "dashboard"];
const MATRIX: readonly Destination[] = ["dashboard", "postulaciones", "perfil", "cvs", "cuenta"];
const VIEWPORTS: ReadonlyArray<readonly [string, { width: number; height: number }]> = [
  ["desktop", DESKTOP],
  ["mobile", MOBILE],
];

/** Drives one destination through its real sidebar link over the keyboard and
    proves the URL, exact H1, sole active destination and workspace marker. */
async function sidebarNavigate(page: Page, destination: Destination) {
  const { path, h1, scope } = ROUTES[destination];
  await page.locator(`${SIDEBAR_LINKS}[href="${path}"]`).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`${path}$`, "u"));
  await expect(page.getByRole("heading", { level: 1, name: h1, exact: true })).toBeVisible();
  await expect(page.locator(scope)).toBeVisible();
  const active = page.locator(ACTIVE_LINK);
  await expect(active).toHaveCount(1);
  await expect(active).toHaveText(h1);
}

test("dashboard overview and keyboard sidebar navigation cover all five workspaces at 1440x900", async ({ page }) => {
  const seen = trackRequests(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(ROUTES.dashboard.path);
  await expect(page.locator(ROUTES.dashboard.scope)).toBeVisible();
  // A fresh Playwright context starts with no persisted candidate state.
  expect(await storageSnapshot(page)).toEqual({ local: {}, session: {} });

  // Four derived metrics, three canonical destination links and the snapshot facts.
  const metric = (label: string) => page.locator(`[data-pf-overview-metric="${label}"] p`).nth(1);
  await expect(metric("Postulaciones")).toHaveText("4");
  await expect(metric("En proceso")).toHaveText("2");
  await expect(metric("Perfil completo")).toHaveText("100%");
  await expect(metric("CVs")).toHaveText("2");
  await expect(page.getByRole("link", { name: "Ver todas mis postulaciones", exact: true })).toHaveAttribute("href", ROUTES.postulaciones.path);
  await expect(page.getByRole("link", { name: "Revisar mi perfil", exact: true })).toHaveAttribute("href", ROUTES.perfil.path);
  await expect(page.getByRole("link", { name: "Ver mis CVs", exact: true })).toHaveAttribute("href", ROUTES.cvs.path);
  await expect(page.locator("[data-pf-status-breakdown]")).toContainText("Contratada");
  await expect(page.locator("[data-pf-profile-guidance]")).toContainText("Completaste los 13 campos clave");
  const snapshot = page.locator("[data-pf-cv-snapshot]");
  await expect(snapshot).toContainText("CV principal");
  await expect(snapshot).toContainText("ximena-barrera-cv.pdf");
  await expect(snapshot).toContainText("340 KB");

  for (const destination of ORDER.slice(1)) await sidebarNavigate(page, destination);

  // Mobile drawer: the accessible header trigger opens the one shell drawer and a
  // single keyboard destination resolves the same route before returning. A
  // keypress can land before the client bundle is interactive, so the open is
  // retried with a bounded toggle-safe guard instead of a fixed sleep.
  await page.setViewportSize(MOBILE);
  await page.goto(ROUTES.dashboard.path);
  const mobileTrigger = page.locator('[data-slot="sidebar-trigger"]');
  const drawer = page.getByRole("dialog", { name: "Navegación" });
  await expect(async () => {
    if (!(await drawer.isVisible())) {
      await mobileTrigger.focus();
      await page.keyboard.press("Enter");
    }
    await expect(drawer).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15000 });
  await drawer.locator(`a[href="${ROUTES.perfil.path}"]`).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/candidato\/perfil$/u);
  // The shared shell keeps the mobile Sheet open across client navigation (same as
  // the employer shell) and the modal aria-hides the page behind it, so the drawer
  // must still be visible here; Escape then closes it before the destination is
  // asserted through the role tree.
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Perfil", exact: true })).toBeVisible();
  await expect(page.locator(ROUTES.perfil.scope)).toBeVisible();

  await expectClean(page, seen);
});

test("postulaciones filters by status and diacritics, clears a composed empty state and keeps exactly two canonical links", async ({ page }) => {
  const seen = trackRequests(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(ROUTES.postulaciones.path);
  await expect(page.locator("[data-pf-applications-disclosure]")).toBeVisible();
  await expect(page.locator("[data-pf-application-row]")).toHaveCount(4);

  await page.locator('[data-pf-applications-filter="hired"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-pf-applications-filter="hired"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-pf-applications-count]")).toHaveText("Mostrando 1 postulación");
  await expect(page.locator('[data-pf-application-row="7b1c2d3e-4f50-4a1b-8c2d-3e4f5a6b7c03"]')).toBeVisible();

  // Diacritic-insensitive search finds the accented title from an unaccented query.
  await page.locator('[data-pf-applications-filter="all"]').focus();
  await page.keyboard.press("Enter");
  await page.locator("[data-pf-applications-search]").fill("disenadora");
  await expect(page.locator("[data-pf-application-row]")).toHaveCount(1);

  // Compose with `Enviadas` → zero matches and the truthful recovery state, no fake row.
  await page.locator('[data-pf-applications-filter="submitted"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-pf-applications-empty]")).toContainText("Sin resultados");
  await expect(page.locator("[data-pf-application-row]")).toHaveCount(0);

  await page.locator("[data-pf-applications-clear]").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-pf-application-row]")).toHaveCount(4);
  await expect(page.locator('[data-pf-applications-filter="all"]')).toHaveAttribute("aria-pressed", "true");

  const canonical = page.locator('[data-pf-applications-results] a[href^="/vacantes/"]');
  await expect(canonical).toHaveCount(2);
  expect(await canonical.evaluateAll((links) => links.map((link) => link.getAttribute("href")))).toEqual([
    "/vacantes/0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d92",
    "/vacantes/0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e",
  ]);
  await expect(page.getByText("Vacante histórica sin enlace", { exact: true })).toHaveCount(2);

  await expectClean(page, seen);
});

test("profile edits stay local with one focusable error, an honest no-save note and a keyboard restore", async ({ page }) => {
  const seen = trackRequests(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(ROUTES.perfil.path);
  const city = page.locator('[data-pf-profile-field="city"]');
  const currency = page.locator('[data-pf-profile-field="salaryCurrency"]');

  await city.fill("Guadalajara");
  await currency.fill("");
  await expect(page.locator("[data-pf-profile-dirty]")).toHaveText("Cambios locales sin guardar");

  await page.locator("[data-pf-profile-review]").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[aria-invalid="true"]')).toHaveCount(1);
  await expect(currency).toHaveAttribute("aria-invalid", "true");
  await expect(currency).toBeFocused();
  await expect(page.locator("#profile-salaryCurrency-error")).toHaveText("La moneda del salario es obligatoria.");
  await expect(page.locator("[data-pf-profile-announcement]")).toContainText("encontró 1 error");
  await expect(page.locator("[data-pf-profile-announcement]")).toContainText("no se guardó ni se envió nada");

  await page.locator("[data-pf-profile-reset]").focus();
  await page.keyboard.press("Enter");
  await expect(city).toHaveValue("Ciudad de México");
  await expect(currency).toHaveValue("MXN");
  await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);
  await expect(page.locator("[data-pf-profile-dirty]")).toHaveText("Sin cambios locales");
  await expect(page.locator("[data-pf-profile-announcement]")).toContainText("Restauramos la copia original");

  await expectClean(page, seen);
});

test("CV and account workspaces stay truthful with their full disabled action inventory", async ({ page }) => {
  const seen = trackRequests(page);
  await page.setViewportSize(DESKTOP);

  await page.goto(ROUTES.cvs.path);
  const cv = page.locator(ROUTES.cvs.scope);
  await expect(cv.locator("[data-pf-cv-disclosure]")).toBeVisible();
  await expect(cv.locator("[data-pf-cv-card]")).toHaveCount(2);
  await expect(cv.locator('[data-pf-cv-card="cv-principal"]')).toBeVisible();
  await expect(cv.locator('[data-pf-cv-card="cv-ingles"]')).toBeVisible();
  await expect(cv.locator("[data-pf-cv-summary]")).toContainText("«CV principal» (ximena-barrera-cv.pdf)");
  await expect(cv.locator("[data-pf-cv-actions-note]")).toBeVisible();
  // One upload plus replace/download per card plus the secondary `make primary`: six, all disabled.
  await expect(cv.locator("button:disabled")).toHaveCount(6);
  await expect(cv.locator("[data-pf-cv-upload]")).toBeDisabled();
  await expect(cv.locator('[data-pf-cv-make-primary="cv-ingles"]')).toBeDisabled();
  await expect(cv.locator("a")).toHaveCount(0);
  await expect(cv.locator("form")).toHaveCount(0);

  await page.goto(ROUTES.cuenta.path);
  const account = page.locator(ROUTES.cuenta.scope);
  await expect(account.locator("[data-pf-account-identity]")).toContainText("Ximena Barrera");
  await expect(account.locator("[data-pf-account-email]")).toHaveText("ximena.barrera@correo.mx");
  await expect(account.locator("[data-pf-account-identity]")).toContainText("Candidata");
  await expect(account.locator("[data-pf-account-access]")).toContainText("No disponibles en esta demo");
  await expect(account.locator("[data-pf-account-actions] button:disabled")).toHaveCount(3);
  await expect(account.locator("[data-pf-account-actions-note]")).toBeVisible();
  await expect(account).not.toContainText(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu);
  await expect(account.locator("a")).toHaveCount(0);
  await expect(account.locator("form")).toHaveCount(0);

  await expectClean(page, seen);
});

test("every candidate route stays visible, overflow-clean, axe-clean and mutation-free at both viewports", async ({ page }) => {
  const seen = trackRequests(page);
  const routeFailures: string[] = [];
  const overflowFailures: string[] = [];
  const overflowSamples: number[] = [];
  const axeFailures: string[] = [];
  const axeRuleCounts: number[] = [];
  const axeCoverageFailures: string[] = [];
  const storageFailures: string[] = [];

  for (const destination of MATRIX) {
    for (const [label, viewport] of VIEWPORTS) {
      const route = ROUTES[destination];
      const caseLabel = `${route.path} @ ${label}`;
      try {
        await page.setViewportSize(viewport);
        await page.goto(route.path);
        const headingVisible = await page.getByRole("heading", { level: 1, name: route.h1, exact: true }).isVisible();
        const scopeVisible = await page.locator(route.scope).isVisible();
        if (!headingVisible || !scopeVisible) routeFailures.push(caseLabel);

        const overflow = await overflowPx(page);
        overflowSamples.push(overflow);
        if (!Number.isFinite(overflow) || overflow > 1) overflowFailures.push(`${caseLabel}: ${overflow}px`);

        // The whole candidate document is measured — shell, sidebar, header and
        // workspace — so no shell-level finding can be hidden by a narrow scope.
        const results = await new AxeBuilder({ page })
          .include("body")
          .withTags(["wcag2a", "wcag2aa"])
          .analyze();
        // An analysis that executed no rule proves nothing, so it fails coverage.
        const executedRules = results.passes.length + results.incomplete.length + results.violations.length;
        axeRuleCounts.push(executedRules);
        if (executedRules === 0) axeCoverageFailures.push(caseLabel);
        for (const violation of results.violations) {
          if (violation.impact === "serious" || violation.impact === "critical") {
            axeFailures.push(`${caseLabel}: ${violation.id} -> ${violation.nodes[0]?.target?.join(" ") ?? ""}`);
          }
        }
        const writes = await readStorageWrites(page);
        if (writes.length > 0) storageFailures.push(`${caseLabel}: ${writes.join(", ")}`);
        const snapshot = await storageSnapshot(page);
        const persisted = [...Object.keys(snapshot.local), ...Object.keys(snapshot.session)];
        if (persisted.length > 0) storageFailures.push(`${caseLabel}: persisted ${persisted.join(", ")}`);
      } catch (error) {
        routeFailures.push(`${caseLabel}: ${String(error)}`);
      }
    }
  }

  // Non-vacuity: exactly one finite overflow sample and one executed-rule count per
  // case (5 routes × 2 viewports), and real captured traffic for the whole matrix.
  expect.soft(overflowSamples).toHaveLength(MATRIX.length * VIEWPORTS.length);
  expect.soft(overflowSamples.filter((value) => !Number.isFinite(value))).toEqual([]);
  expect.soft(axeRuleCounts).toHaveLength(MATRIX.length * VIEWPORTS.length);
  expect.soft(axeCoverageFailures).toEqual([]);
  expect.soft(seen.length).toBeGreaterThan(0);
  expect.soft(routeFailures).toEqual([]);
  expect.soft(overflowFailures).toEqual([]);
  expect.soft(axeFailures).toEqual([]);
  expect.soft(storageFailures).toEqual([]);
  expect.soft(offendingMutations(seen)).toEqual([]);
  expect.soft(offendingTraffic(seen)).toEqual([]);
});
