import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

// VAF-05 — browser acceptance for the public `/vacantes/[jobId]/postular`
// application flow. Origins come from the harness env/baseURL (never a
// hardcoded port), every flow is read-only, and the candidate login gate is
// asserted by href, never clicked. No screenshots live here: visual capture is
// a separate concern.

// Each test resets its fixture state; a failure must not hide later coverage.
test.describe.configure({ mode: "default" });

const FIXTURE_ORIGIN = (process.env.PLAYWRIGHT_FIXTURE_ORIGIN ?? "http://127.0.0.1:4010").replace(/\/$/u, "");
const MAIN_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
const APPLICATION_PATH = `/vacantes/${MAIN_ID}/postular`;
const DESKTOP = { width: 1440, height: 900 } as const;
const MOBILE = { width: 375, height: 812 } as const;
const HEADER = "[data-pf-application-header]";
/** Rendered implementation-status or no-send/no-save copy is prohibited. */
const PROHIBITED_STATUS_COPY = /demostraci[óo]n|no se env[íi]a|no se guarda/iu;

test.beforeEach(async ({ request }) => {
  await request.get(`${FIXTURE_ORIGIN}/__reset`);
});

// --- read-only request/storage audit, installed before the first `goto` -----
type Captured = { method: string; url: string; identityRead: boolean };
const MUTATIONS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const trackRequests = (page: Page) => {
  const seen: Captured[] = [];
  page.on("request", (entry) => seen.push({
    method: entry.method(), url: entry.url(),
    // The visitor gate invokes the no-argument loadMeAction read via Next's
    // POST transport. Count it explicitly; never exempt arbitrary mutations.
    identityRead: entry.method() === "POST" &&
      new URL(entry.url()).pathname === APPLICATION_PATH &&
      Boolean(entry.headers()["next-action"]) && entry.postData() === "[]",
  }));
  return seen;
};
// Writes accumulate Node-side per page so they survive client-side navigation;
// the binding is installed before the first `goto` and the init script
// forwards to it while preserving the native storage methods.
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
const readStorageWrites = async (page: Page) => {
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  return storageWrites.get(page) ?? [];
};
// Check persisted state too: property-style writes may bypass the intercepted methods.
const storageSnapshot = (page: Page) =>
  page.evaluate(() => {
    const dump = (storage: Storage): Record<string, string> =>
      Object.fromEntries(Array.from({ length: storage.length }, (_, index) => {
        const key = storage.key(index) ?? "";
        return [key, storage.getItem(key) ?? ""] as const;
      }));
    return { local: dump(window.localStorage), session: dump(window.sessionStorage) };
  });
// NextAuth's cross-tab notification is the sole permitted storage payload.
// Exact object keys at both levels reject user/session data, including nested fields.
const expectSessionBroadcast = (value: string) => {
  const message = JSON.parse(value) as Record<string, unknown>;
  expect(Object.keys(message).sort()).toEqual(["data", "event", "timestamp"]);
  expect(message.event).toBe("session");
  expect(message.data).not.toBeNull();
  expect(typeof message.data).toBe("object");
  expect(Object.keys(message.data as object)).toEqual(["trigger"]);
  expect(typeof (message.data as { trigger: unknown }).trigger).toBe("string");
  expect(typeof message.timestamp).toBe("number");
  expect(Number.isFinite(message.timestamp)).toBe(true);
};
const expectClean = async (page: Page, seen: readonly Captured[], identityReads = 0) => {
  // Non-vacuity: the flow must have produced real traffic before judging it.
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.filter(entry => entry.identityRead)).toHaveLength(identityReads);
  expect(seen.filter(({ method, identityRead }) => MUTATIONS.has(method) && !(identityReads > 0 && identityRead)).map(({ method, url }) => `${method} ${url}`)).toEqual([]);
  for (const entry of await readStorageWrites(page)) {
    const allowedWrite = "local|set|nextauth.message|";
    expect(entry.startsWith(allowedWrite), `Unexpected storage write: ${entry}`).toBe(true);
    expectSessionBroadcast(entry.slice(allowedWrite.length));
  }
  const snapshot = await storageSnapshot(page);
  const { ["nextauth.message"]: broadcast, ...otherLocal } = snapshot.local;
  if (broadcast !== undefined) expectSessionBroadcast(broadcast);
  expect({ local: otherLocal, session: snapshot.session }).toEqual({ local: {}, session: {} });
};

const overflowPx = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const heightPx = (locator: Locator) =>
  locator.evaluate((element) => element.getBoundingClientRect().height);
const bodyBackground = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);
// The manual theme mutation the app itself applies, done in-page only: never storage.
// Axe inspects the settled theme, not an intermediate frame of the 200ms color transition.
const setTheme = async (page: Page, dark: boolean) => {
  await page.addStyleTag({ content: "*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important}" });
  await page.evaluate((isDark) => {
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  }, dark);
};
const seriousAxe = (page: Page) =>
  new AxeBuilder({ page })
    .include("body")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze()
    .then((results) => results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => violation.id));

/** The current v2 wizard stops visitors before any candidate-only input. */
async function expectVisitorGate(page: Page) {
  await expect(page.getByRole("heading", { level: 1, name: "Postularme" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Datos", exact: true })).toBeVisible();
  await expect(page.getByText("Sesión requerida", { exact: true })).toBeVisible();
  await expect(page.getByText("Ingresa con tu cuenta de candidato para postularte.", { exact: true })).toBeVisible();
  const login = page.getByRole("button", { name: "Ingresar como candidato", exact: true });
  await expect(login).toBeVisible();
  await expect(login).toBeEnabled();
  expect(await heightPx(login)).toBeGreaterThanOrEqual(40);
  await expect(page.locator('input, textarea, [data-pf-application-step]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Continuar|Enviar postulación/ })).toHaveCount(0);
}

test("visitor detail apply link opens the sign-in gate with shell, metadata and keyboard return", async ({ page, baseURL, request, context }) => {
  // Same detail-only prefetch isolation as vacantes.spec.ts; apply prefetches
  // must continue or the later explicit application navigation can be dropped.
  await context.route("**/*", route =>
    route.request().headers()["next-router-prefetch"] === "1" &&
    /^\/vacantes\/[^/?]+$/u.test(new URL(route.request().url()).pathname)
      ? route.abort() : route.continue(),
  );
  const seen = trackRequests(page);
  await installStorageAudit(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(`/vacantes/${MAIN_ID}`);
  const apply = page.getByRole("link", { name: "Postularme", exact: true });
  await expect(apply).toHaveAttribute("href", APPLICATION_PATH);
  await apply.click();
  await expect(page).toHaveURL(APPLICATION_PATH);
  await expectVisitorGate(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.locator("[data-slot=sidebar-wrapper]")).toHaveCount(1);
  await expect(page.locator("[data-pf-public-navbar], footer")).toHaveCount(0);
  await expect(page.locator(HEADER)).toContainText("Ingeniera Frontend");
  await expect(page.locator(HEADER)).toContainText("Acme");
  await expect(page.locator(HEADER)).not.toContainText(PROHIBITED_STATUS_COPY);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${baseURL}${APPLICATION_PATH}`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/i);
  const breadcrumb = page.locator("main > header").getByRole("navigation", { name: "Ruta de navegación" });
  const back = breadcrumb.getByRole("link", { name: "Detalle de la vacante", exact: true });
  await expect(back).toHaveAttribute("href", `/vacantes/${MAIN_ID}`);
  await expect(breadcrumb.getByText("Postulación", { exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(HEADER).getByRole("navigation")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Volver a la vacante" })).toHaveCount(0);
  await expect.poll(() => request.get(`${FIXTURE_ORIGIN}/__requests`).then(response => response.json())).toEqual([
    // Detail document, apply render, and the identity Server Action's RSC
    // re-render each own one fresh detail read (metadata/page stay deduped).
    `/v2/jobs/${MAIN_ID}`, `/v2/jobs/${MAIN_ID}`, `/v2/jobs/${MAIN_ID}`,
  ]);
  for (let tabs = 0; tabs < 30 && !(await back.evaluate(element => element === document.activeElement)); tabs++) {
    await page.keyboard.press("Tab");
  }
  await expect(back).toBeFocused();
  expect(await back.evaluate(element => {
    const style = getComputedStyle(element);
    return element.matches(":focus-visible") && (style.boxShadow !== "none" || (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0));
  })).toBe(true);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`/vacantes/${MAIN_ID}`);
  await expect(page.getByRole("article")).toBeVisible();
  await expectClean(page, seen, 1);
});

test("responsive/theme matrix: desktop light and mobile dark stay overflow-free, axe-clean and single-h1", async ({ page }) => {
  const seen = trackRequests(page);
  await installStorageAudit(page);
  type CaseResult = { label: string; overflow: number; axe: string[]; h1: number; background: string };
  const results: CaseResult[] = [];

  for (const [label, viewport, dark] of [
    ["desktop-light", DESKTOP, false],
    ["mobile-dark", MOBILE, true],
  ] as const) {
    await page.setViewportSize(viewport);
    await page.goto(APPLICATION_PATH);
    await expectVisitorGate(page);
    await setTheme(page, dark);

    await expect(page.locator("[data-slot=sidebar-wrapper]")).toHaveCount(1);
    await expect(page.locator(HEADER)).toBeVisible();
    await expect(page.locator(HEADER)).toContainText("Ingeniera Frontend");
    await expect(page.locator(HEADER)).toContainText("Acme");
    await expect(page.locator(HEADER)).not.toContainText(PROHIBITED_STATUS_COPY);
    results.push({
      label,
      overflow: await overflowPx(page),
      axe: await seriousAxe(page),
      h1: await page.getByRole("heading", { level: 1 }).count(),
      background: await bodyBackground(page),
    });
  }

  expect(results.map((result) => result.label)).toEqual(["desktop-light", "mobile-dark"]);
  expect(results.filter((result) => !Number.isFinite(result.overflow) || result.overflow > 1).map((result) => `${result.label}:${result.overflow}`)).toEqual([]);
  expect(results.filter((result) => result.axe.length > 0).map((result) => `${result.label}:${result.axe.join(",")}`)).toEqual([]);
  expect(results.map((result) => result.h1)).toEqual([1, 1]);
  // Dark mode really repainted the document background.
  expect(results[0].background).not.toBe(results[1].background);

  await expectClean(page, seen, 2);
});
