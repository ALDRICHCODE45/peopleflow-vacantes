import { expect, test, type APIRequestContext } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

const fixtureUrl = process.env.PLAYWRIGHT_FIXTURE_ORIGIN ?? "http://127.0.0.1:4010";
// Fixture vacancies (tests/fixtures/jobs-server.mjs): main has no optional
// metadata, rich carries full metadata plus a markup-like description, long
// has an uninterrupted title segment and full optionals, and missing answers
// a backend 404. App origin comes from the harness baseURL.
const MAIN_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
const RICH_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d92";
const MISSING_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d99";
const LONG_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d90";
const richRequest = `/jobs/${RICH_ID}`;
const missingRequest = `/jobs/${MISSING_ID}`;
const NOT_FOUND_COPY = "Esta vacante no está disponible";
const XSS_TEXT = "<script>alert('xss')</script>";
// Canonical company profile both enriched demo vacancies resolve to.
const COMPANY_PROFILE_PATH = "/empresas/0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f";
const DISCLOSURE_ID = "proceso-prototipo";
const DEMO_CONTROLS = [
  { name: "Postularme (solo demostración)", minTargetPx: 44, mode: "momentary", described: true, feedback: "Postulación de demostración: no se envió ninguna postulación real." },
  { name: "Guardar vacante (solo demostración)", minTargetPx: 44, mode: "toggle", described: true, feedback: "Guardado de demostración activado: no se guardó nada real." },
  { name: "Copiar enlace (solo demostración)", minTargetPx: 40, mode: "momentary", described: false, feedback: "Copiar enlace es solo una demostración: no se copió nada." },
  { name: "Compartir en redes (solo demostración)", minTargetPx: 40, mode: "momentary", described: false, feedback: "Compartir en redes es solo una demostración: no se compartió nada." },
  { name: "Enviar por correo (solo demostración)", minTargetPx: 40, mode: "momentary", described: false, feedback: "Enviar por correo es solo una demostración: no se envió ningún correo." },
] as const;
const SAVE_ACTIVE_LABEL = "Guardar vacante (marcada solo en esta demostración)";
const SAVE_ACTIVE_FEEDBACK = "Guardado de demostración activado: no se guardó nada real.";
const SAVE_INACTIVE_FEEDBACK = "Guardado de demostración desactivado: no se modificó nada real.";

const fixtureRequests = (request: APIRequestContext) =>
  request.get(`${fixtureUrl}/__requests`).then((r) => r.json());

async function bufferMainDocuments(
  page: Page,
  completedStatuses: number[],
) {
  await page.route("**/vacantes/*", async (route) => {
    if (route.request().resourceType() !== "document")
      return route.continue();
    const upstream = await route.fetch();
    const body = await upstream.body();
    completedStatuses.push(upstream.status());
    await route.fulfill({ response: upstream, body });
  });
}

const backLink = (scope: Page | Locator) =>
  scope.getByRole("link", { name: /volver a vacantes/i });

const robots = (page: Page) => page.locator('meta[name="robots"]');

const articleOf = (page: Page) => page.getByRole("article");

/** One stable data-attribute region of the canonical detail article. */
const detailRegion = (page: Page, name: string) =>
  articleOf(page).locator(`[data-detail-region='${name}']`);

/** Viewport-space edges of one element, rounded to whole pixels. */
const boxOf = (locator: Locator) =>
  locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { top: Math.round(box.top), bottom: Math.round(box.bottom), left: Math.round(box.left), right: Math.round(box.right) };
  });

/** Smallest pointer-target dimension of one element, in CSS pixels. */
const minTargetSizePx = (locator: Locator) =>
  locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    // Raw value: a sub-threshold dimension must never round up to pass.
    return Math.min(box.width, box.height);
  });

/** One sequential-focus stop plus the focus treatment it received. */
type FocusStep = {
  tag: string;
  name: string;
  href: string | null;
  inArticle: boolean;
  disabled: boolean;
  focusVisible: boolean;
  outline: boolean;
  ring: boolean;
};

/** Reads the current focus stop; a real Tab keypress supplies focus-visible. */
const focusStep = (page: Page) =>
  page.evaluate((): FocusStep => {
    const element =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const style = element === null ? null : getComputedStyle(element);
    return {
      tag: element?.tagName ?? "",
      name: (element?.getAttribute("aria-label") ?? element?.textContent ?? "").replace(/\s+/g, " ").trim(),
      href: element instanceof HTMLAnchorElement ? element.getAttribute("href") : null,
      inArticle: element !== null && element.closest("article") !== null,
      disabled: element instanceof HTMLButtonElement ? element.disabled : false,
      focusVisible: element?.matches(":focus-visible") ?? false,
      outline: style !== null && style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0,
      ring: style !== null && style.boxShadow !== "none",
    };
  });

const announcementOf = (control: Locator) =>
  control.locator("xpath=following-sibling::*[1][@role='status']");

async function tabCycle(page: Page, limit = 80): Promise<FocusStep[]> {
  const steps: FocusStep[] = [];
  let anchor = "";
  for (let presses = 0; presses < limit; presses++) {
    await page.keyboard.press("Tab");
    const step = await focusStep(page);
    const identity = `${step.tag}|${step.name}|${step.href ?? ""}`;
    if (presses === 0) anchor = identity;
    else if (identity === anchor) break;
    steps.push(step);
  }
  return steps;
}

async function expectBranded404(page: Page) {
  await expect(page.getByText(NOT_FOUND_COPY)).toBeVisible();
  await expect(backLink(page)).toHaveAttribute("href", "/vacantes");
  await expect(robots(page)).toHaveAttribute("content", /noindex/i);
}

// Returns document scrollWidth - clientWidth; a value > 0 means horizontal overflow.
function documentOverflowPx(page: Page) {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

test.describe.configure({ mode: "serial" });
test.beforeEach(async ({ request }) => {
  await request.get(`${fixtureUrl}/__reset`);
});

test("malformed UUID never reaches the API", async ({ page, request }) => {
  const response = await page.goto("/vacantes/not-a-uuid");
  expect(response?.status()).toBe(404);
  await expectBranded404(page);
  // Zero fixture requests: the malformed identifier is short-circuited.
  await expect.poll(() => fixtureRequests(request)).toEqual([]);
});

test("renders only validated contract data", async ({ page }) => {
  const response = await page.goto(`/vacantes/${MAIN_ID}`);
  expect(response?.status()).toBe(200);
  const article = page.getByRole("article");
  await expect(article).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(
    article.getByRole("heading", { level: 1, name: "Ingeniera Frontend" }),
  ).toBeVisible();
  // The enriched Acme vacancy links the company in the header and repeats it in
  // the rail, so the canonical company link is the unambiguous identity contract.
  await expect(
    article.getByRole("link", { name: "Acme", exact: true }),
  ).toHaveAttribute("href", COMPANY_PROFILE_PATH);
  // The reference stat cards own the wire mode, the wire schedule, and the
  // prototype experience label, so each value is asserted in its own card.
  for (const [key, value] of [
    ["modality", "Remoto"],
    ["schedule", "Tiempo completo"],
    ["experience", "5+ años"],
  ] as const) {
    await expect(article.locator(`[data-detail-stat='${key}'] dd`)).toHaveText(
      value,
    );
  }
  await expect(backLink(article)).toHaveAttribute("href", "/vacantes");
  // Omitted optionals stay omitted: no salary, date, or location copy.
  await expect(article).not.toContainText(/MXN|USD/);
  await expect(article).not.toContainText(/publicada/i);
  await expect(article).not.toContainText("undefined");
});

test("safe description and full metadata", async ({ page, baseURL }) => {
  const response = await page.goto(`/vacantes/${RICH_ID}`);
  expect(response?.status()).toBe(200);
  const article = page.getByRole("article");
  const header = detailRegion(page, "header");
  await expect(article.locator("script")).toHaveCount(0);
  await expect(article.locator("img")).toHaveCount(0);
  await expect(article.getByText(XSS_TEXT)).toBeVisible();
  // Blank lines split paragraphs; a single break stays inside one paragraph.
  // Only the wire description is a content-region paragraph: the article also
  // carries prototype notes and the rail's PeopleFlow verification row.
  const paragraphs = detailRegion(page, "content").getByRole("paragraph");
  await expect(paragraphs).toHaveCount(4);
  await expect(paragraphs.last()).toHaveText(/Línea uno\nLínea dos\./);
  await expect(article.locator("[data-detail-card='salary']")).toContainText(
    /MXN/,
  );
  await expect(
    header.locator("[data-detail-meta='published'] dd"),
  ).toBeVisible();
  // The rail profile context repeats the same city, so the wire location stays
  // scoped to its own header term instead of matching both.
  await expect(header.locator("[data-detail-meta='location'] dd")).toHaveText(
    "Monterrey, Nuevo León",
  );
  // Dynamic title, self-canonical URL, and indexable robots metadata.
  await expect(page).toHaveTitle(/Desarrolladora Go \| PeopleFlow/);
  const canonical = page.locator('link[rel="canonical"]');
  const canonicalHref = `${baseURL}/vacantes/${RICH_ID}`;
  await expect(canonical).toHaveAttribute("href", canonicalHref);
  await expect(robots(page)).toHaveAttribute("content", /index/i);
  await expect(robots(page)).not.toHaveAttribute("content", /noindex/i);
});

test("dedupes metadata/page reads per request", async ({ page, request }) => {
  // One render issues exactly one detail read even though both the metadata
  // generation and the page read need the validated vacancy.
  await page.goto(`/vacantes/${RICH_ID}`);
  await expect.poll(() => fixtureRequests(request)).toEqual([richRequest]);
  // A second request re-reads the API: nothing persistent serves it.
  await request.get(`${fixtureUrl}/__reset`);
  await page.goto(`/vacantes/${RICH_ID}`);
  await expect.poll(() => fixtureRequests(request)).toEqual([richRequest]);
});

test("backend 404: noindex after API read", async ({ page, request }) => {
  const response = await page.goto(`/vacantes/${MISSING_ID}`);
  expect(response?.status()).toBe(404);
  await expectBranded404(page);
  // Unlike a malformed identifier, a valid UUID consults the API exactly once.
  await expect.poll(() => fixtureRequests(request)).toEqual([missingRequest]);
});

test("reflects request-time visibility changes on later detail requests", async ({
  page,
  request,
}) => {
  // The fixture owns the vacancy's public visibility. Every detail load is
  // a separate request-time render: a hidden vacancy answers the backend
  // visibility boundary (a 404), and only a fresh request observes the
  // change back to visible.
  const setVisibility = (visible: boolean) =>
    request.get(`${fixtureUrl}/__visibility?id=${MAIN_ID}&visible=${visible}`);
  const detailRequest = `/jobs/${MAIN_ID}`;

  // Visible→hidden: this render must present the branded not-found state,
  // never a cached article, after exactly one fresh API read.
  await setVisibility(false);
  const hidden = await page.goto(`/vacantes/${MAIN_ID}`);
  expect(hidden?.status()).toBe(404);
  await expectBranded404(page);
  await expect.poll(() => fixtureRequests(request)).toEqual([detailRequest]);

  // Hidden→visible: a later request-time render renders the article
  // again from a fresh validated read.
  await setVisibility(true);
  const visible = await page.goto(`/vacantes/${MAIN_ID}`);
  expect(visible?.status()).toBe(200);
  await expect(
    page
      .getByRole("article")
      .getByRole("heading", { level: 1, name: "Ingeniera Frontend" }),
  ).toBeVisible();
  await expect
    .poll(() => fixtureRequests(request))
    .toEqual([detailRequest, detailRequest]);
});

test("buffers each completed detail response with its final state", async ({
  page,
  request,
}) => {
  const completedStatuses: number[] = [];
  await bufferMainDocuments(page, completedStatuses);

  const success = await page.goto(`/vacantes/${MAIN_ID}`);
  expect(success?.status()).toBe(200);
  expect(completedStatuses).toEqual([200]);
  await expect(
    page
      .getByRole("article")
      .getByRole("heading", { level: 1, name: "Ingeniera Frontend" }),
  ).toBeVisible();

  await request.get(`${fixtureUrl}/__failure?kind=5xx`);
  const failure = await page.goto(`/vacantes/${MAIN_ID}`);
  expect(failure?.status()).toBe(500);
  expect(completedStatuses).toEqual([200, 500]);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "No se pudo cargar la vacante",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /intentar de nuevo/i }),
  ).toBeVisible();

  // The armed failure is persistent by fixture contract: recover before
  // exercising the backend-404 state so it answers its own definitive 404.
  await request.get(`${fixtureUrl}/__recover`);

  const missing = await page.goto(`/vacantes/${MISSING_ID}`);
  expect(missing?.status()).toBe(404);
  expect(completedStatuses).toEqual([200, 500, 404]);
  await expect(
    page.getByRole("heading", { level: 1, name: NOT_FOUND_COPY }),
  ).toBeVisible();
  await expect(backLink(page)).toHaveAttribute("href", "/vacantes");
});

for (const kind of ["5xx", "schema", "timeout"] as const) {
  test(`${kind} failure stays retryable`, async ({ page, request }) => {
    await request.get(`${fixtureUrl}/__failure?kind=${kind}`);
    await page.goto(`/vacantes/${MAIN_ID}`);
    // Retryable failures never masquerade as the branded not-found page.
    await expect(page.getByText(NOT_FOUND_COPY)).toHaveCount(0);
    await expect(
      page.getByText(/intentar de nuevo|no se pudo cargar la vacante/i).first(),
    ).toBeVisible();
    const anyBack = page.getByRole("link", { name: /vacantes/i }).first();
    await expect(anyBack).toBeVisible();
  });
}

test("keyboard Tab+Enter activates the return link", async ({ page }) => {
  await page.goto(`/vacantes/${MAIN_ID}`);
  const link = backLink(page.getByRole("article"));
  for (
    let presses = 0;
    presses < 20 &&
    !(await link.evaluate((el) => el === document.activeElement));
    presses++
  ) {
    await page.keyboard.press("Tab");
  }
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/vacantes$/);
});

for (const [label, viewport] of [
  ["narrow", { width: 375, height: 812 }],
  ["wide", { width: 1280, height: 720 }],
] as const) {
  test(`long detail content wraps at ${label} width`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(`/vacantes/${LONG_ID}`);
    const article = page.getByRole("article");
    await expect(article).toBeVisible();
    expect(await documentOverflowPx(page)).toBeLessThanOrEqual(0);
    await expect([await article.getByRole("button").count(), await article.getByRole("status").count()]).toEqual([0, 0]);
  });
}

test("detail preserves preset typography, tokens, radius, and bounded UI", async ({
  page,
}) => {
  await page.goto(`/vacantes/${MAIN_ID}`);
  const article = articleOf(page);
  const evidence = await article.evaluate((element) => {
    const probe = document.createElement("span");
    document.body.appendChild(probe);
    const resolveColor = (token: string) => {
      probe.style.color = `var(${token})`;
      return getComputedStyle(probe).color;
    };
    const heading = element.querySelector("h1")!;
    // The wire description is the content region's own paragraph; the
    // article's first paragraph is instead the prototype disclosure note.
    const description = element.querySelector(
      "[data-detail-region='content'] p",
    )!;
    const statLabel = element.querySelector(
      "[data-detail-region='stats'] dt",
    )!;
    const result = {
      bodyFont: getComputedStyle(document.body).fontFamily,
      headingFont: getComputedStyle(heading).fontFamily,
      headingColor: getComputedStyle(heading).color,
      foreground: resolveColor("--foreground"),
      statLabelColor: getComputedStyle(statLabel).color,
      radius: getComputedStyle(document.documentElement)
        .getPropertyValue("--radius")
        .trim(),
      inlineStyles: element.querySelectorAll("[style]").length,
      descriptionColor: getComputedStyle(description).color,
      mutedForeground: resolveColor("--muted-foreground"),
    };
    probe.remove();
    return result;
  });

  expect(evidence.bodyFont).toMatch(/Inter/);
  // CCP-05 loaded the brand display face globally: headings are Clash Display.
  expect(evidence.headingFont).toMatch(/Clash Display/);
  expect(evidence.headingColor).toBe(evidence.foreground);
  expect(evidence.statLabelColor).toBe(evidence.mutedForeground);
  expect(evidence.descriptionColor).toBe(evidence.mutedForeground);
  expect(evidence.radius).toMatch(/^(?:0?\.)625rem$/);
  expect(evidence.inlineStyles).toBe(0);
});

test("detail error boundary promotes its heading to the single h1", async ({
  page,
  request,
}) => {
  await request.get(`${fixtureUrl}/__failure?kind=5xx`);
  await page.goto(`/vacantes/${MAIN_ID}`);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "No se pudo cargar la vacante",
    }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: /intentar de nuevo/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /vacantes/i }).first(),
  ).toHaveAttribute("href", "/vacantes");
  await expect(page.getByText(NOT_FOUND_COPY)).toHaveCount(0);
});

test("detail not-found boundary promotes its heading to the single h1", async ({
  page,
}) => {
  const response = await page.goto(`/vacantes/${MISSING_ID}`);
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { level: 1, name: NOT_FOUND_COPY }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(backLink(page)).toHaveAttribute("href", "/vacantes");
});

// CCP-R4C bounded contracts: every assertion below is scoped to a semantic
// region, role, or stable data attribute of the enriched RICH detail fixture.

test("rich detail rail stays sticky beside content and stacks statically below lg", async ({
  page,
}) => {
  const geometry = async () => {
    const [content, rail, style] = await Promise.all([
      boxOf(detailRegion(page, "content")),
      boxOf(detailRegion(page, "rail")),
      detailRegion(page, "rail").evaluate((element) => {
        const computed = getComputedStyle(element);
        return { position: computed.position, top: computed.top };
      }),
    ]);
    return { content, rail, style, overflow: await documentOverflowPx(page) };
  };

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/vacantes/${RICH_ID}`);
  const desktop = await geometry();
  test.info().annotations.push({ type: "detail geometry @1440", description: JSON.stringify(desktop) });
  // `lg:top-24` is 96px: the rail sits beside the content from the same row top.
  expect([desktop.style, desktop.rail.left >= desktop.content.right, Math.abs(desktop.rail.top - desktop.content.top) <= 1, desktop.overflow]).toEqual([{ position: "sticky", top: "96px" }, true, true, 0]);
  // Scroll to the rail's own document position: it must pin at its 96px offset.
  const railTop = await detailRegion(page, "rail").evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
  await page.evaluate((top) => window.scrollTo(0, top), railTop);
  await expect.poll(async () => (await boxOf(detailRegion(page, "rail"))).top).toBe(96);
  await page.evaluate(() => window.scrollTo(0, 0));

  await page.setViewportSize({ width: 375, height: 812 });
  const mobile = await geometry();
  test.info().annotations.push({ type: "detail geometry @375", description: JSON.stringify(mobile) });
  // Below lg the rail returns to normal flow: static, stacked, same left edge.
  expect([mobile.style, mobile.rail.top >= mobile.content.bottom, Math.abs(mobile.rail.left - mobile.content.left) <= 1, mobile.overflow]).toEqual([{ position: "static", top: "auto" }, true, true, 0]);
});

test("rich detail keeps the complete safe description and a separately scoped verification claim", async ({
  page,
}) => {
  await page.goto(`/vacantes/${RICH_ID}`);
  const content = detailRegion(page, "content");
  const rail = detailRegion(page, "rail");
  const paragraphs = content.getByRole("paragraph");
  // Exact ordered proof of the complete fixture description, in four parts.
  await expect(paragraphs).toHaveText([
    "Primer párrafo de la vacante.",
    XSS_TEXT,
    "Segundo párrafo con <img src=x onerror=alert(1)> incrustado.",
    "Línea uno\nLínea dos.",
  ]);
  // Markup-like description text stays literal characters, never elements.
  await expect(content.getByText(XSS_TEXT)).toBeVisible();
  await expect(
    content.getByText("Segundo párrafo con <img src=x onerror=alert(1)> incrustado."),
  ).toBeVisible();
  await expect(
    content.locator("script, img, iframe, object, embed, b, em"),
  ).toHaveCount(0);
  // The PeopleFlow verification row is a disclosed prototype rail claim, so it
  // never leaks into the wire description region.
  await expect(rail.getByText("Verificada por PeopleFlow")).toBeVisible();
  await expect(content.getByText("Verificada por PeopleFlow")).toHaveCount(0);
});

test("rich detail exposes exactly five named enabled demonstration controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/vacantes/${RICH_ID}`);
  const article = articleOf(page);
  await expect(article.getByRole("button")).toHaveCount(DEMO_CONTROLS.length);
  await expect(article.locator(`#${DISCLOSURE_ID}`)).toHaveCount(1);
  for (const { name, minTargetPx, mode, described } of DEMO_CONTROLS) {
    const button = article.getByRole("button", { name });
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();
    // A demonstration affordance is never a submit target.
    await expect(button).toHaveAttribute("type", "button");
    await expect(button).toHaveAttribute("title", name);
    expect(await minTargetSizePx(button)).toBeGreaterThanOrEqual(minTargetPx);
    expect(await button.getAttribute("aria-describedby")).toBe(described ? DISCLOSURE_ID : null);
    if (mode === "toggle") {
      await expect(button).toHaveAttribute("aria-pressed", "false");
    } else {
      expect(await button.getAttribute("aria-pressed")).toBeNull();
    }
  }
  // The breadcrumb return link keeps its own 40px target.
  expect(await minTargetSizePx(article.getByRole("link", { name: "Volver a vacantes" }))).toBeGreaterThanOrEqual(40);
});

test("rich detail keeps the three links and five controls keyboard reachable in document order", async ({
  page,
}) => {
  await page.goto(`/vacantes/${RICH_ID}`);
  const article = articleOf(page);
  await expect(article.getByRole("link")).toHaveCount(3);

  // One full Tab cycle, discovered from the first stop instead of a fixed count.
  const cycle = await tabCycle(page);
  const articleSteps = cycle.filter((step) => step.inArticle && (step.tag === "A" || step.tag === "BUTTON"));

  expect(articleSteps.map((step) => [step.tag, step.name, step.href])).toEqual([
    ["A", "Volver a vacantes", "/vacantes"],
    ["A", "Acme", COMPANY_PROFILE_PATH],
    ["BUTTON", "Postularme (solo demostración)", null],
    ["BUTTON", "Guardar vacante (solo demostración)", null],
    ["A", "Conoce a Acme", COMPANY_PROFILE_PATH],
    ["BUTTON", "Copiar enlace (solo demostración)", null],
    ["BUTTON", "Compartir en redes (solo demostración)", null],
    ["BUTTON", "Enviar por correo (solo demostración)", null],
  ]);
  expect(articleSteps.every((step) => step.focusVisible && (step.outline || step.ring))).toBe(true);
  // No demonstration control is disabled, so none is dropped from sequential focus.
  expect(articleSteps.filter((step) => step.disabled)).toEqual([]);
});

test("rich detail announces truthful demonstration feedback that replaces and clears itself", async ({
  page,
}) => {
  await page.goto(`/vacantes/${RICH_ID}`);
  const article = articleOf(page);
  const apply = article.getByRole("button", { name: "Postularme (solo demostración)" });
  const applyFeedback = "Postulación de demostración: no se envió ninguna postulación real.";

  // A momentary action confirms honestly and is never pressed.
  await apply.click();
  await expect(announcementOf(apply)).toHaveText(applyFeedback);
  expect(await apply.getAttribute("aria-pressed")).toBeNull();

  await announcementOf(apply).locator("span").evaluate((node) => node.setAttribute("data-announcement-probe", "fresh"));
  await apply.click();
  await expect(announcementOf(apply)).toHaveText(applyFeedback);
  await expect(announcementOf(apply).locator("[data-announcement-probe]")).toHaveCount(0);
  // The confirmation clears on its own timer, awaited by polling, not a sleep.
  await expect(announcementOf(apply)).toBeEmpty({ timeout: 6000 });

  // The save toggle round-trips by keyboard and mouse.
  const save = article.getByRole("button", { name: "Guardar vacante (solo demostración)", exact: true });
  const savePressed = article.getByRole("button", { name: SAVE_ACTIVE_LABEL, exact: true });
  await expect(save).toHaveAttribute("aria-pressed", "false");
  await save.focus();
  await page.keyboard.press("Space");
  await expect(savePressed).toHaveAttribute("aria-pressed", "true");
  await expect(announcementOf(savePressed)).toHaveText(SAVE_ACTIVE_FEEDBACK);
  await savePressed.click();
  await expect(save).toHaveAttribute("aria-pressed", "false");
  await expect(announcementOf(save)).toHaveText(SAVE_INACTIVE_FEEDBACK);
});

test("rich detail keeps canonical company links, indexable metadata, and an unbroken heading outline", async ({
  page,
  baseURL,
}) => {
  await page.goto(`/vacantes/${RICH_ID}`);
  const article = articleOf(page);
  // Both company affordances are opt-in and point at the canonical profile.
  await expect(
    article.getByRole("link", { name: "Acme", exact: true }),
  ).toHaveAttribute("href", COMPANY_PROFILE_PATH);
  await expect(
    article.getByRole("link", { name: "Conoce a Acme" }),
  ).toHaveAttribute("href", COMPANY_PROFILE_PATH);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    `${baseURL}/vacantes/${RICH_ID}`,
  );
  await expect(robots(page)).toHaveAttribute("content", /index/i);
  await expect(robots(page)).not.toHaveAttribute("content", /noindex/i);

  // One h1 leads the document and no level is ever skipped downwards.
  const levels = await article.locator("h1, h2, h3, h4, h5, h6").evaluateAll((nodes) => nodes.map((node) => Number(node.tagName.slice(1))));
  expect(levels[0]).toBe(1);
  expect(levels.filter((level) => level === 1)).toHaveLength(1);
  levels.forEach((level, index) => {
    if (index > 0) expect(level - levels[index - 1]).toBeLessThanOrEqual(1);
  });
});

test("rich detail registers zero non-GET business requests, storage writes, or share calls", async ({ page }) => {
  const nonGet: string[] = [];
  page.on("request", (entry) => {
    // Only the framework's own development diagnostics are exempt.
    const diagnostics =
      entry.url().includes("/_next/") || entry.url().includes("__nextjs");
    if (["POST", "PUT", "PATCH", "DELETE"].includes(entry.method()) && !diagnostics) {
      nonGet.push(`${entry.method()} ${entry.url()}`);
    }
  });
  // The clipboard and Web Share APIs are instrumented before the app loads.
  await page.addInitScript(() => {
    const calls: string[] = [];
    (window as unknown as { __prototypeShareCalls: string[] }).__prototypeShareCalls = calls;
    const record = (api: string) => { calls.push(api); return Promise.resolve(); };
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (clipboard !== undefined) {
      clipboard.writeText = () => record("clipboard.writeText");
      clipboard.write = () => record("clipboard.write");
    }
    navigator.share = () => record("share");
  });

  await page.goto(`/vacantes/${RICH_ID}`);
  const article = articleOf(page);
  await expect(
    article.getByRole("heading", { level: 1, name: "Desarrolladora Go" }),
  ).toBeVisible();
  const storageBefore = await page.evaluate(() =>
    JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
  );

  for (const { name, mode, feedback } of DEMO_CONTROLS) {
    const control = article.getByRole("button", { name });
    await control.click();
    // The toggle keeps its pressed identity after its accessible name flips.
    const announcement = mode === "toggle"
      ? announcementOf(article.getByRole("button", { pressed: true }))
      : announcementOf(control);
    await expect(announcement).toHaveText(feedback);
  }
  await page.waitForTimeout(300);
  expect(nonGet).toEqual([]);
  expect(
    await page.evaluate(
      () => (window as unknown as { __prototypeShareCalls: string[] }).__prototypeShareCalls,
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(() =>
      JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
    ),
  ).toBe(storageBefore);
});
