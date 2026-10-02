import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

// CDP-10 — candidate workspace browser acceptance for the six real `/candidato/*`
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
// Raw sub-pixel pointer-target dimension: a sub-threshold target must never
// round up to pass.
const minTargetPx = (locator: Locator) =>
  locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return Math.min(box.width, box.height);
  });

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

// The intentional theme phase owns the only allowed storage writes; clearing the
// accumulated Node-side log afterwards lets a later clean assertion run from the
// verified empty state without weakening the global clean checks.
const resetStorageWrites = (page: Page) => {
  storageWrites.get(page)?.splice(0);
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
  guardadas: { path: "/candidato/guardadas", h1: "Vacantes guardadas", scope: "[data-pf-saved-vacancies-workspace]" },
  perfil: { path: "/candidato/perfil", h1: "Perfil", scope: "[data-pf-profile-workspace]" },
  cvs: { path: "/candidato/cvs", h1: "CVs", scope: "[data-pf-cv-workspace]" },
  configuracion: { path: "/candidato/configuracion", h1: "Configuración", scope: "[data-pf-settings-workspace]" },
} as const;
type Destination = keyof typeof ROUTES;
const ORDER: readonly Destination[] = ["dashboard", "postulaciones", "guardadas", "perfil", "cvs", "configuracion", "dashboard"];
const MATRIX: readonly Destination[] = ["dashboard", "postulaciones", "guardadas", "perfil", "cvs", "configuracion"];
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

test("dashboard overview and keyboard sidebar navigation cover all six workspaces at 1440x900", async ({ page }) => {
  const seen = trackRequests(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(ROUTES.dashboard.path);
  await expect(page.locator(ROUTES.dashboard.scope)).toBeVisible();
  // A fresh Playwright context starts with no persisted candidate state.
  expect(await storageSnapshot(page)).toEqual({ local: {}, session: {} });

  // Four derived metrics, three canonical destination links and the snapshot facts.
  const metric = (label: string) => page.locator(`[data-pf-overview-metric="${label}"] [data-pf-overview-metric-value]`);
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
  await expect(page.locator("[data-pf-application-row]")).toHaveCount(4);

  // Page introduction, one elevated filter surface and a quiet results toolbar.
  await expect(page.locator("[data-pf-applications-intro]")).toContainText("Postulaciones");
  await expect(page.locator("[data-pf-applications-filters]")).toHaveAttribute("data-slot", "card");
  await expect(page.locator("[data-pf-applications-filters] [data-pf-applications-search]")).toBeVisible();
  await expect(page.locator("[data-pf-applications-toolbar] [data-pf-applications-count]")).toBeVisible();

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

/** Median of a non-empty finite sample; compares card against list density. */
const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// One entry per viewport: both viewports always run, so the two medians and the
// stable order are compared afterwards as real cross-viewport evidence.
type ViewSample = { readonly heights: readonly [number, number]; readonly idCount: number; readonly orderStable: boolean };

test("postulaciones switches between rich cards and the compact list over the keyboard, holding density, order, a11y and clean traffic at both viewports", async ({ page }) => {
  const seen = trackRequests(page);
  const samples: ViewSample[] = [];
  const failures: string[] = [];
  const rowIds = () => page.locator("[data-pf-application-row]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-pf-application-row")));
  const heights = (selector: string) => page.locator(selector).evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));

  for (const [label, viewport] of VIEWPORTS) {
    const results = page.locator("[data-pf-applications-results]");
    const cards = page.locator('[data-pf-application-presentation="card"]');
    const items = page.locator('[data-pf-application-presentation="list"]');
    const option = (name: string) => page.getByRole("button", { name, exact: true });
    try {
      await page.setViewportSize(viewport);
      await page.goto(ROUTES.postulaciones.path);
      await expect(page.locator(ROUTES.postulaciones.scope)).toBeVisible();

      // Default presentation: four rich cards, zero list presentations, order kept.
      await expect(results).toHaveAttribute("data-pf-applications-view", "cards");
      await expect(cards).toHaveCount(4);
      await expect(items).toHaveCount(0);
      const cardIds = await rowIds();
      const cardHeights = await heights('[data-pf-application-presentation="card"]');
      // The rich cards resolve to a true two-column desktop grid and one mobile column.
      const cardColumns = await page.locator("[data-pf-applications-cards]").evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").filter(Boolean).length);
      expect(cardColumns).toBe(label === "desktop" ? 2 : 1);

      // Keyboard switch to the list: exclusive pressed state, same order, four real <li>.
      await option("Vista de lista").focus();
      await page.keyboard.press("Enter");
      await expect(results).toHaveAttribute("data-pf-applications-view", "list");
      await expect(cards).toHaveCount(0);
      await expect(items).toHaveCount(4);
      await expect(option("Vista de lista")).toHaveAttribute("aria-pressed", "true");
      await expect(option("Vista de tarjetas")).toHaveAttribute("aria-pressed", "false");
      await expect(page.locator('[data-pf-applications-view-option][aria-pressed="true"]')).toHaveCount(1);
      expect(await items.evaluateAll((nodes) => nodes.every((node) => node.tagName === "LI" && node.parentElement?.tagName === "UL"))).toBe(true);
      const listIds = await rowIds();
      const listHeights = await heights('[data-pf-application-presentation="list"]');

      // Whole-document overflow plus whole-body axe measured over the list view.
      const overflow = await overflowPx(page);
      const axe = await new AxeBuilder({ page }).include("body").withTags(["wcag2a", "wcag2aa"]).analyze();
      const findings = axe.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => violation.id);
      expect(overflow).toBeLessThanOrEqual(1);
      expect(axe.passes.length + axe.incomplete.length + axe.violations.length).toBeGreaterThan(0);
      expect(findings).toEqual([]);

      // Keyboard switch back restores the four cards.
      await option("Vista de tarjetas").focus();
      await page.keyboard.press("Enter");
      await expect(results).toHaveAttribute("data-pf-applications-view", "cards");
      await expect(cards).toHaveCount(4);
      await expect(items).toHaveCount(0);

      expect([cardHeights.length, listHeights.length]).toEqual([4, 4]);
      samples.push({
        heights: [median(cardHeights), median(listHeights)],
        idCount: new Set(cardIds).size,
        orderStable: cardIds.join("|") === listIds.join("|"),
      });
    } catch (error) {
      failures.push(`${label}: ${String(error)}`);
    }
  }

  // Non-vacuity: both viewports sampled, four distinct IDs each, a strictly lower
  // list median and a stable order; overflow and axe were asserted in list view.
  expect.soft(failures).toEqual([]);
  expect.soft(samples).toHaveLength(VIEWPORTS.length);
  expect.soft(samples.map((sample) => sample.idCount)).toEqual(VIEWPORTS.map(() => 4));
  expect.soft(samples.filter((sample) => !sample.orderStable)).toEqual([]);
  expect.soft(samples.flatMap((sample) => sample.heights).filter((value) => !Number.isFinite(value) || value <= 0)).toEqual([]);
  expect.soft(samples.filter((sample) => !(sample.heights[1] < sample.heights[0]))).toEqual([]);
  await expectClean(page, seen);
});

test("postulaciones list rows open a read-only, keyboard-accessible action menu with truthful vacancy items", async ({ page }) => {
  const seen = trackRequests(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(ROUTES.postulaciones.path);
  await page.locator('[data-pf-applications-view-option="list"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-pf-applications-results]")).toHaveAttribute("data-pf-applications-view", "list");

  // Every list row carries exactly one closed 40px ellipsis trigger, and the
  // closed rows stay link-free until a menu opens.
  const rowTriggers = page.locator("[data-pf-applications-list] [aria-haspopup='menu']");
  await expect(rowTriggers).toHaveCount(4);
  await expect(page.locator("[data-pf-applications-list] a")).toHaveCount(0);
  for (const trigger of await rowTriggers.all()) {
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(await minTargetPx(trigger)).toBeGreaterThanOrEqual(40);
  }

  // Live row: keyboard open, one real Next Link with the canonical href, Escape.
  const liveTrigger = page.getByRole("button", { name: "Acciones de la postulación de Desarrolladora Go en Acme", exact: true });
  await expect(liveTrigger).toHaveCount(1);
  expect(await minTargetPx(liveTrigger)).toBeGreaterThanOrEqual(40);
  await liveTrigger.focus();
  await page.keyboard.press("Enter");
  await expect(liveTrigger).toHaveAttribute("aria-expanded", "true");
  const liveMenu = page.getByRole("menu");
  await expect(liveMenu).toBeVisible();
  await expect(liveMenu.getByRole("menuitem")).toHaveCount(1);
  await expect(liveMenu.getByRole("menuitem", { name: "Ver vacante", exact: true })).toHaveAttribute("href", "/vacantes/0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d92");
  await page.keyboard.press("Escape");
  await expect(liveMenu).toHaveCount(0);
  await expect(liveTrigger).toHaveAttribute("aria-expanded", "false");
  await expect(liveTrigger).toBeFocused();

  // Historical row: one honest, disabled item and no anchor at all.
  const historicalTrigger = page.getByRole("button", { name: "Acciones de la postulación de Analista de Datos en Nébula Labs", exact: true });
  await expect(historicalTrigger).toHaveCount(1);
  await historicalTrigger.focus();
  await page.keyboard.press("Enter");
  await expect(historicalTrigger).toHaveAttribute("aria-expanded", "true");
  const historicalMenu = page.getByRole("menu");
  await expect(historicalMenu).toBeVisible();
  await expect(historicalMenu.getByRole("menuitem")).toHaveCount(1);
  await expect(historicalMenu.getByRole("menuitem", { name: "Vacante histórica sin enlace", exact: true })).toHaveAttribute("aria-disabled", "true");
  await expect(historicalMenu.locator("a")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(historicalMenu).toHaveCount(0);
  await expect(historicalTrigger).toBeFocused();

  // The keyboard interaction never navigated and the mount is not persistent.
  await expect(page).toHaveURL(/\/candidato\/postulaciones$/u);
  await expect(page.locator("[data-pf-application-row]")).toHaveCount(4);
  await expectClean(page, seen);
});

test("profile edits stay in the draft with one focusable error and a keyboard restore", async ({ page }) => {
  const seen = trackRequests(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(ROUTES.perfil.path);
  const city = page.locator('[data-pf-profile-field="city"]');
  const currency = page.locator('[data-pf-profile-field="salaryCurrency"]');

  await city.fill("Guadalajara");
  await page.getByRole("tab", { name: "Compensación" }).click();
  await currency.fill("");
  await expect(page.locator("[data-pf-profile-dirty]")).toHaveText("Cambios pendientes");

  await page.locator("[data-pf-profile-review]").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[aria-invalid="true"]')).toHaveCount(1);
  await expect(currency).toHaveAttribute("aria-invalid", "true");
  await expect(currency).toBeFocused();
  await expect(page.locator("#profile-salaryCurrency-error")).toHaveText("La moneda del salario es obligatoria.");
  await expect(page.locator("[data-pf-profile-announcement]")).toContainText("encontró 1 error");
  await expect(page.locator("[data-pf-profile-announcement]")).not.toContainText(/guard|env|persist/iu);

  await page.locator("[data-pf-profile-reset]").focus();
  await page.keyboard.press("Enter");
  await expect(currency).toHaveValue("MXN");
  await page.getByRole("tab", { name: "Personal" }).click();
  await expect(city).toHaveValue("Ciudad de México");
  await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);
  await expect(page.locator("[data-pf-profile-dirty]")).toHaveText("Sin cambios pendientes");
  await expect(page.locator("[data-pf-profile-announcement]")).toContainText("Restauramos la copia original");

  await expectClean(page, seen);
});

test("CV inventory and candidate settings expose enabled inert placeholders with clean menus and inert 2FA/password", async ({ page }) => {
  const seen = trackRequests(page);
  await page.setViewportSize(DESKTOP);

  await page.goto(ROUTES.cvs.path);
  const cv = page.locator(ROUTES.cvs.scope);
  await expect(cv.locator("[data-pf-cv-disclosure]")).toHaveCount(0);
  await expect(cv.locator("[data-pf-cv-actions-note]")).toHaveCount(0);
  await expect(cv.locator("[data-pf-cv-card]")).toHaveCount(2);
  await expect(cv.locator('[data-pf-cv-card="cv-principal"]')).toBeVisible();
  await expect(cv.locator('[data-pf-cv-card="cv-ingles"]')).toBeVisible();
  await expect(cv.locator("[data-pf-cv-summary]")).toContainText("«CV principal» (ximena-barrera-cv.pdf)");

  // Closed state: the one direct upload action stays enabled, both disclosure
  // triggers stay enabled, and no menu surface, footer tray, direct document
  // action, link or form is mounted inside the CV workspace.
  const upload = cv.locator("[data-pf-cv-upload]");
  await expect(upload).toBeEnabled();
  await expect(upload).toHaveText("Subir CV");
  await expect(cv.locator("button:disabled")).toHaveCount(0);
  const triggers = cv.locator("[data-pf-cv-actions-trigger]");
  await expect(triggers).toHaveCount(2);
  expect(await triggers.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-pf-cv-actions-trigger")))).toEqual(["cv-principal", "cv-ingles"]);
  const primaryTrigger = page.getByRole("button", { name: "Acciones de CV principal", exact: true });
  const secondaryTrigger = page.getByRole("button", { name: "Acciones de CV en inglés", exact: true });
  await expect(primaryTrigger).toHaveCount(1);
  await expect(secondaryTrigger).toHaveCount(1);
  for (const trigger of [primaryTrigger, secondaryTrigger]) {
    expect(await trigger.evaluate((node) => [node.tagName, node.getAttribute("type"), (node as HTMLButtonElement).disabled])).toEqual(["BUTTON", "button", false]);
    await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(await minTargetPx(trigger)).toBeGreaterThanOrEqual(40);
  }
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByRole("menuitem")).toHaveCount(0);
  await expect(page.locator("[data-slot='dropdown-menu-content']")).toHaveCount(0);
  await expect(cv.locator("[data-slot='card-footer']")).toHaveCount(0);
  await expect(cv.locator("[data-pf-cv-replace], [data-pf-cv-download], [data-pf-cv-make-primary]")).toHaveCount(0);
  await expect(cv.locator("a")).toHaveCount(0);
  await expect(cv.locator("form")).toHaveCount(0);

  // Upload is enabled but inert: a pointer click and a keyboard activation
  // neither navigate nor emit any success/status claim.
  await upload.click();
  await expect(page).toHaveURL(/\/candidato\/cvs$/u);
  await upload.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/candidato\/cvs$/u);
  await expect(upload).toBeFocused();
  expect(await cv.innerText()).not.toMatch(/demo|local|no disponible|prototip|prueba/iu);

  // Primary menu over Enter: exactly two enabled inert actions with their exact
  // hooks and no make-primary peer. Selecting one closes the primitive-owned menu
  // without navigating. Menu content is portaled, so its locators are page-scoped.
  await primaryTrigger.focus();
  await page.keyboard.press("Enter");
  await expect(primaryTrigger).toHaveAttribute("aria-expanded", "true");
  const primaryMenu = page.getByRole("menu");
  await expect(primaryMenu).toHaveCount(1);
  await expect(primaryMenu).toBeVisible();
  await expect(primaryMenu.getByRole("menuitem")).toHaveCount(2);
  await expect(page.locator("[role='menuitem'][aria-disabled='true']")).toHaveCount(0);
  const replaceItem = page.getByRole("menuitem", { name: "Reemplazar", exact: true });
  const downloadItem = page.getByRole("menuitem", { name: "Descargar", exact: true });
  await expect(replaceItem).toHaveAttribute("data-pf-cv-replace", "cv-principal");
  await expect(downloadItem).toHaveAttribute("data-pf-cv-download", "cv-principal");
  for (const item of [replaceItem, downloadItem]) {
    await expect.poll(() => minTargetPx(item)).toBeGreaterThanOrEqual(40);
  }
  await expect(page.locator("[data-pf-cv-make-primary]")).toHaveCount(0);
  await replaceItem.focus();
  await page.keyboard.press("Enter");
  await expect(primaryMenu).toHaveCount(0);
  await expect(primaryTrigger).toHaveAttribute("aria-expanded", "false");
  await expect(page).toHaveURL(/\/candidato\/cvs$/u);

  // Secondary menu over the other primitive activation key (Space): three enabled
  // inert actions including make-primary, and no direct button/link/form.
  await secondaryTrigger.focus();
  await page.keyboard.press("Space");
  await expect(secondaryTrigger).toHaveAttribute("aria-expanded", "true");
  const secondaryMenu = page.getByRole("menu");
  await expect(secondaryMenu).toHaveCount(1);
  await expect(secondaryMenu).toBeVisible();
  await expect(secondaryMenu.getByRole("menuitem")).toHaveCount(3);
  const secondaryReplace = page.getByRole("menuitem", { name: "Reemplazar", exact: true });
  const secondaryDownload = page.getByRole("menuitem", { name: "Descargar", exact: true });
  const makePrimary = page.getByRole("menuitem", { name: "Usar como principal", exact: true });
  await expect(secondaryReplace).toHaveAttribute("data-pf-cv-replace", "cv-ingles");
  await expect(secondaryDownload).toHaveAttribute("data-pf-cv-download", "cv-ingles");
  await expect(makePrimary).toHaveAttribute("data-pf-cv-make-primary", "cv-ingles");
  for (const item of [secondaryReplace, secondaryDownload, makePrimary]) {
    await expect.poll(() => minTargetPx(item)).toBeGreaterThanOrEqual(40);
  }
  await expect(secondaryMenu.locator("button")).toHaveCount(0);
  await expect(secondaryMenu.locator("a")).toHaveCount(0);
  await expect(secondaryMenu.locator("form")).toHaveCount(0);
  // Pointer selection closes the primitive-owned menu with no product side effect.
  await secondaryDownload.click();
  await expect(secondaryMenu).toHaveCount(0);
  await expect(secondaryTrigger).toHaveAttribute("aria-expanded", "false");

  // The inert actions never navigated and left the card inventory intact: the
  // upload action plus the two disclosure triggers remain the only buttons.
  await expect(page).toHaveURL(/\/candidato\/cvs$/u);
  await expect(cv.locator("[data-pf-cv-card]")).toHaveCount(2);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(cv.locator("button")).toHaveCount(3);

  await page.goto(ROUTES.configuracion.path);
  const settings = page.locator(ROUTES.configuracion.scope);
  await expect(settings).toBeVisible();

  // Exactly five switches: the four memory-only notifications plus the enabled, inert 2FA.
  const notifications = settings.locator("[data-pf-settings-notification]");
  await expect(notifications).toHaveCount(4);
  const notificationSwitches = [
    ["matching_vacancies", "Alertas de vacantes compatibles", "true"],
    ["application_updates", "Cambios en tus postulaciones", "true"],
    ["recruiter_messages", "Mensajes de reclutadores", "true"],
    ["weekly_summary", "Resumen semanal", "false"],
  ] as const;
  for (const [key, label, checked] of notificationSwitches) {
    const control = settings.locator(`[data-pf-settings-notification="${key}"]`);
    await expect(control).toHaveAttribute("aria-checked", checked);
    await expect(settings.getByRole("switch", { name: label, exact: true })).toHaveAttribute("data-pf-settings-notification", key);
    // Every notification switch is a real independent >=40px pointer target.
    expect(await minTargetPx(control)).toBeGreaterThanOrEqual(40);
  }
  await expect(settings.getByRole("switch")).toHaveCount(5);
  const twoFactor = settings.locator("[data-pf-settings-2fa]");
  await expect(twoFactor).toBeEnabled();
  await expect(twoFactor).toHaveAttribute("aria-checked", "false");
  expect(await minTargetPx(twoFactor)).toBeGreaterThanOrEqual(40);
  // Pointer and keyboard activation of 2FA never flips the controlled value.
  await twoFactor.click();
  await expect(twoFactor).toHaveAttribute("aria-checked", "false");
  await twoFactor.focus();
  await page.keyboard.press("Space");
  await expect(twoFactor).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Enter");
  await expect(twoFactor).toHaveAttribute("aria-checked", "false");

  // Click and keyboard both toggle the session-only state.
  const weekly = settings.locator('[data-pf-settings-notification="weekly_summary"]');
  await weekly.click();
  await expect(weekly).toHaveAttribute("aria-checked", "true");
  await weekly.focus();
  await page.keyboard.press("Space");
  await expect(weekly).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Enter");
  await expect(weekly).toHaveAttribute("aria-checked", "true");
  // Toggling notifications never flips the theme, writes storage or emits a claim.
  expect(await page.evaluate(() => document.documentElement.hasAttribute("data-theme"))).toBe(false);

  // Three real in-page section anchors that target the three section H2 headings.
  const nav = settings.locator("[data-pf-settings-nav]");
  await expect(nav.getByRole("link")).toHaveCount(3);
  expect(await nav.getByRole("link").evaluateAll((links) => links.map((link) => link.getAttribute("href")))).toEqual(["#notificaciones", "#apariencia", "#seguridad"]);
  for (const [id, heading] of [["notificaciones", "Notificaciones"], ["apariencia", "Apariencia"], ["seguridad", "Seguridad"]] as const) {
    await expect(page.locator(`#${id}-heading`)).toHaveText(heading);
    await expect(page.getByRole("heading", { level: 2, name: heading, exact: true })).toBeVisible();
  }

  // The password action stays enabled and inert: click and keyboard change nothing.
  const password = settings.locator("[data-pf-settings-password]");
  await expect(password).toBeEnabled();
  await expect(password).toHaveText("Cambiar contraseña");
  expect(await minTargetPx(password)).toBeGreaterThanOrEqual(40);
  await password.click();
  await expect(page).toHaveURL(/\/candidato\/configuracion$/u);
  await password.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/candidato\/configuracion$/u);

  // No profile identity, UUID, disclaimer or save-success claim appears in Settings.
  const settingsText = await settings.innerText();
  expect(settingsText).not.toContain("Ximena");
  expect(settingsText).not.toContain("ximena.barrera@correo.mx");
  expect(settingsText).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu);
  expect(settingsText).not.toMatch(/demo|mock|prototip|prueba|disclaimer|local/iu);
  expect(settingsText).not.toMatch(/guardad|guardar|éxito|exitos|correctamente|enviad|suscrit|sesión iniciada/iu);

  // Reload resets every notification: settings state is memory-only, never persisted.
  await page.reload();
  await expect(settings.locator('[data-pf-settings-notification="weekly_summary"]')).toHaveAttribute("aria-checked", "false");
  await expect(settings.locator('[data-pf-settings-notification="matching_vacancies"]')).toHaveAttribute("aria-checked", "true");
  await expect(settings.locator("[data-pf-settings-2fa]")).toHaveAttribute("aria-checked", "false");

  await expectClean(page, seen);
});

test("settings theme select follows the installed Base UI popup and persists only pf-theme", async ({ page }) => {
  const seen = trackRequests(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(ROUTES.configuracion.path);
  const settings = page.locator(ROUTES.configuracion.scope);
  const trigger = settings.locator("[data-pf-settings-theme]");
  await expect(trigger).toBeVisible();
  await expect(trigger).toContainText("Sistema");

  const choose = async (name: string) => {
    await trigger.click();
    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible();
    await page.getByRole("option", { name, exact: true }).click();
    await expect(listbox).toHaveCount(0);
  };

  // Claro pins light even against the OS preference.
  await choose("Claro");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/u);
  await expect(trigger).toContainText("Claro");

  // Oscuro pins dark and adds the Tailwind dark class.
  await choose("Oscuro");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveClass(/\bdark\b/u);
  await expect(trigger).toContainText("Oscuro");

  // Sistema drops the explicit choice and follows the real OS preference.
  await choose("Sistema");
  const osDark = await page.evaluate(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  await expect(page.locator("html")).toHaveAttribute("data-theme", osDark ? "dark" : "light");
  expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(osDark);
  await expect(trigger).toContainText("Sistema");

  // Exact persistence: only the existing pf-theme key, only set/set/remove.
  expect(await readStorageWrites(page)).toEqual(["local|set|pf-theme|light", "local|set|pf-theme|dark", "local|remove|pf-theme"]);
  expect(await storageSnapshot(page)).toEqual({ local: {}, session: {} });

  // The intentional theme writes are verified above, so the audit is cleared
  // before proving the default clean boundary again on a fresh load.
  resetStorageWrites(page);
  await page.reload();
  await expect(page.locator(ROUTES.configuracion.scope)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.hasAttribute("data-theme"))).toBe(false);
  await expectClean(page, seen);
});

test("the removed candidate account route returns a real 404 and no sidebar destination", async ({ page }) => {
  const seen = trackRequests(page);
  await page.setViewportSize(DESKTOP);

  const response = await page.goto("/candidato/cuenta");
  expect(response?.status()).toBe(404);
  // A redirect chain would hide the missing route, so the navigation itself must be direct.
  expect(response?.request().redirectedFrom()).toBeNull();

  // The live shell keeps exactly six destinations and never links the old route.
  await page.goto(ROUTES.configuracion.path);
  await expect(page.locator(SIDEBAR_LINKS)).toHaveCount(6);
  await expect(page.locator(`${SIDEBAR_LINKS}[href="/candidato/cuenta"]`)).toHaveCount(0);
  const settingsLink = page.locator(`${SIDEBAR_LINKS}[href="${ROUTES.configuracion.path}"]`);
  await expect(settingsLink).toHaveCount(1);
  await expect(settingsLink).toHaveText("Configuración");

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
  // case (6 routes × 2 viewports), and real captured traffic for the whole matrix.
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
