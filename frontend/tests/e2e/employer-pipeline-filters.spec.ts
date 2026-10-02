import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// EPF — employer vacancy pipeline width + filter browser acceptance for
// `/empresa/vacantes/backend-developer-senior/pipeline`. The contract proves:
//   * the route's single `screen-2xl` measure owns the whole body in BOTH the
//     Tablero and the Lista views, without reintroducing a narrower inner
//     wrapper (the shell stays untouched);
//   * the toolbar exposes a Filtros trigger with a live count and one removable
//     button chip per active value or bound;
//   * the floating filter Sheet carries the three searchable multi-select
//     facets (Etapa, Origen, Habilidades), the experience buckets and the
//     received-date range through the installed DatePickerField with past days
//     allowed;
//   * values OR inside a facet and AND across facets plus the search, and the
//     filtered projection is shared by both view modes;
//   * the received range is inclusive on the supplied local civil day and
//     reversed bounds are reported instead of silently swapped;
//   * Escape closes the Sheet and returns focus to the trigger;
//   * the screen stays overflow-clean and free of any backend or storage write,
//     and the open Sheet scans axe-clean.
//
// Reuses the live preview server (`PLAYWRIGHT_APP_ORIGIN`, default 3100); never
// touches 3001/4010 or any `/api/...` path. No webServer is configured here:
// this spec never starts or stops a service. Nothing in this file is evidence
// until it is actually run against the preview origin.

test.describe.configure({ mode: "serial" });

const APP_ORIGIN = (process.env.PLAYWRIGHT_APP_ORIGIN ?? "http://127.0.0.1:3100").replace(/\/$/u, "");
const ROUTE = "/empresa/vacantes/backend-developer-senior/pipeline";
const DESKTOP = { width: 1440, height: 900 } as const;
const WIDE = { width: 1920, height: 1080 } as const;
const MOBILE = { width: 375, height: 812 } as const;
const FORBIDDEN_PORTS = [":3001", ":4010"] as const;
const DISALLOWED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** `max-w-screen-2xl` is 1536px; the measure must settle exactly there when the viewport is wider. */
const SCREEN_2XL = 1536;

type Captured = { method: string; url: string };
const trackRequests = (page: Page) => {
  const seen: Captured[] = [];
  page.on("request", (entry) => seen.push({ method: entry.method(), url: entry.url() }));
  return seen;
};
const isNextInternal = (url: string) => /^\/(?:_next\/|__nextjs)/u.test(new URL(url, APP_ORIGIN).pathname);
const offendingMutations = (seen: readonly Captured[]) =>
  seen
    .filter(({ method, url }) => DISALLOWED_METHODS.has(method) && !isNextInternal(url))
    .map(({ method, url }) => `${method} ${url}`);
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

const readStorageWrites = async (page: Page) => {
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  return storageWrites.get(page) ?? [];
};

const search = (page: Page) => page.locator("[data-pf-pipeline-search]");
const cards = (page: Page) => page.locator("[data-pf-pipeline-card]");
const rows = (page: Page) => page.locator("[data-pf-pipeline-row]");
const content = (page: Page) => page.locator("[data-pf-pipeline-content]");
const filterSheet = (page: Page) => page.locator("[data-pf-pipeline-filters]");
const option = (page: Page, facet: string, value: string) =>
  page.locator(`[data-pf-pipeline-option="${facet}:${value}"]`);
const facetInput = (page: Page, facet: string) => page.locator(`#pipeline-filtro-${facet}`);

/** Opens the floating filter Sheet from the toolbar trigger. */
async function openFilters(page: Page) {
  await page.locator("[data-pf-pipeline-filter-toggle]").click();
  await expect(filterSheet(page)).toBeVisible();
}

/** Closes the filter Sheet through its footer close control. */
async function closeFilters(page: Page) {
  await page.locator("[data-pf-pipeline-filters-close]").click();
  await expect(filterSheet(page)).toBeHidden();
}

/** Selects one real option inside a facet's searchable multi-select. */
async function selectFacet(page: Page, facet: string, value: string) {
  await facetInput(page, facet).click();
  await option(page, facet, value).click();
}

/** Card ids currently rendered on the board. */
function cardIds(page: Page): Promise<string[]> {
  return page
    .locator("[data-pf-pipeline-card]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-pf-pipeline-card") ?? ""));
}

test.beforeEach(async ({ page }) => {
  await installStorageAudit(page);
});

test("the screen-2xl measure owns the whole body in both views and the open Sheet scans axe-clean @a11y", async ({ page }) => {
  const seen = trackRequests(page);
  await page.setViewportSize(WIDE);
  await page.goto(ROUTE);
  await expect(page.getByRole("heading", { level: 1, name: "Backend Developer (Senior)", exact: true })).toBeVisible();
  await expect(cards(page)).toHaveCount(4);

  // The single measure settles at 1536px on a wider viewport and holds the
  // board; switching views never introduces a second, narrower wrapper.
  const settled = () =>
    expect
      .poll(async () => {
        const box = await content(page).boundingBox();
        return box ? Math.round(box.width) : -1;
      })
      .toBe(SCREEN_2XL);
  await settled();
  expect(await content(page).evaluate((node) => node.contains(node.querySelector("[data-pf-pipeline-board]")))).toBe(true);

  await page.locator('[data-pf-pipeline-view-tab="list"]').click();
  await expect(page.locator("[data-pf-pipeline-list]")).toBeVisible();
  await settled();
  expect(await content(page).evaluate((node) => node.contains(node.querySelector("[data-pf-pipeline-list]")))).toBe(true);

  await openFilters(page);
  const results = await new AxeBuilder({ page })
    .include("[data-pf-pipeline-filters]")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const violations = results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => `${violation.id} -> ${violation.nodes[0]?.target?.join(" ") ?? ""}`);
  expect(violations).toEqual([]);
  await closeFilters(page);

  expect(offendingMutations(seen)).toEqual([]);
  expect(offendingTraffic(seen)).toEqual([]);
  expect(await readStorageWrites(page)).toEqual([]);
});

test("facets OR inside a facet and AND across facets over one projection shared by both views", async ({ page }) => {
  const seen = trackRequests(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(ROUTE);
  await expect(cards(page)).toHaveCount(4);

  // No count until a criterion is active.
  await expect(page.locator("[data-pf-pipeline-filter-count]")).toHaveCount(0);

  await openFilters(page);
  for (const facet of ["status", "source", "skill"]) {
    await expect(page.locator(`[data-pf-pipeline-facet="${facet}"]`)).toBeVisible();
  }
  // The pipeline model has no industry or location, so no such facet exists.
  await expect(page.locator('[data-pf-pipeline-facet="industry"]')).toHaveCount(0);
  await expect(page.locator('[data-pf-pipeline-facet="location"]')).toHaveCount(0);
  await selectFacet(page, "status", "submitted");
  await selectFacet(page, "status", "hired");
  // OR inside the status facet: Nuevos + Contratados.
  await expect.poll(() => cardIds(page)).toEqual(["lucia-fernandez", "renata-vargas"]);
  await closeFilters(page);
  await expect(page.locator("[data-pf-pipeline-filter-count]")).toHaveText("2");
  await expect(page.locator('[data-pf-pipeline-chip="status:submitted"]')).toContainText("Etapa: Nuevos");
  await expect(page.locator('[data-pf-pipeline-chip="status:hired"]')).toContainText("Etapa: Contratados");

  // AND across facets: Origen Directo keeps only Renata.
  await openFilters(page);
  await selectFacet(page, "source", "direct");
  await closeFilters(page);
  await expect.poll(() => cardIds(page)).toEqual(["renata-vargas"]);

  // The same filtered set feeds Lista; the board/list never diverge.
  await page.locator('[data-pf-pipeline-view-tab="list"]').click();
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator('[data-pf-pipeline-row="renata-vargas"]')).toBeVisible();
  await page.locator('[data-pf-pipeline-view-tab="board"]').click();
  await expect.poll(() => cardIds(page)).toEqual(["renata-vargas"]);

  // Removing one chip preserves the others.
  await page.locator('[data-pf-pipeline-chip="source:direct"]').click();
  await expect(page.locator('[data-pf-pipeline-chip="source:direct"]')).toHaveCount(0);
  await expect(page.locator('[data-pf-pipeline-chip="status:hired"]')).toBeVisible();
  await expect.poll(() => cardIds(page)).toEqual(["lucia-fernandez", "renata-vargas"]);

  expect(offendingMutations(seen)).toEqual([]);
  expect(offendingTraffic(seen)).toEqual([]);
  expect(await readStorageWrites(page)).toEqual([]);
});

test("a facet query matches the Spanish label and 10+ experience filters without a ceiling", async ({ page }) => {
  const seen = trackRequests(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(ROUTE);
  await expect(cards(page)).toHaveCount(4);

  await openFilters(page);
  // The query is matched against the visible Spanish label ("Contratados"), never
  // the stored domain id ("hired"), while the option keeps the domain id as value.
  await facetInput(page, "status").click();
  await facetInput(page, "status").fill("contrat");
  await expect(option(page, "status", "hired")).toBeVisible();
  await expect(option(page, "status", "hired")).toContainText("Contratados");
  await expect(option(page, "status", "submitted")).toHaveCount(0);
  await option(page, "status", "hired").click();

  // Experiencia 10+ is lower-bound only: the 11-year Renata qualifies and no
  // hidden 60-year upper bound can drop a more senior candidate.
  await option(page, "experience", "10+").click();
  await closeFilters(page);
  await expect(page.locator('[data-pf-pipeline-chip="status:hired"]')).toContainText("Etapa: Contratados");
  await expect(page.locator('[data-pf-pipeline-chip="experience:10+"]')).toContainText(
    "Experiencia: 10 años o más",
  );
  await expect.poll(() => cardIds(page)).toEqual(["renata-vargas"]);

  expect(offendingMutations(seen)).toEqual([]);
  expect(offendingTraffic(seen)).toEqual([]);
  expect(await readStorageWrites(page)).toEqual([]);
});

test("the toolbar search and the Sheet reset compose with the same filtered projection", async ({ page }) => {
  const seen = trackRequests(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(ROUTE);

  // Accent- and case-insensitive search, unchanged semantics, with its own chip.
  await search(page).fill("LUCÍA");
  await expect.poll(() => cardIds(page)).toEqual(["lucia-fernandez"]);
  await expect(page.locator('[data-pf-pipeline-chip="query"]')).toContainText("Búsqueda: LUCÍA");

  // Compose with a facet that excludes the search hit.
  await openFilters(page);
  await selectFacet(page, "status", "hired");
  await closeFilters(page);
  await expect(cards(page)).toHaveCount(0);
  await expect(page.locator("[data-pf-pipeline-recovery]")).toBeVisible();
  await expect(page.locator("[data-pf-pipeline-recovery]")).toContainText(/búsqueda/u);

  // The reset clears the search and every facet together.
  await openFilters(page);
  await page.locator("[data-pf-pipeline-filters-reset]").click();
  await closeFilters(page);
  await expect(search(page)).toHaveValue("");
  await expect(page.locator('[data-pf-pipeline-chip="status:hired"]')).toHaveCount(0);
  await expect(cards(page)).toHaveCount(4);

  expect(offendingMutations(seen)).toEqual([]);
  expect(offendingTraffic(seen)).toEqual([]);
  expect(await readStorageWrites(page)).toEqual([]);
});

test("the received-date range filters inclusively through the real calendars and reports reversed bounds", async ({ page }) => {
  const seen = trackRequests(page);
  // Pin "today" to the fixture month so the historical 2026 dates are selectable
  // while the past window stays open.
  await page.clock.setFixedTime(new Date("2026-03-15T12:00:00Z"));
  await page.setViewportSize(DESKTOP);
  await page.goto(ROUTE);
  await expect(cards(page)).toHaveCount(4);

  // Lower bound: 2026-03-03 keeps Lucia (03-10) and Diego (03-08) only.
  await openFilters(page);
  await page.locator("#pipeline-recibidos-desde").click();
  const fromCalendar = page.locator('[data-slot="calendar"]');
  await expect(fromCalendar).toBeVisible();
  await fromCalendar.locator('[data-day="3/3/2026"]').click();
  await closeFilters(page);
  await expect(page.locator('[data-pf-pipeline-chip="receivedFrom"]')).toContainText("Recibidos desde: 2026-03-03");
  await expect.poll(() => cardIds(page)).toEqual(["lucia-fernandez", "diego-salazar"]);

  // Reversed bounds: set the upper bound before the lower one. The bounds stay
  // exactly as typed, the Sheet reports the inversion and no card matches.
  await openFilters(page);
  await page.locator("#pipeline-recibidos-hasta").click();
  const toCalendar = page.locator('[data-slot="calendar"]');
  await expect(toCalendar).toBeVisible();
  await toCalendar.locator('[data-day="1/3/2026"]').click();
  await expect(page.locator("[data-pf-pipeline-range-error]")).toBeVisible();
  await expect(page.locator("[data-pf-pipeline-range-error]")).toContainText(/posterior a la final/u);
  await expect(page.locator('[data-pf-pipeline-chip="receivedFrom"]')).toContainText("2026-03-03");
  await expect(page.locator('[data-pf-pipeline-chip="receivedTo"]')).toContainText("2026-03-01");
  await closeFilters(page);
  await expect(cards(page)).toHaveCount(0);

  expect(offendingMutations(seen)).toEqual([]);
  expect(offendingTraffic(seen)).toEqual([]);
  expect(await readStorageWrites(page)).toEqual([]);
});

test("Escape closes the filter Sheet and returns focus to the trigger", async ({ page }) => {
  const seen = trackRequests(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(ROUTE);

  const trigger = page.locator("[data-pf-pipeline-filter-toggle]");
  await trigger.click();
  await expect(filterSheet(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(filterSheet(page)).toBeHidden();
  await expect(trigger).toBeFocused();

  expect(offendingMutations(seen)).toEqual([]);
  expect(offendingTraffic(seen)).toEqual([]);
  expect(await readStorageWrites(page)).toEqual([]);
});

test("mobile stays overflow-clean with the filter trigger reachable", async ({ page }) => {
  const seen = trackRequests(page);
  await page.setViewportSize(MOBILE);
  await page.goto(ROUTE);
  await expect(search(page)).toBeVisible();
  await expect(page.locator("[data-pf-pipeline-filter-toggle]")).toBeVisible();
  await expect(page.locator("[data-pf-pipeline-view]")).toBeVisible();
  await expect.poll(() => overflowPx(page)).toBeLessThanOrEqual(1);

  await openFilters(page);
  await expect.poll(() => overflowPx(page)).toBeLessThanOrEqual(1);
  await closeFilters(page);

  expect(offendingMutations(seen)).toEqual([]);
  expect(offendingTraffic(seen)).toEqual([]);
  expect(await readStorageWrites(page)).toEqual([]);
});
