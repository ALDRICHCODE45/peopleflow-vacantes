import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

// VAF-05 — browser acceptance for the public `/vacantes/[jobId]/postular`
// application flow. Origins come from the harness env/baseURL (never a
// hardcoded port), every flow is read-only, and the candidate login gate is
// asserted by href, never clicked. No screenshots live here: visual capture is
// a separate concern.

test.describe.configure({ mode: "serial" });

const FIXTURE_ORIGIN = (process.env.PLAYWRIGHT_FIXTURE_ORIGIN ?? "http://127.0.0.1:4011").replace(/\/$/u, "");
const MAIN_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
const APPLICATION_PATH = `/vacantes/${MAIN_ID}/postular`;
const DESKTOP = { width: 1440, height: 900 } as const;
const MOBILE = { width: 375, height: 812 } as const;
const STEP = (name: string) => `[data-pf-application-step="${name}"]`;
const HEADER = "[data-pf-application-header]";
const FORM_HOST = "[data-pf-application-form-host]";
const CANDIDATE_CARD = "[data-pf-application-candidate]";
const FULL_NAME = "#application-full-name";
const EMAIL = "#application-email";
const PHONE = "#application-phone";
const TITLE = "#application-professional-title";
const CITY = "#application-city";
const COUNTRY = "#application-country";
const LETTER = "#application-cover-letter";
const CV_INPUT = "#application-cv-file";
const CV_DROP = "[data-pf-application-cv-drop]";
const CV_SELECTED = "[data-pf-application-cv-selected]";
const CV_SELECTED_NAME = "[data-pf-application-cv-selected-name]";
const STEP_TITLE = "[data-pf-application-step-title]";
const CV_TERM = "CV";
const SOURCE = "#application-source";
const LOGIN_HREF = "/candidato/login";
const PORTRAIT = "/candidate/ximena-barrera.jpg";
/** Shared draft limit: a 2001st code point must block, 2000 must advance. */
const LIMIT = 2000;
const LIMIT_ERROR = /2000|caracteres|l[íi]mite/i;
/** Rendered implementation-status or no-send/no-save copy is prohibited. */
const PROHIBITED_STATUS_COPY = /demostraci[óo]n|no se env[íi]a|no se guarda/iu;

test.beforeEach(async ({ request }) => {
  await request.get(`${FIXTURE_ORIGIN}/__reset`);
});

// --- read-only request/storage audit, installed before the first `goto` -----
type Captured = { method: string; url: string };
const MUTATIONS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const trackRequests = (page: Page) => {
  const seen: Captured[] = [];
  page.on("request", (entry) => seen.push({ method: entry.method(), url: entry.url() }));
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
// The persisted state read from the document itself: an empty snapshot proves
// no key survived even if a property-style write bypassed the intercepted methods.
const storageSnapshot = (page: Page) =>
  page.evaluate(() => {
    const dump = (storage: Storage): Record<string, string> =>
      Object.fromEntries(Array.from({ length: storage.length }, (_, index) => {
        const key = storage.key(index) ?? "";
        return [key, storage.getItem(key) ?? ""] as const;
      }));
    return { local: dump(window.localStorage), session: dump(window.sessionStorage) };
  });
const expectClean = async (page: Page, seen: readonly Captured[]) => {
  // Non-vacuity: the flow must have produced real traffic before judging it.
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.filter(({ method }) => MUTATIONS.has(method)).map(({ method, url }) => `${method} ${url}`)).toEqual([]);
  expect(await readStorageWrites(page)).toEqual([]);
  expect(await storageSnapshot(page)).toEqual({ local: {}, session: {} });
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

/** One review term's value cell, keyed by its definition term. */
const reviewValue = (review: Locator, term: string) =>
  review.locator("dt", { hasText: term }).locator("xpath=following-sibling::dd");

/** Opens the application route and steps through to the application step. */
async function openApplicationStep(page: Page) {
  await page.goto(APPLICATION_PATH);
  await expect(page.getByRole("heading", { level: 1, name: "Postularme" })).toBeVisible();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  const application = page.locator(STEP("application"));
  await expect(application).toBeVisible();
  // A real step change moves focus into the incoming step title.
  await expect(page.locator(STEP_TITLE)).toHaveText("Tu postulación");
  await expect(page.locator(STEP_TITLE)).toBeFocused();
  return application;
}

test("desktop end-to-end: the detail apply link opens the review of a trimmed demo draft", async ({ page, baseURL }) => {
  const seen = trackRequests(page);
  await installStorageAudit(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(`/vacantes/${MAIN_ID}`);

  // The one real apply affordance is a semantic link, not a demo button.
  const apply = page.getByRole("link", { name: "Postularme", exact: true });
  await expect(apply).toHaveAttribute("href", APPLICATION_PATH);
  await apply.click();
  await expect(page).toHaveURL(new RegExp(`${APPLICATION_PATH}$`, "u"));

  // One h1, a noindex self-canonical, the exact vacancy/company identity, and
  // product-facing header copy with no implementation-status disclosure.
  await expect(page.getByRole("heading", { level: 1, name: "Postularme" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${baseURL}${APPLICATION_PATH}`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/i);
  const header = page.locator(HEADER);
  await expect(header).toContainText("Ingeniera Frontend");
  await expect(header).toContainText("Acme");
  await expect(header).not.toContainText(PROHIBITED_STATUS_COPY);

  // Step 1 edits the local candidate data seeded from the frozen profile: the
  // rail card mirrors it live, and no unsupported CV-upload, availability or
  // experience control exists.
  const profile = page.locator(STEP("profile"));
  const candidate = page.locator(CANDIDATE_CARD);
  await expect(candidate).toContainText("Ximena Barrera");
  await expect(candidate).toContainText("Desarrolladora Frontend Senior");
  await expect(candidate).toContainText("ximena.barrera@correo.mx");
  await expect(candidate).toContainText("+52 55 4821 7790");
  await expect(candidate).toContainText("Ciudad de México, México");
  await expect(candidate).toContainText("react");
  await expect(candidate.locator(`img[src="${PORTRAIT}"]`)).toBeVisible();
  await expect(profile).not.toContainText(/años de experiencia|disponibilidad|sube tu cv|curr[íi]culum/i);
  await expect(profile).not.toContainText(PROHIBITED_STATUS_COPY);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);

  const fullName = page.locator(FULL_NAME);
  await expect(fullName).toHaveValue("Ximena Barrera");
  await expect(page.locator(EMAIL)).toHaveValue("ximena.barrera@correo.mx");
  await expect(page.locator(PHONE)).toHaveValue("+52 55 4821 7790");
  await expect(page.locator(TITLE)).toHaveValue("Desarrolladora Frontend Senior");
  await expect(page.locator(CITY)).toHaveValue("Ciudad de México");
  await expect(page.locator(COUNTRY)).toHaveValue("México");

  // Live edit: the rail card repaints from local state, with no submit at all.
  await fullName.fill("  Ana López  ");
  await expect(candidate).toContainText("Ana López");
  // The edited name never relabels the frozen fixture portrait: it stays decorative.
  await expect(candidate.locator(`img[src="${PORTRAIT}"]`)).toHaveAttribute("alt", "");

  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.locator(STEP("application"))).toBeVisible();
  // The transition moved focus into the incoming step title.
  await expect(page.locator(STEP_TITLE)).toHaveText("Tu postulación");
  await expect(page.locator(STEP_TITLE)).toBeFocused();

  // The installed Base UI Select really opens in Chromium and switches source.
  await page.locator(SOURCE).click();
  await page.getByRole("option", { name: "LinkedIn" }).click();
  await expect(page.locator(SOURCE)).toContainText("LinkedIn");
  await page.locator(LETTER).fill("  Hola equipo  ");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();

  // Optional penultimate CV step: the local file lives in page state only.
  const cv = page.locator(STEP("cv"));
  await expect(cv).toBeVisible();
  await expect(page.locator(STEP_TITLE)).toHaveText("Tu CV");
  await expect(page.locator(STEP_TITLE)).toBeFocused();
  await expect(cv).toContainText(/opcional/i);
  await expect(cv).not.toContainText(PROHIBITED_STATUS_COPY);
  await page.locator(CV_INPUT).setInputFiles({
    name: "Mi Cv.PDF",
    mimeType: "application/pdf",
    buffer: Buffer.from("cv"),
  });
  await expect(page.locator(CV_SELECTED)).toContainText("Mi Cv.PDF");
  await expect(page.locator(CV_SELECTED)).toContainText("PDF");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();

  // Review: the normalized source/letter and CV metadata, no fake send, and the real login gate.
  const review = page.locator(STEP("review"));
  await expect(review).toBeVisible();
  await expect(page.locator(STEP_TITLE)).toHaveText("Revisar");
  await expect(page.locator(STEP_TITLE)).toBeFocused();
  await expect(reviewValue(review, "¿Cómo te enteraste?")).toHaveText("LinkedIn");
  await expect(reviewValue(review, "Carta de presentación")).toHaveText("Hola equipo");
  await expect(reviewValue(review, CV_TERM)).toHaveText("Mi Cv.PDF · PDF · 0 KB");
  await expect(reviewValue(review, "Nombre completo")).toHaveText("Ana López");
  await expect(reviewValue(review, "Correo electrónico")).toHaveText("ximena.barrera@correo.mx");
  await expect(reviewValue(review, "Ubicación")).toHaveText("Ciudad de México, México");
  await expect(review.getByRole("button", { name: /enviar/i })).toHaveCount(0);
  await expect(review).not.toContainText(/postulación (?:enviada|recibida)/i);
  await expect(review).not.toContainText(PROHIBITED_STATUS_COPY);
  await expect(review.getByRole("link", { name: /iniciar sesión para enviar/i })).toHaveAttribute("href", LOGIN_HREF);

  // Back preserves the raw, untrimmed inputs, the chosen source and the local CV.
  await page.getByRole("button", { name: "Atrás", exact: true }).click();
  await expect(page.locator(CV_SELECTED)).toContainText("Mi Cv.PDF");
  await expect(page.locator(STEP_TITLE)).toHaveText("Tu CV");
  await expect(page.locator(STEP_TITLE)).toBeFocused();
  await page.getByRole("button", { name: "Atrás", exact: true }).click();
  await expect(page.locator(LETTER)).toHaveValue("  Hola equipo  ");
  await expect(page.locator(SOURCE)).toContainText("LinkedIn");
  await expect(page.locator(STEP_TITLE)).toHaveText("Tu postulación");
  await expect(page.locator(STEP_TITLE)).toBeFocused();
  await page.getByRole("button", { name: "Atrás", exact: true }).click();
  await expect(page.locator(FULL_NAME)).toHaveValue("  Ana López  ");
  await expect(page.locator(STEP_TITLE)).toHaveText("Tus datos");
  await expect(page.locator(STEP_TITLE)).toBeFocused();

  await expectClean(page, seen);
});

test("mobile Unicode boundary: 2001 code points block with an alert, exactly 2000 advance, and used targets clear 40px", async ({ page }) => {
  const seen = trackRequests(page);
  await installStorageAudit(page);
  await page.setViewportSize(MOBILE);
  await page.goto(APPLICATION_PATH);
  const heights: number[] = [];
  const stepOneContinue = page.getByRole("button", { name: "Continuar", exact: true });
  await expect(stepOneContinue).toBeVisible();
  heights.push(await heightPx(stepOneContinue));
  heights.push(await heightPx(page.locator(FULL_NAME)));
  await stepOneContinue.click();

  const application = page.locator(STEP("application"));
  await expect(application).toBeVisible();
  await expect(page.locator(STEP_TITLE)).toHaveText("Tu postulación");
  await expect(page.locator(STEP_TITLE)).toBeFocused();
  const letter = page.locator(LETTER);
  heights.push(await heightPx(letter));
  const stepTwoContinue = page.getByRole("button", { name: "Continuar", exact: true });
  heights.push(await heightPx(stepTwoContinue));

  await letter.fill("😀".repeat(LIMIT + 1));
  await expect(application).toContainText(`${LIMIT + 1} de ${LIMIT}`);
  await stepTwoContinue.click();
  // 2001 code points block: an alert, still step 2, and no horizontal overflow.
  await expect(application.getByRole("alert")).toContainText(LIMIT_ERROR);
  await expect(letter).toBeFocused();
  await expect(letter).toHaveAttribute("aria-invalid", "true");
  expect(await letter.getAttribute("aria-describedby")).toContain("application-cover-letter-error");
  await expect(application).toBeVisible();
  await expect(page.locator(STEP("review"))).toHaveCount(0);
  expect(await overflowPx(page)).toBeLessThanOrEqual(0);

  // Exactly 2000 code points advance to the optional CV step, then to review.
  await letter.fill("😀".repeat(LIMIT));
  await expect(application).toContainText(`${LIMIT} de ${LIMIT}`);
  await stepTwoContinue.click();
  const cv = page.locator(STEP("cv"));
  await expect(cv).toBeVisible();
  await expect(page.locator(STEP_TITLE)).toHaveText("Tu CV");
  await expect(page.locator(STEP_TITLE)).toBeFocused();
  heights.push(await heightPx(page.getByRole("button", { name: "Continuar", exact: true })));
  heights.push(await heightPx(page.getByRole("button", { name: "Elegir archivo", exact: true })));
  await expect(page.locator(CV_INPUT)).toBeHidden();
  await expect(page.getByRole("button", { name: "Elegir archivo", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.locator(STEP("review"))).toBeVisible();
  await expect(page.locator(STEP_TITLE)).toHaveText("Revisar");
  await expect(page.locator(STEP_TITLE)).toBeFocused();
  expect(await overflowPx(page)).toBeLessThanOrEqual(0);

  // Every interactive target exercised by this flow meets the 40px minimum.
  expect(heights).toHaveLength(6);
  expect(heights.filter((height) => !Number.isFinite(height) || height < 40)).toEqual([]);

  await expectClean(page, seen);
});

test("CV step: a long local filename wraps without overflow and a rejected drop keeps the valid file", async ({ page }) => {
  const seen = trackRequests(page);
  await installStorageAudit(page);
  await page.setViewportSize(MOBILE);
  await page.goto(APPLICATION_PATH);
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  const cv = page.locator(STEP("cv"));
  await expect(cv).toBeVisible();
  await expect(page.locator(STEP_TITLE)).toHaveText("Tu CV");
  await expect(page.locator(STEP_TITLE)).toBeFocused();

  const longName = `curriculum-vitae-${"muy-largo-".repeat(8)}final.pdf`;
  await page.locator(CV_INPUT).setInputFiles({
    name: longName,
    mimeType: "application/pdf",
    buffer: Buffer.from("cv"),
  });
  const selectedName = page.locator(CV_SELECTED_NAME);
  await expect(selectedName).toHaveText(longName);
  // The full name is readable: it wraps instead of clipping to one line, so the
  // title never hides overflow (a coupled `min-w-0` parent lets it shrink).
  expect(await selectedName.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
  expect(await overflowPx(page)).toBeLessThanOrEqual(0);
  expect(await seriousAxe(page)).toEqual([]);
  expect(await heightPx(page.getByRole("button", { name: "Elegir archivo", exact: true }))).toBeGreaterThanOrEqual(40);

  // A dropped `.txt` is rejected, the valid file stays, and the error is announced.
  const dataTransfer = await page.evaluateHandle((name) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["x"], name, { type: "text/plain" }));
    return transfer;
  }, "notas.txt");
  await page.locator(CV_DROP).dispatchEvent("drop", { dataTransfer });
  await expect(cv.getByRole("alert")).toContainText("El CV debe estar en formato PDF, DOC o DOCX.");
  await expect(page.locator(CV_SELECTED)).toContainText(longName);
  await expect(page.locator(CV_INPUT)).toHaveAttribute("aria-invalid", "true");

  await expectClean(page, seen);
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
    await openApplicationStep(page);
    await setTheme(page, dark);

    // The rail, its summary, and the form host stay visible behind the step.
    await expect(page.locator("aside").getByRole("heading", { name: "Resumen de la vacante" })).toBeVisible();
    await expect(page.locator(FORM_HOST)).toBeVisible();
    await expect(page.locator(HEADER)).toBeVisible();
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

  await expectClean(page, seen);
});
