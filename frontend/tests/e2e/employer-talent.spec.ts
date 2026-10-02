import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// ET — employer talent base browser acceptance for `/empresa/talento`. The
// contract proves:
//   * real local search and facets compose (OR inside a facet, AND across
//     facets) and application criteria only match the SAME application;
//   * sorting, pagination, column visibility, pinning, native drag-and-drop and
//     the accessible reorder alternatives in each column header's three-dot
//     menu all work;
//   * sorting reorders the rendered page rows, asserted from the real ids and
//     cell text instead of only the `aria-sort` attribute, and the sorted
//     window continues on the next page;
//   * the accessible column reorder is fully operable from the keyboard alone
//     (focus plus native Enter/Space navigation), while the first column in a
//     region keeps its move control disabled;
//   * the lateral filter Sheet carries the searchable multi-select facets, the
//     installed date fields and its own close/reset controls;
//   * the single detail sheet opens outside the table loop, closes with Escape
//     and returns focus to the row control, opens inside the mobile viewport
//     with keyboard focus trapped in the dialog, floats inset from every
//     viewport edge, and opens over dark surfaces;
//   * the four global summary cards report the whole-base fixture figures and
//     survive filtering, an empty result set and pagination; the rows keep
//     their ~70px density and the sheet body (cover and identity included)
//     scrolls under a fixed footer that stays reachable even at 320px tall;
//   * axe WCAG A/AA scans cover the OPEN panel surfaces too: the portalled
//     sheet, the filter Sheet and the column visibility menu. The two scan
//     tests carry the `@a11y` tag so `pnpm test:a11y` (`playwright test --grep
//     @a11y`) picks them up;
//   * desktop, mobile and dark stay visible, overflow-clean and free of any
//     backend or storage write.
//
// Reuses the live preview server (`PLAYWRIGHT_APP_ORIGIN`, default 3100); never
// touches 3001/4010 or any `/api/...` path. The storage audit forwards every
// write to a persistent page binding so the evidence accumulates across
// same-page document navigation instead of resetting with `addInitScript`. No
// webServer is configured here: this spec never starts or stops a service.
// Nothing in this file is evidence until it is actually run against the preview
// origin; the drag path in particular is only proven by real browser input, so a
// synthetic in-page dispatch is never used as a substitute.

test.describe.configure({ mode: "serial" });

const APP_ORIGIN = (process.env.PLAYWRIGHT_APP_ORIGIN ?? "http://127.0.0.1:3100").replace(/\/$/u, "");
const ROUTE = "/empresa/talento";
const DESKTOP = { width: 1440, height: 900 } as const;
const MOBILE = { width: 375, height: 812 } as const;
const FORBIDDEN_PORTS = [":3001", ":4010"] as const;
const DISALLOWED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// Floating Sheet geometry: the shared panel keeps an 8px mobile / 16px desktop
// inset, so its anchored edge and both opposing edges sit exactly that far from
// the viewport. These mirror `--sheet-inset` in `src/components/ui/sheet.tsx`.
const SHEET_INSET_DESKTOP = 16;
const SHEET_INSET_MOBILE = 8;

/**
 * Deterministic fixture expectations for the `yearsOfExperience` sort of the
 * 32-person fixture: the ids and rendered years of the first ten sorted rows.
 *
 * Two library facts make this order exact rather than incidental. A numeric
 * accessor column starts on `descending` (the first sort direction is inferred
 * from the sampled numeric values) and its sort function is `basic`, and
 * TanStack's sorted row model breaks ties with `rowA.index - rowB.index`, so
 * equal experience keeps fixture order and the sequence is stable.
 */
const YEARS_SORT = {
  descending: {
    ids: [
      "rafael-ocampo",
      "mauricio-rosas",
      "joaquin-herrera",
      "emilio-cardenas",
      "diego-molina",
      "pablo-esquivel",
      "ricardo-mendoza",
      "alejandro-nunez",
      "sergio-tapia",
      "natalia-fuentes",
    ],
    years: [16, 14, 12, 11, 10, 10, 9, 9, 8, 8],
  },
  ascending: {
    ids: [
      "alejandra-sandoval",
      "paulina-ortega",
      "ximena-vargas",
      "daniela-acosta",
      "santiago-lozano",
      "valeria-cordova",
      "camila-solorzano",
      "sebastian-camacho",
      "catalina-bustamante",
      "gabriela-soto",
    ],
    years: [2, 3, 3, 3, 3, 4, 4, 4, 4, 5],
  },
} as const;

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

/**
 * The floating Sheet contract, measured on the real portalled panel: the
 * anchored edge and both opposing edges keep the committed inset, and the free
 * edge stays inside it. A right-side panel therefore keeps `top`, `bottom` and
 * `right` at the inset while its left edge is free.
 */
async function expectFloatingInset(page: Page, inset: number) {
  const panel = page.locator("[data-pf-talento-sheet]");
  await expect(panel).toHaveAttribute("data-presentation", "floating");
  await expect
    .poll(
      async () => {
        const box = await panel.boundingBox();
        const viewport = page.viewportSize();
        if (!box || !viewport) return Number.POSITIVE_INFINITY;
        return Math.max(
          Math.abs(box.y - inset),
          Math.abs(box.y + box.height - (viewport.height - inset)),
          Math.abs(box.x + box.width - (viewport.width - inset)),
        );
      },
      { message: `the floating sheet must keep its ${inset}px viewport inset` },
    )
    .toBeLessThanOrEqual(1.5);
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(inset - 1);
}

/** Rendered data-row heights, in DOM order, from the real layout. */
function rowHeights(page: Page): Promise<number[]> {
  return page
    .locator("[data-pf-talento-row]")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().height),
    );
}

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

const search = (page: Page) => page.locator("[data-pf-talento-search]");
const rows = (page: Page) => page.locator("[data-pf-talento-row]");
const option = (page: Page, facet: string, value: string) =>
  page.locator(`[data-pf-talento-option="${facet}:${value}"]`);
const filterSheet = (page: Page) => page.locator("[data-pf-talento-filters]");
const columnsMenu = (page: Page) =>
  page.locator("[data-pf-talento-columns-menu]");
const facetInput = (page: Page, facet: string) =>
  page.locator(`#talento-filtro-${facet}`);

/** Opens the lateral filter Sheet from the toolbar trigger. */
async function openFilters(page: Page) {
  await page.locator("[data-pf-talento-filter-toggle]").click();
  await expect(filterSheet(page)).toBeVisible();
}

/** Closes the filter Sheet through its footer close control. */
async function closeFilters(page: Page) {
  await page.locator("[data-pf-talento-filters-close]").click();
  await expect(filterSheet(page)).toBeHidden();
}

/**
 * Selects one option inside a facet's searchable multi-select. The chips input
 * opens the combobox popup, then the option is activated.
 */
async function selectFacet(page: Page, facet: string, value: string) {
  await facetInput(page, facet).click();
  await option(page, facet, value).click();
}

/** Opens one column header's three-dot menu through its trigger. */
async function openHeaderMenu(page: Page, id: string) {
  await page.locator(`[data-pf-talento-column-menu="${id}"]`).click();
  await expect(
    page.locator(`[data-pf-talento-column-menu-content="${id}"]`),
  ).toBeVisible();
}

/** Rendered header ids, in DOM order, pinned regions first. */
async function firstHeaders(page: Page, count = 4): Promise<string[]> {
  const ids = await page
    .locator("[data-pf-talento-th]")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-pf-talento-th") ?? ""),
    );
  return ids.slice(0, count);
}

/** Rendered row ids, top to bottom, in the current page window. */
function rowIds(page: Page): Promise<string[]> {
  return page
    .locator("[data-pf-talento-row]")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-pf-talento-row") ?? ""),
    );
}

/**
 * Years of experience of every rendered row, read from the real cell that sits
 * under the `yearsOfExperience` header. The cell index is resolved from the
 * rendered header order, so the assertion follows the visible column layout
 * instead of hardcoding a cell position.
 */
async function renderedYears(page: Page): Promise<number[]> {
  const headerIds = await page
    .locator("[data-pf-talento-th]")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-pf-talento-th") ?? ""),
    );
  const columnIndex = headerIds.indexOf("yearsOfExperience");
  expect(columnIndex, "the experience column must be rendered").toBeGreaterThanOrEqual(0);
  return page.locator("[data-pf-talento-row]").evaluateAll(
    (rows, index) =>
      rows.map((row) => {
        const text = row.querySelectorAll("td")[index]?.textContent ?? "";
        return Number.parseInt(text, 10);
      }),
    columnIndex,
  );
}

/**
 * Reorders one header onto another using the browser's own pointer-driven
 * HTML5 drag-and-drop. The drag starts on the dedicated header handle (never on
 * the whole header) while the drop target stays the header cell.
 * `locator.dragTo` presses, moves and releases real input, so Chromium emits
 * genuine `dragstart`/`dragover`/`drop` in separate tasks and React can commit
 * `draggingId` between them. Synthetic `dispatchEvent` calls inside one
 * `page.evaluate` cannot: they all run in a single task where `draggingId` is
 * still null, so `dragover` is never cancelled and the drop is rejected. The
 * resulting visible order is asserted by the caller with `expect.poll`, never
 * with a synchronous snapshot.
 */
async function dragColumn(page: Page, fromId: string, toId: string) {
  const source = page.locator(`[data-pf-talento-column-handle="${fromId}"]`);
  const target = page.locator(`[data-pf-talento-th="${toId}"]`);
  await expect(source).toHaveCount(1);
  await expect(target).toHaveCount(1);
  await source.dragTo(target);
}

test.beforeEach(async ({ page }) => {
  await installStorageAudit(page);
});

test("search, facets, chips and reset compose with the same-application rule", async ({ page }) => {
  const seen = trackRequests(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(ROUTE);
  await expect(page.getByRole("heading", { level: 1, name: "Base de talento", exact: true })).toBeVisible();
  await expect(page.locator("[data-pf-talento-workspace]")).toBeVisible();
  await expect(rows(page)).toHaveCount(10);

  // Real search narrows rows and exposes a removable chip.
  await search(page).fill("gabriela");
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator('[data-pf-talento-row="gabriela-soto"]')).toBeVisible();
  await expect(page.locator('[data-pf-talento-chip="query"]')).toBeVisible();
  await page.locator('[data-pf-talento-chip="query"]').click();
  await expect(search(page)).toHaveValue("");
  await expect(rows(page)).toHaveCount(10);

  // Independent facets AND; values inside one facet OR. The facets live in the
  // lateral Sheet, so each facet change closes the Sheet before the toolbar
  // chips (behind the modal) are clicked.
  await openFilters(page);
  await selectFacet(page, "industry", "Tecnología");
  await closeFilters(page);
  await expect(page.locator('[data-pf-talento-chip="industry:Tecnología"]')).toBeVisible();
  const resultCount = page.locator("[data-pf-talento-result-count]");
  await expect(resultCount).toHaveText("Mostrando 10 de 11 personas");
  await openFilters(page);
  await selectFacet(page, "industry", "Salud");
  await closeFilters(page);
  await expect(resultCount).toHaveText("Mostrando 10 de 14 personas");
  await page.locator('[data-pf-talento-chip="industry:Salud"]').click();
  await expect(resultCount).toHaveText("Mostrando 10 de 11 personas");

  // Position + stage must share one application: Gabriela applied to Frontend
  // (in review) and Fullstack (submitted), so Frontend + Contratado excludes her
  // while Natalia, whose frontend application is hired, stays.
  await openFilters(page);
  await selectFacet(page, "position", "frontend-engineer-react");
  await selectFacet(page, "stage", "hired");
  await closeFilters(page);
  await expect(page.locator('[data-pf-talento-row="natalia-fuentes"]')).toHaveCount(1);
  await expect(page.locator('[data-pf-talento-row="gabriela-soto"]')).toHaveCount(0);

  // Reset from inside the Sheet restores every row and clears the search.
  await openFilters(page);
  await page.locator("[data-pf-talento-clear]").click();
  await closeFilters(page);
  await expect(rows(page)).toHaveCount(10);
  await expect(search(page)).toHaveValue("");

  // A truthful empty state recovers through the same reset.
  await search(page).fill("zzz-no-match");
  await expect(page.locator("[data-pf-talento-empty]")).toBeVisible();
  await expect(page.locator("[data-pf-talento-empty]")).toContainText(/Sin resultados/);
  await expect(rows(page)).toHaveCount(0);

  expect(offendingMutations(seen)).toEqual([]);
  expect(offendingTraffic(seen)).toEqual([]);
  expect(await readStorageWrites(page)).toEqual([]);
});

test("sorting, pagination, visibility, pinning, reorder and drag-and-drop stay local", async ({ page }) => {
  const seen = trackRequests(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(ROUTE);
  await expect(page.locator("[data-pf-talento-table]")).toBeVisible();
  await expect(page.locator("[data-pf-talento-result-count]")).toContainText("Mostrando 10 de 32 personas");

  // Sorting flips the aria-sort contract on the experience column.
  const experienceHeader = page.locator('[data-pf-talento-th="yearsOfExperience"]');
  await expect(experienceHeader).toHaveAttribute("aria-sort", "none");
  await page.locator('[data-pf-talento-sort="yearsOfExperience"]').click();
  await expect(experienceHeader).toHaveAttribute("aria-sort", "descending");
  await page.locator('[data-pf-talento-sort="yearsOfExperience"]').click();
  await expect(experienceHeader).toHaveAttribute("aria-sort", "ascending");

  // Pagination is local and truthful.
  await page.getByRole("button", { name: "Ir a la página siguiente" }).click();
  await expect(page.getByText("Página 2 de 4")).toBeVisible();
  await expect(rows(page)).toHaveCount(10);
  await expect(page.getByRole("button", { name: "Ir a la primera página" })).toBeEnabled();

  // Column visibility is a real column removal, not a hidden duplicate.
  await page.locator("[data-pf-talento-columns]").click();
  await expect(columnsMenu(page)).toBeVisible();
  await page.locator('[data-pf-talento-column-toggle="location"]').click();
  await expect(page.locator('[data-pf-talento-th="location"]')).toHaveCount(0);
  // Checkbox items keep the menu open so several columns can be toggled; a
  // hidden column has no header to pin, reorder or drag, so reveal it again.
  await expect(columnsMenu(page)).toBeVisible();
  await page.locator('[data-pf-talento-column-toggle="location"]').click();
  await expect(page.locator('[data-pf-talento-th="location"]')).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(columnsMenu(page)).toBeHidden();

  // Pinning happens in the header's three-dot menu and produces a pixel sticky
  // offset from the shared sizing source.
  await openHeaderMenu(page, "location");
  await page.locator('[data-pf-talento-column-pin-start="location"]').click();
  const locationHeader = page.locator('[data-pf-talento-th="location"]');
  await expect(locationHeader).toHaveAttribute("data-pinned", "start");
  const sticky = await locationHeader.evaluate((node) => {
    const style = getComputedStyle(node);
    return { position: style.position, left: style.left };
  });
  expect(sticky.position).toBe("sticky");
  expect(sticky.left).not.toBe("auto");
  // Unpin restores the center region.
  await openHeaderMenu(page, "location");
  await page.locator('[data-pf-talento-column-pin-start="location"]').click();
  await expect(locationHeader).not.toHaveAttribute("data-pinned", "start");

  // Accessible reorder alternative in the header menu, asserted as observable
  // rendered order.
  await expect.poll(() => firstHeaders(page)).toEqual([
    "fullName",
    "professionalTitle",
    "industry",
    "location",
  ]);
  await openHeaderMenu(page, "location");
  await page.locator('[data-pf-talento-column-move-left="location"]').click();
  await expect.poll(() => firstHeaders(page)).toEqual([
    "fullName",
    "professionalTitle",
    "location",
    "industry",
  ]);

  // Native pointer-driven drag-and-drop reorder inside the same region, started
  // on the dedicated handle: the drop only lands when the browser, not a
  // script, owns the drag lifecycle.
  await expect.poll(() => firstHeaders(page)).toEqual([
    "fullName",
    "professionalTitle",
    "location",
    "industry",
  ]);
  await dragColumn(page, "industry", "location");
  await expect.poll(() => firstHeaders(page)).toEqual([
    "fullName",
    "professionalTitle",
    "industry",
    "location",
  ]);

  expect(offendingMutations(seen)).toEqual([]);
  expect(offendingTraffic(seen)).toEqual([]);
  expect(await readStorageWrites(page)).toEqual([]);
});

test("sorting reorders the rendered page rows, not only the aria-sort attribute", async ({ page }) => {
  const seen = trackRequests(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(ROUTE);
  await expect(page.locator("[data-pf-talento-table]")).toBeVisible();
  await expect(page.locator("[data-pf-talento-result-count]")).toContainText("Mostrando 10 de 32 personas");
  await expect(page.getByText("Página 1 de 4")).toBeVisible();

  const experienceHeader = page.locator('[data-pf-talento-th="yearsOfExperience"]');
  const sortToggle = page.locator('[data-pf-talento-sort="yearsOfExperience"]');
  await expect(experienceHeader).toHaveAttribute("aria-sort", "none");

  // First activation sorts a numeric column descending: the most experienced
  // people come first and the rendered ids and years must follow that order.
  await sortToggle.click();
  await expect(experienceHeader).toHaveAttribute("aria-sort", "descending");
  await expect.poll(() => rowIds(page)).toEqual(YEARS_SORT.descending.ids);
  expect(await renderedYears(page)).toEqual(YEARS_SORT.descending.years);

  // The opposite activation is a real reversal of the same rows.
  await sortToggle.click();
  await expect(experienceHeader).toHaveAttribute("aria-sort", "ascending");
  await expect.poll(() => rowIds(page)).toEqual(YEARS_SORT.ascending.ids);
  expect(await renderedYears(page)).toEqual(YEARS_SORT.ascending.years);

  // The sorted window continues on the next page instead of restarting from an
  // unsorted fixture block, and the truthful counts survive sorting.
  await expect(page.locator("[data-pf-talento-result-count]")).toContainText("Mostrando 10 de 32 personas");
  await page.getByRole("button", { name: "Ir a la página siguiente" }).click();
  await expect(page.getByText("Página 2 de 4")).toBeVisible();
  const pageTwoYears = await renderedYears(page);
  expect(pageTwoYears).toHaveLength(10);
  for (const years of pageTwoYears) {
    expect(years).toBeGreaterThanOrEqual(YEARS_SORT.ascending.years.at(-1) ?? 0);
  }

  // Sorting changes nothing outside React state.
  expect(offendingMutations(seen)).toEqual([]);
  expect(offendingTraffic(seen)).toEqual([]);
  expect(await readStorageWrites(page)).toEqual([]);
});

test("the accessible column reorder is operable from the keyboard alone", async ({ page }) => {
  const seen = trackRequests(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(ROUTE);
  await expect(page.locator("[data-pf-talento-table]")).toBeVisible();
  await expect.poll(() => firstHeaders(page)).toEqual([
    "fullName",
    "professionalTitle",
    "industry",
    "location",
  ]);

  // Open one header menu with the keyboard only: focus the trigger and
  // activate it with Enter, then prove the panel really is rendered. The first
  // column of a region cannot move toward the start, so its controls stay
  // disabled and are skipped by arrow navigation.
  const firstTrigger = page.locator(
    '[data-pf-talento-column-menu="professionalTitle"]',
  );
  await firstTrigger.focus();
  await expect(firstTrigger).toBeFocused();
  await page.keyboard.press("Enter");
  const firstMenu = page.locator(
    '[data-pf-talento-column-menu-content="professionalTitle"]',
  );
  await expect(firstMenu).toBeVisible();
  await expect(
    page.locator('[data-pf-talento-column-move-left="professionalTitle"]'),
  ).toBeDisabled();
  await expect(
    page.locator('[data-pf-talento-column-move-start="professionalTitle"]'),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(firstMenu).toBeHidden();

  // Move "industry" one position left with real keyboard navigation only:
  // Enter opens the header menu, ArrowDown highlights the move item and Enter
  // activates it.
  const trigger = page.locator('[data-pf-talento-column-menu="industry"]');
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  const menu = page.locator(
    '[data-pf-talento-column-menu-content="industry"]',
  );
  await expect(menu).toBeVisible();
  const moveLeft = page.locator(
    '[data-pf-talento-column-move-left="industry"]',
  );
  for (let step = 0; step < 8; step++) {
    if (await moveLeft.evaluate((node) => node.hasAttribute("data-highlighted"))) break;
    await page.keyboard.press("ArrowDown");
  }
  await expect(moveLeft).toHaveAttribute("data-highlighted", "");
  await page.keyboard.press("Enter");
  await expect.poll(() => firstHeaders(page)).toEqual([
    "fullName",
    "industry",
    "professionalTitle",
    "location",
  ]);

  // Space activates the same native menu items and moves the column back.
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  const moveRight = page.locator(
    '[data-pf-talento-column-move-right="industry"]',
  );
  for (let step = 0; step < 8; step++) {
    if (await moveRight.evaluate((node) => node.hasAttribute("data-highlighted"))) break;
    await page.keyboard.press("ArrowDown");
  }
  await expect(moveRight).toHaveAttribute("data-highlighted", "");
  await page.keyboard.press("Space");
  await expect.poll(() => firstHeaders(page)).toEqual([
    "fullName",
    "professionalTitle",
    "industry",
    "location",
  ]);

  expect(offendingMutations(seen)).toEqual([]);
  expect(offendingTraffic(seen)).toEqual([]);
  expect(await readStorageWrites(page)).toEqual([]);
});

test("the applied date range filters through the real calendars at both bounds", async ({ page }) => {
  const seen = trackRequests(page);
  // Pin "today" to the fixture month so the historical 2026 applications are
  // selectable. `setFixedTime` freezes `Date` without touching the timers Base
  // UI and Next rely on, so the real popover and calendar still behave.
  await page.clock.setFixedTime(new Date("2026-03-15T12:00:00Z"));
  await page.setViewportSize(DESKTOP);
  await page.goto(ROUTE);
  await expect(page.locator("[data-pf-talento-table]")).toBeVisible();

  // Lower bound: open the real calendar and pick 2026-03-10. The open calendar
  // is the guard that keeps the test from passing on a day click that never
  // rendered.
  await openFilters(page);
  await page.locator("#talento-aplicado-desde").click();
  const fromCalendar = page.locator('[data-slot="calendar"]');
  await expect(fromCalendar).toBeVisible();
  await fromCalendar.locator('[data-day="10/3/2026"]').click();
  await closeFilters(page);
  await expect(
    page.locator('[data-pf-talento-chip="appliedFrom"]'),
  ).toContainText("Postuladas desde: 2026-03-10");
  // Ricardo's only application (2026-02-20) is before the lower bound, while
  // Gabriela still has an application on 2026-03-11.
  await expect(page.locator('[data-pf-talento-row="ricardo-mendoza"]')).toHaveCount(0);
  await expect(page.locator('[data-pf-talento-row="gabriela-soto"]')).toHaveCount(1);

  // Upper bound: open the calendar again and pick 2026-03-12, closing the
  // window. The fixture then has exactly five people with one application
  // inside [2026-03-10, 2026-03-12].
  await openFilters(page);
  await page.locator("#talento-aplicado-hasta").click();
  const toCalendar = page.locator('[data-slot="calendar"]');
  await expect(toCalendar).toBeVisible();
  await toCalendar.locator('[data-day="12/3/2026"]').click();
  await closeFilters(page);
  await expect(
    page.locator('[data-pf-talento-chip="appliedTo"]'),
  ).toContainText("Postuladas hasta: 2026-03-12");
  await expect(rows(page)).toHaveCount(5);
  await expect(page.locator('[data-pf-talento-row="gabriela-soto"]')).toHaveCount(1);
  await expect(page.locator('[data-pf-talento-row="sergio-tapia"]')).toHaveCount(0);
  await expect(page.locator('[data-pf-talento-row="hector-rivera"]')).toHaveCount(0);

  expect(offendingMutations(seen)).toEqual([]);
  expect(offendingTraffic(seen)).toEqual([]);
  expect(await readStorageWrites(page)).toEqual([]);
});

test("the single detail sheet keeps the full history and returns focus on Escape", async ({ page }) => {
  const seen = trackRequests(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(ROUTE);

  const trigger = page.locator('[data-pf-talento-open="gabriela-soto"]');
  await trigger.click();
  const sheet = page.locator("[data-pf-talento-sheet]");
  await expect(sheet).toBeVisible();
  await expect(page.locator("[data-slot='sheet-content']")).toHaveCount(1);
  await expect(page.locator("[data-pf-talento-sheet-name]")).toHaveText("Gabriela Soto");
  // The redesigned interior keeps one full-width cover inside the single
  // scrolling body (a descendant of the body, not a fixed first child of a
  // fixed header) and the approved reading order; the shared floating panel
  // geometry measured above is untouched.
  await expect(sheet.locator("[data-pf-talento-sheet-cover]")).toBeVisible();
  await expect(
    sheet.locator("[data-pf-talento-sheet-body] [data-pf-talento-sheet-cover]"),
  ).toHaveCount(1);
  const sectionTitles = await sheet
    .locator("[data-pf-talento-sheet-body] h3")
    .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ""));
  expect(sectionTitles).toEqual([
    "Habilidades",
    "Preferencias laborales",
    "Datos de contacto",
    "Perfil profesional",
    "Currículum",
    "Historial de postulaciones",
  ]);
  // The demo Currículum card derives its filename from the candidate (no
  // invented size or upload date) and keeps both affordances enabled, focusable
  // and inert, as the durable rules require for presentation placeholders: no
  // link, no href and no real file behind them.
  const cvSection = sheet.locator(
    '[aria-labelledby="talento-detalle-curriculum"]',
  );
  await expect(cvSection).toContainText("CV-Gabriela-Soto.pdf");
  // The placeholder carries no visible demo/prototype disclaimer and no note.
  await expect(cvSection).not.toContainText(/demostración|prototipo/iu);
  await expect(
    cvSection.locator("#talento-detalle-curriculum-demo"),
  ).toHaveCount(0);
  const verCv = cvSection.getByRole("button", { name: "Ver CV" });
  const descargar = cvSection.getByRole("button", { name: "Descargar" });
  await expect(verCv).toBeEnabled();
  await expect(descargar).toBeEnabled();
  // Enabled means reachable: real keyboard focus lands on the placeholder.
  await verCv.focus();
  await expect(verCv).toBeFocused();
  // Clicking is inert: the sheet stays open on the same person, the URL does not
  // move and no fake success feedback appears anywhere.
  const urlBeforeCvClick = page.url();
  await verCv.click();
  await descargar.click();
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Gabriela Soto");
  await expect(sheet).not.toContainText(
    /descargado|descarga iniciada|éxito|abriendo/i,
  );
  expect(page.url()).toBe(urlBeforeCvClick);
  await expect(cvSection.locator("a")).toHaveCount(0);
  await expect(cvSection.locator("[download]")).toHaveCount(0);
  await expect(cvSection.locator("[href]")).toHaveCount(0);
  // The desktop panel floats 16px inside the viewport on the anchored and
  // opposing edges instead of bleeding edge to edge.
  await expectFloatingInset(page, SHEET_INSET_DESKTOP);
  // The full history renders both applications for this person.
  await expect(page.locator("[data-pf-talento-history-item]")).toHaveCount(2);
  await expect(page.locator('[data-pf-talento-history-vacancy="frontend-engineer-react"]')).toBeVisible();
  await expect(page.locator('[data-pf-talento-history-vacancy="fullstack-developer"]')).toBeVisible();
  // No fake universal status or match score survives on the person surface.
  await expect(sheet).not.toContainText(/match|score|compatibilidad/i);

  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(trigger).toBeFocused();

  expect(offendingMutations(seen)).toEqual([]);
  expect(offendingTraffic(seen)).toEqual([]);
  expect(await readStorageWrites(page)).toEqual([]);
});

test("the demo Currículum card gives the filename usable width and moves its actions to their own row at the narrow floating panel", async ({ page }) => {
  const seen = trackRequests(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(ROUTE);
  await expect(page.locator("[data-pf-talento-workspace]")).toBeVisible();

  const trigger = page.locator('[data-pf-talento-open="gabriela-soto"]');
  await trigger.click();
  const sheet = page.locator("[data-pf-talento-sheet]");
  await expect(sheet).toBeVisible();

  // The floating panel is capped at 24rem even on this wide viewport, so the CV
  // card must compose from its own local width. The old `sm:flex-row` viewport
  // breakpoint fired here anyway and squeezed the filename into a few-letters
  // vertical column beside the intrinsic-width buttons.
  const panelBox = await sheet.boundingBox();
  expect(panelBox).not.toBeNull();
  expect(panelBox!.width).toBeLessThanOrEqual(384 + 1);

  const card = sheet.locator("[data-pf-talento-curriculum]");
  await expect(card).toBeVisible();
  expect(await card.getAttribute("class")).not.toContain("sm:flex-row");
  const filename = card.locator("[data-pf-talento-curriculum-filename]");
  await expect(filename).toHaveText("CV-Gabriela-Soto.pdf");

  // The card never overflows its own column.
  await expect
    .poll(() => card.evaluate((node) => node.scrollWidth - node.clientWidth))
    .toBeLessThanOrEqual(1);

  // The filename keeps a real reading width inside the text row instead of the
  // few-letters column the horizontal row produced.
  const filenameBox = await filename.boundingBox();
  const textRowBox = await card
    .locator("[data-pf-talento-curriculum-text]")
    .boundingBox();
  expect(filenameBox).not.toBeNull();
  expect(textRowBox).not.toBeNull();
  expect(filenameBox!.width).toBeGreaterThan(120);
  expect(filenameBox!.width).toBeLessThanOrEqual(textRowBox!.width + 0.5);

  // The actions are a second row: below the filename metadata, side by side on
  // one line and inside the card box.
  const filenameRowBox = await filename.boundingBox();
  const verBox = await card.getByRole("button", { name: "Ver CV" }).boundingBox();
  const descBox = await card
    .getByRole("button", { name: "Descargar" })
    .boundingBox();
  const cardBox = await card.boundingBox();
  expect(filenameRowBox).not.toBeNull();
  expect(verBox).not.toBeNull();
  expect(descBox).not.toBeNull();
  expect(cardBox).not.toBeNull();
  expect(verBox!.y).toBeGreaterThanOrEqual(
    filenameRowBox!.y + filenameRowBox!.height - 1,
  );
  expect(descBox!.y).toBeGreaterThanOrEqual(
    filenameRowBox!.y + filenameRowBox!.height - 1,
  );
  expect(Math.abs(verBox!.y - descBox!.y)).toBeLessThanOrEqual(1);
  for (const box of [verBox!, descBox!]) {
    expect(box.x).toBeGreaterThanOrEqual(cardBox!.x - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(
      cardBox!.x + cardBox!.width + 1,
    );
  }
  await expect.poll(() => overflowPx(page)).toBeLessThanOrEqual(1);

  // Same contract at the narrowest supported viewport: the card never overflows
  // and the wrapped action row stays inside it (a safe single column if the
  // panel is narrower than two 7rem targets plus the gap).
  await page.setViewportSize(MOBILE);
  await expect(card).toBeVisible();
  await expect
    .poll(() => card.evaluate((node) => node.scrollWidth - node.clientWidth))
    .toBeLessThanOrEqual(1);
  const mobileFilenameBox = await filename.boundingBox();
  const mobileVerBox = await card
    .getByRole("button", { name: "Ver CV" })
    .boundingBox();
  const mobileCardBox = await card.boundingBox();
  expect(mobileFilenameBox).not.toBeNull();
  expect(mobileVerBox).not.toBeNull();
  expect(mobileCardBox).not.toBeNull();
  expect(mobileFilenameBox!.width).toBeGreaterThan(80);
  expect(mobileVerBox!.y).toBeGreaterThanOrEqual(
    mobileFilenameBox!.y + mobileFilenameBox!.height - 1,
  );
  expect(mobileVerBox!.x).toBeGreaterThanOrEqual(mobileCardBox!.x - 1);
  expect(mobileVerBox!.x + mobileVerBox!.width).toBeLessThanOrEqual(
    mobileCardBox!.x + mobileCardBox!.width + 1,
  );
  await expect.poll(() => overflowPx(page)).toBeLessThanOrEqual(1);

  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  expect(offendingMutations(seen)).toEqual([]);
  expect(offendingTraffic(seen)).toEqual([]);
  expect(await readStorageWrites(page)).toEqual([]);
});

test("the detail sheet opens inside the mobile viewport, traps focus and returns it", async ({ page }) => {
  const seen = trackRequests(page);
  await page.setViewportSize(MOBILE);
  await page.goto(ROUTE);

  const trigger = page.locator('[data-pf-talento-open="gabriela-soto"]');
  await trigger.click();
  const sheet = page.locator("[data-pf-talento-sheet]");
  await expect(sheet).toBeVisible();
  await expect(page.locator("[data-pf-talento-sheet-name]")).toHaveText("Gabriela Soto");
  // At 375px the panel floats 8px inside the viewport on the anchored and
  // opposing edges, so `w-full` is clamped by the inset-adjusted max width.
  await expectFloatingInset(page, SHEET_INSET_MOBILE);

  // The open portalled panel must stay inside the 375px viewport without
  // pushing the document into horizontal overflow once the slide-in settles.
  await expect
    .poll(async () => {
      const box = await sheet.boundingBox();
      return box ? box.x + box.width : Number.POSITIVE_INFINITY;
    })
    .toBeLessThanOrEqual(MOBILE.width + 0.5);
  const box = await sheet.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
  await expect.poll(() => overflowPx(page)).toBeLessThanOrEqual(1);

  // Keyboard focus is trapped in the dialog. Base UI keeps focus guards around
  // the modal (one of them even lives in the page DOM beside the portal) that
  // can own focus for a frame while handing it back inside, so every stop is
  // asserted as "focus settles inside the Sheet" instead of as a one-frame
  // snapshot. A broken trap never settles and times out here.
  const settleInsideSheet = (step: number) =>
    expect
      .poll(
        () =>
          page.evaluate(
            () => document.activeElement?.closest("[data-pf-talento-sheet]") !== null,
          ),
        {
          message: `focus must settle inside the open Sheet after keyboard stop ${step}`,
          timeout: 5_000,
        },
      )
      .toBe(true);
  const visited = new Set<string>();
  for (let step = 0; step < 10; step++) {
    await page.keyboard.press("Tab");
    await settleInsideSheet(step);
    visited.add(
      await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        return `${active?.tagName ?? "none"}:${
          active?.getAttribute("data-pf-talento-sheet-close") ??
          active?.textContent?.trim().slice(0, 24) ??
          ""
        }`;
      }),
    );
  }
  // More than one stop stays reachable, so the trap is not one frozen node.
  expect(visited.size).toBeGreaterThan(1);
  for (let step = 10; step < 14; step++) {
    await page.keyboard.press("Shift+Tab");
    await settleInsideSheet(step);
  }

  // Escape closes the dialog and hands focus back to the row control.
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect.poll(() => overflowPx(page)).toBeLessThanOrEqual(1);

  expect(offendingMutations(seen)).toEqual([]);
  expect(offendingTraffic(seen)).toEqual([]);
  expect(await readStorageWrites(page)).toEqual([]);
});

test("mobile stays usable and overflow-clean with an internally scrolling table", async ({ page }) => {
  const seen = trackRequests(page);
  await page.setViewportSize(MOBILE);
  await page.goto(ROUTE);
  await expect(page.locator("[data-pf-talento-workspace]")).toBeVisible();
  await expect(search(page)).toBeVisible();
  await expect(page.locator("[data-pf-talento-filter-toggle]")).toBeVisible();
  expect(await overflowPx(page)).toBeLessThanOrEqual(1);
  // The wide table scrolls inside its own container instead of the page.
  await expect
    .poll(() =>
      page
        .locator("[data-slot='table-container']")
        .evaluate((node) => node.scrollWidth - node.clientWidth),
    )
    .toBeGreaterThan(0);

  expect(offendingMutations(seen)).toEqual([]);
  expect(offendingTraffic(seen)).toEqual([]);
  expect(await readStorageWrites(page)).toEqual([]);
});

test("the summary cards report the whole base and survive filtering and paging", async ({ page }) => {
  const seen = trackRequests(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(ROUTE);
  await expect(page.locator("[data-pf-talento-workspace]")).toBeVisible();

  const summary = page.locator("[data-pf-talento-summary]");
  await expect(summary).toBeVisible();
  await expect(summary.locator("[data-pf-talento-stat]")).toHaveCount(4);

  const stat = (id: string) =>
    page.locator(`[data-pf-talento-stat-value="${id}"]`);
  // Canonical fixture figures, computed from the frozen 32-person base: 32
  // people, 41 applications, 12 immediately available, 6 represented vacancies.
  await expect(stat("people")).toHaveText("32");
  await expect(stat("applications")).toHaveText("41");
  await expect(stat("immediate")).toHaveText("12");
  await expect(stat("vacancies")).toHaveText("6");
  // Counts only: no invented growth or trend copy.
  await expect(summary).not.toContainText(/[+%]|tendencia|al alza|crecimiento/iu);

  // The cards are global: a narrow result set and an empty one move no counter.
  await search(page).fill("gabriela");
  await expect(rows(page)).toHaveCount(1);
  await expect(stat("people")).toHaveText("32");
  await expect(stat("vacancies")).toHaveText("6");

  await search(page).fill("zzz-no-match");
  await expect(rows(page)).toHaveCount(0);
  await expect(stat("applications")).toHaveText("41");

  // Pagination never re-scopes the cards to the current page window either.
  await search(page).fill("");
  await expect(rows(page)).toHaveCount(10);
  await page
    .getByRole("button", { name: "Ir a la página siguiente", exact: true })
    .click();
  await expect(stat("people")).toHaveText("32");
  await expect(stat("immediate")).toHaveText("12");

  expect(offendingMutations(seen)).toEqual([]);
  expect(offendingTraffic(seen)).toEqual([]);
  expect(await readStorageWrites(page)).toEqual([]);
});

test("the table keeps ~70px rows and the detail sheet scrolls its body under a fixed footer", async ({ page }) => {
  const seen = trackRequests(page);
  // A short viewport so the detail body must really scroll.
  await page.setViewportSize({ width: 1440, height: 520 });
  await page.goto(ROUTE);
  await expect(page.locator("[data-pf-talento-workspace]")).toBeVisible();

  // Row density: every rendered data row is about 70px tall.
  const heights = await rowHeights(page);
  expect(heights.length).toBeGreaterThan(0);
  for (const height of heights) {
    expect(height).toBeGreaterThanOrEqual(68);
    expect(height).toBeLessThanOrEqual(72);
  }

  const trigger = page.locator('[data-pf-talento-open="gabriela-soto"]');
  await trigger.click();
  const sheet = page.locator("[data-pf-talento-sheet]");
  await expect(sheet).toBeVisible();
  await expectFloatingInset(page, SHEET_INSET_DESKTOP);

  await expect(sheet.locator("[data-pf-talento-sheet-name]")).toBeFocused();

  // The body is the only scroll container and it carries the cover and the
  // identity too: scrolling moves them away while the footer keeps its
  // viewport position. The tall cover + identity + footer can therefore never
  // pin the panel on a short viewport.
  const body = page.locator("[data-pf-talento-sheet-body]");
  await expect(body).toHaveCount(1);
  const metrics = await body.evaluate((node) => ({
    scrollHeight: node.scrollHeight,
    clientHeight: node.clientHeight,
  }));
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);

  const cover = sheet.locator("[data-pf-talento-sheet-cover]");
  const footer = sheet.locator("[data-slot='sheet-footer']");
  const coverBefore = await cover.boundingBox();
  const footerBefore = await footer.boundingBox();
  expect(coverBefore).not.toBeNull();
  expect(footerBefore).not.toBeNull();

  await body.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect.poll(() => body.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  // The cover scrolls with the body...
  await expect
    .poll(async () => coverBefore!.y - ((await cover.boundingBox())?.y ?? -999))
    .toBeGreaterThan(1);
  // ...while the footer stays fixed.
  await expect
    .poll(async () => Math.abs(((await footer.boundingBox())?.y ?? -999) - footerBefore!.y))
    .toBeLessThanOrEqual(1);

  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(trigger).toBeFocused();

  expect(offendingMutations(seen)).toEqual([]);
  expect(offendingTraffic(seen)).toEqual([]);
  expect(await readStorageWrites(page)).toEqual([]);
});

test("the detail sheet keeps its footer and close usable at a 320px-tall viewport", async ({ page }) => {
  const seen = trackRequests(page);
  const SHORT = { width: 1440, height: 320 } as const;
  await page.setViewportSize(SHORT);
  await page.goto(ROUTE);
  await expect(page.locator("[data-pf-talento-workspace]")).toBeVisible();

  const trigger = page.locator('[data-pf-talento-open="gabriela-soto"]');
  await trigger.click();
  const sheet = page.locator("[data-pf-talento-sheet]");
  await expect(sheet).toBeVisible();
  await expectFloatingInset(page, SHEET_INSET_DESKTOP);
  await expect.poll(() => overflowPx(page)).toBeLessThanOrEqual(1);

  // The panel cannot fit the cover + identity + footer as fixed chrome inside
  // a 288px inner height, so the cover and identity scroll with the body while
  // the footer and both close controls stay reachable.
  const footer = sheet.locator("[data-slot='sheet-footer']");
  const close = page.locator("[data-pf-talento-sheet-close]");
  const nativeClose = page.locator("[data-slot='sheet-close']");
  await expect(footer).toBeVisible();
  await expect(close).toBeVisible();
  await expect(nativeClose).toBeVisible();

  const footerBox = await footer.boundingBox();
  expect(footerBox).not.toBeNull();
  expect(footerBox!.y ?? -1).toBeGreaterThanOrEqual(SHEET_INSET_DESKTOP - 1.5);
  expect((footerBox!.y ?? Number.POSITIVE_INFINITY) + (footerBox!.height ?? 0)).toBeLessThanOrEqual(
    SHORT.height - SHEET_INSET_DESKTOP + 1.5,
  );

  // The body really scrolls, so every section and the history stay reachable.
  const body = sheet.locator("[data-pf-talento-sheet-body]");
  const metrics = await body.evaluate((node) => ({
    scrollHeight: node.scrollHeight,
    clientHeight: node.clientHeight,
  }));
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
  await body.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(page.locator("[data-pf-talento-history-item]").last()).toBeVisible();

  // The footer control still closes the sheet from the same short viewport.
  await close.click();
  await expect(sheet).toBeHidden();

  expect(offendingMutations(seen)).toEqual([]);
  expect(offendingTraffic(seen)).toEqual([]);
  expect(await readStorageWrites(page)).toEqual([]);
});

test.describe("dark color scheme", () => {
  test.use({ colorScheme: "dark" });

  test("renders dark, visible and mutation-free", async ({ page }) => {
    const seen = trackRequests(page);
    await page.setViewportSize(DESKTOP);
    await page.goto(ROUTE);
    await expect(page.locator("html")).toHaveClass(/dark/u);
    await expect(page.locator("[data-pf-talento-workspace]")).toBeVisible();
    expect(await overflowPx(page)).toBeLessThanOrEqual(1);

    expect(offendingMutations(seen)).toEqual([]);
    expect(offendingTraffic(seen)).toEqual([]);
    expect(await readStorageWrites(page)).toEqual([]);
  });

  test("the portalled detail sheet scans axe-clean over dark surfaces", async ({ page }) => {
    const seen = trackRequests(page);
    await page.setViewportSize(DESKTOP);
    await page.goto(ROUTE);
    await expect(page.locator("html")).toHaveClass(/dark/u);

    const trigger = page.locator('[data-pf-talento-open="gabriela-soto"]');
    await trigger.click();
    const sheet = page.locator("[data-pf-talento-sheet]");
    await expect(sheet).toBeVisible();
    await expect(page.locator("[data-pf-talento-sheet-name]")).toHaveText("Gabriela Soto");

    // The dialog is portalled outside the workspace, so it is its own axe root.
    const results = await new AxeBuilder({ page })
      .include("[data-pf-talento-sheet]")
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    const violations = results.violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map(
        (violation) =>
          `${violation.id} -> ${violation.nodes[0]?.target?.join(" ") ?? ""}`,
      );
    expect(violations).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();

    expect(offendingMutations(seen)).toEqual([]);
    expect(offendingTraffic(seen)).toEqual([]);
    expect(await readStorageWrites(page)).toEqual([]);
  });
});

const MATRIX: ReadonlyArray<readonly [string, { width: number; height: number }]> = [
  ["desktop", DESKTOP],
  ["mobile", MOBILE],
];

test("talent route stays visible, overflow-clean and axe-clean at both widths @a11y", async ({ page }) => {
  const seen = trackRequests(page);
  const failures: string[] = [];

  for (const [label, viewport] of MATRIX) {
    const caseLabel = `${ROUTE} @ ${label}`;
    try {
      await page.setViewportSize(viewport);
      await page.goto(ROUTE);
      const headingVisible = await page
        .getByRole("heading", { level: 1, name: "Base de talento", exact: true })
        .isVisible();
      const workspaceVisible = await page.locator("[data-pf-talento-workspace]").isVisible();
      if (!headingVisible || !workspaceVisible) failures.push(`${caseLabel} not visible`);

      const overflow = await overflowPx(page);
      if (overflow > 1) failures.push(`${caseLabel} overflow ${overflow}px`);

      const results = await new AxeBuilder({ page })
        .include("[data-pf-talento-workspace]")
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      for (const violation of results.violations) {
        if (violation.impact === "serious" || violation.impact === "critical") {
          failures.push(`${caseLabel}: ${violation.id} -> ${violation.nodes[0]?.target?.join(" ") ?? ""}`);
        }
      }

      const writes = await readStorageWrites(page);
      if (writes.length > 0) failures.push(`${caseLabel}: ${writes.join(", ")}`);
    } catch (error) {
      failures.push(`${caseLabel}: ${String(error)}`);
    }
  }

  expect.soft(failures).toEqual([]);
  expect.soft(offendingMutations(seen)).toEqual([]);
  expect.soft(offendingTraffic(seen)).toEqual([]);
});

/**
 * The three panel surfaces that only exist in an open state. The filter Sheet
 * and the detail Sheet are portalled to the document body, so scoping a scan to
 * the workspace alone would never see them; each state therefore declares its
 * own axe roots.
 */
const OPEN_PANEL_STATES: ReadonlyArray<{
  readonly label: string;
  readonly open: (page: Page) => Promise<void>;
  readonly guard: string;
  readonly include: readonly string[];
}> = [
  {
    label: "filter sheet",
    open: async (page) => {
      await page.locator("[data-pf-talento-filter-toggle]").click();
    },
    guard: "[data-pf-talento-filters]",
    // The Sheet is portalled to the body outside the workspace, so the dialog
    // subtree is its own scan root.
    include: ["[data-pf-talento-filters]"],
  },
  {
    label: "column visibility menu",
    open: async (page) => {
      await page.locator("[data-pf-talento-columns]").click();
    },
    guard: "[data-pf-talento-columns-menu]",
    include: ["[data-pf-talento-workspace]", "[data-pf-talento-columns-menu]"],
  },
  {
    label: "portalled detail sheet",
    open: async (page) => {
      await page.locator('[data-pf-talento-open="gabriela-soto"]').click();
    },
    guard: "[data-pf-talento-sheet]",
    include: ["[data-pf-talento-sheet]"],
  },
];

test("open filter, column and portalled sheet panels scan axe-clean @a11y", async ({ page }) => {
  const seen = trackRequests(page);
  const failures: string[] = [];
  await page.setViewportSize(DESKTOP);

  for (const state of OPEN_PANEL_STATES) {
    try {
      await page.goto(ROUTE);
      await expect(page.locator("[data-pf-talento-workspace]")).toBeVisible();
      await state.open(page);
      // Guard against a vacuous scan: the panel under test must really be open.
      await expect(page.locator(state.guard)).toBeVisible();

      let builder = new AxeBuilder({ page });
      for (const selector of state.include) builder = builder.include(selector);
      const results = await builder.withTags(["wcag2a", "wcag2aa"]).analyze();
      for (const violation of results.violations) {
        if (violation.impact === "serious" || violation.impact === "critical") {
          failures.push(
            `${state.label}: ${violation.id} -> ${violation.nodes[0]?.target?.join(" ") ?? ""}`,
          );
        }
      }
    } catch (error) {
      failures.push(`${state.label}: ${String(error)}`);
    }
  }

  expect.soft(failures).toEqual([]);
  expect.soft(offendingMutations(seen)).toEqual([]);
  expect.soft(offendingTraffic(seen)).toEqual([]);
  expect.soft(await readStorageWrites(page)).toEqual([]);
});
