import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

// CCP-R7E, rewritten for the embedded sign-in form (A4.7; the inert shell it used
// to assert is gone since A4.3). Marketing → login acceptance on both routes:
// a truthful shell with the real email + password form, axe (WCAG A/AA, tagged
// @a11y for `pnpm test:a11y`), pointer targets, keyboard focus order with a
// visible focus paint, and the load boundaries (no business mutation, no foreign
// read, storage untouched). The flows themselves (sign-in, sign-up, codes,
// recovery, logout, rate limit) live in embedded-auth.spec.ts; the shader proof
// stays in login.spec.ts. Social buttons are off in the e2e stack
// (AUTH_SOCIAL_*=off), so none is rendered here.

const APP_ORIGIN = process.env.PLAYWRIGHT_APP_ORIGIN ?? "http://127.0.0.1:3100";
const DESKTOP = { width: 1280, height: 720 } as const;
const MOBILE = { width: 375, height: 812 } as const;
const PANEL = "[data-login-visual-panel]";
const FRAMEWORK_DIAGNOSTIC = "/__nextjs_original-stack-frames";
// Rendered implementation-status vocabulary stays banned from the shell.
const PROHIBITED_COPY = /vista previa|aún no disponible|no disponible|demo|prototip|prueba|maqueta|local|unavailable/iu;
const SUCCESS_CLAIM = /éxito|correctamente|acceso concedido|sesión iniciada correctamente|bienvenid|has iniciado sesión/iu;
const ROUTES = [
  { path: "/empresa/login", heading: "Ingresa a tu cuenta", menu: "Empresa", reciprocal: "/candidato/login", emailLabel: "Correo corporativo", action: "Registra tu empresa", signUp: "/empresa/registro", forgot: "/empresa/recuperar" },
  { path: "/candidato/login", heading: "Ingresa a tu perfil", menu: "Candidato", reciprocal: "/empresa/login", emailLabel: "Correo", action: "Crea tu perfil", signUp: "/candidato/registro", forgot: "/candidato/recuperar" },
] as const;
type Route = (typeof ROUTES)[number];

async function openHydrated(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(100);
}

type Request = { method: string; url: string };
const track = (page: Page) => {
  const seen: Request[] = [];
  page.on("request", (entry) => seen.push({ method: entry.method(), url: entry.url() }));
  return seen;
};
const isInternal = (url: string) => {
  const { origin, pathname } = new URL(url);
  return origin === APP_ORIGIN && (pathname === FRAMEWORK_DIAGNOSTIC || pathname.startsWith("/_next/"));
};
// Only Next's own exact internal dev paths may use a non-GET.
const mutations = (seen: readonly Request[]) =>
  seen.filter(({ method, url }) => method !== "GET" && !isInternal(url)).map(({ method, url }) => `${method} ${url}`);
// No fixture, API or cross-origin business read; the one allowed API read is the
// NextAuth session check of the sign-in controls (GET /api/auth/session).
const foreignReads = (seen: readonly Request[]) =>
  seen
    .filter(({ url }) => !/^(data|blob|about):/.test(url))
    .filter(({ method, url }) => !(method === "GET" && new URL(url).origin === APP_ORIGIN && new URL(url).pathname === "/api/auth/session"))
    .filter(({ url }) => new URL(url).origin !== APP_ORIGIN || new URL(url).pathname.startsWith("/api"))
    .map(({ url }) => url);
// NextAuth's own cross-tab broadcast (`nextauth.message`: event, trigger and a
// timestamp, written by the session provider's refetch) is framework state, not
// something the shell persists; every other key must stay byte-identical.
const storage = (page: Page) =>
  page.evaluate(() => {
    const entries = (area: Storage) => Object.entries(area).filter(([key]) => key !== "nextauth.message").sort();
    return { local: JSON.stringify(entries(localStorage)), session: JSON.stringify(entries(sessionStorage)) };
  });
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// Raw sub-pixel pointer-target dimension: a sub-threshold target never rounds up.
const minTargetPx = (locator: Locator) =>
  locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return Math.min(box.width, box.height);
  });

type FocusPaint = { focusVisible: boolean; outlineStyle: string; outlineWidth: string; boxShadow: string };
const activeFocusStop = (page: Page): Promise<(FocusPaint & { stop: string | null }) | null> =>
  page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element || element === document.body) return null;
    const computed = getComputedStyle(element);
    return {
      stop: element.getAttribute("data-e2e-stop"),
      focusVisible: element.matches(":focus-visible"),
      outlineStyle: computed.outlineStyle,
      outlineWidth: computed.outlineWidth,
      boxShadow: computed.boxShadow,
    };
  });
/** Visible keyboard focus as either an outline or a non-transparent ring. */
function hasVisibleFocus(paint: FocusPaint): boolean {
  if (paint.outlineStyle !== "none" && Number.parseFloat(paint.outlineWidth || "0") > 0) return true;
  if (paint.boxShadow === "none") return false;
  // Chromium serializes shadow colors as rgb()/rgba(), hex, or oklab/oklch/color().
  const colors = paint.boxShadow.match(/(?:rgba?\([^)]*\))|(?:#[0-9a-fA-F]{3,8})|(?:oklab\([^)]*\))|(?:oklch\([^)]*\))|(?:color\([^)]*\))/g);
  if (!colors) return false;
  return colors.some((color) => {
    if (/^rgba\(0, 0, 0, 0\)$/.test(color)) return false;
    const alpha = color.match(/\/\s*([\d.]+)\s*\)$/) ?? color.match(/,\s*([\d.]+)\s*\)$/);
    if (!alpha) return true;
    return Number.parseFloat(alpha[1]) > 0;
  });
}

const emailField = (page: Page, route: Route) => page.getByLabel(route.emailLabel, { exact: true });
const passwordField = (page: Page) => page.getByLabel("Contraseña", { exact: true });

async function assertTruthfulShell(page: Page, route: Route, mobile: boolean) {
  await expect(page.locator("main")).toHaveCount(1);
  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1).toHaveCount(1);
  await expect(h1).toHaveText(route.heading);
  await expect(page.locator("main")).not.toContainText(PROHIBITED_COPY);
  // One real form: an empty, editable email (username) and password field.
  await expect(page.locator("main form")).toHaveCount(1);
  const email = emailField(page, route);
  const password = passwordField(page);
  await expect(email).toHaveAttribute("type", "email");
  await expect(email).toHaveAttribute("name", "email");
  await expect(email).toHaveAttribute("autocomplete", "username");
  await expect(password).toHaveAttribute("type", "password");
  await expect(password).toHaveAttribute("name", "password");
  await expect(password).toHaveAttribute("autocomplete", "current-password");
  for (const field of [email, password]) {
    await expect(field).toBeEditable();
    await expect(field).toHaveValue("");
  }
  // «Mantener sesión iniciada» was dropped (L18: «Sin casilla»).
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  // The real actions, each at a >=40px pointer target.
  const actions = [
    page.getByRole("button", { name: "Ingresar", exact: true }),
    page.getByRole("button", { name: "Mostrar contraseña", exact: true }),
    page.getByRole("link", { name: "¿Olvidaste tu contraseña?", exact: true }),
    page.getByRole("link", { name: route.action, exact: true }),
    page.getByRole("link", { name: "Ingresa aquí", exact: true }),
  ];
  for (const action of actions) {
    await expect(action).toHaveCount(1);
    await expect(action).toBeEnabled();
    expect(await minTargetPx(action), `${await action.textContent()} must reach the 40px pointer target`).toBeGreaterThanOrEqual(40);
  }
  await expect(page.getByRole("button", { name: /^Continuar con / })).toHaveCount(0);
  // Real anchors only: the root, the other audience, sign-up and recovery.
  await expect(page.getByRole("link", { name: "Ingresa aquí" })).toHaveAttribute("href", route.reciprocal);
  await expect(page.getByRole("link", { name: route.action, exact: true })).toHaveAttribute("href", route.signUp);
  await expect(page.getByRole("link", { name: "¿Olvidaste tu contraseña?" })).toHaveAttribute("href", route.forgot);
  const hrefs = await page.locator("main a").evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute("href")));
  const allowed = new Set<string | null>(["/", route.reciprocal, route.signUp, route.forgot]);
  expect(hrefs.filter((href) => !allowed.has(href))).toEqual([]);
  await expect(page.locator('main [role="status"], main [role="alert"]')).toHaveCount(0);
  if (mobile) {
    await expect(page.locator(PANEL)).toBeHidden();
    await expect(page.locator(`${PANEL} canvas`)).toHaveCount(0);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  } else {
    // L11: the FloatingLines panel stays, decorative and outside the accessibility tree.
    await expect(page.locator(PANEL)).toBeVisible();
    await expect(page.locator(PANEL)).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator(`${PANEL} canvas`)).toHaveCount(1);
  }
}

for (const route of ROUTES) {
  for (const scheme of ["light", "dark"] as const) {
    for (const [label, viewport] of [["desktop", DESKTOP], ["mobile", MOBILE]] as const) {
      test.describe(`${route.path} — ${scheme} ${label}`, () => {
        test.use({ colorScheme: scheme, viewport });
        test("has a truthful sign-in form and no serious/critical axe violations @a11y", async ({ page }) => {
          // axe walks the page while the desktop shader animates; give it room on a dev server.
          test.setTimeout(120_000);
          await openHydrated(page, route.path);
          expect(page.viewportSize()).toEqual(viewport);
          await assertTruthfulShell(page, route, label === "mobile");
          const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
          const severe = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
          expect(severe.map((v) => v.id)).toEqual([]);
        });
      });
    }
  }
}

test.describe("login acceptance boundaries", () => {
  test.use({ viewport: DESKTOP });
  test("emits zero business mutations and no foreign reads on both routes", async ({ page }) => {
    const seen = track(page);
    for (const route of ROUTES) await openHydrated(page, route.path);
    expect(mutations(seen)).toEqual([]);
    expect(foreignReads(seen)).toEqual([]);
  });
  test("keeps storage byte-identical across load and reciprocal navigation", async ({ page }) => {
    await openHydrated(page, ROUTES[0].path);
    const entering = await storage(page);
    expect(entering.local).not.toContain("pf-theme");
    await page.reload();
    expect(await storage(page)).toEqual(entering);
    await page.getByRole("link", { name: "Ingresa aquí" }).click();
    await page.waitForURL(`**${ROUTES[0].reciprocal}`);
    expect(await storage(page)).toEqual(entering);
  });
  for (const route of ROUTES) {
    test(`Enter on an empty form on ${route.path} marks the fields and sends nothing`, async ({ page }) => {
      const seen = track(page);
      await openHydrated(page, route.path);
      const before = await storage(page);
      await emailField(page, route).click();
      await page.keyboard.press("Enter");
      await expect(page.getByText("Escribe tu correo.")).toBeVisible();
      await expect(page.getByText("Escribe tu contraseña.")).toBeVisible();
      await expect(emailField(page, route)).toHaveAttribute("aria-invalid", "true");
      await expect(emailField(page, route)).toBeFocused();
      // Email typed, password still empty: only the password is marked and focused.
      await emailField(page, route).fill("ana@correo.com");
      await page.getByRole("button", { name: "Ingresar", exact: true }).press("Enter");
      await expect(page.getByText("Escribe tu correo.")).toHaveCount(0);
      await expect(passwordField(page)).toBeFocused();
      expect(new URL(page.url()).pathname).toBe(route.path);
      expect(await storage(page)).toEqual(before);
      expect(mutations(seen)).toEqual([]);
      await expect(page.locator('main [role="alert"]')).toHaveCount(0);
      await expect(page.locator("main")).not.toContainText(SUCCESS_CLAIM);
    });
  }
  test("the show / hide toggle reveals the typed password in place, with aria-pressed", async ({ page }) => {
    await openHydrated(page, ROUTES[1].path);
    await passwordField(page).fill("Secreta#1");
    const toggle = page.getByRole("button", { name: "Mostrar contraseña", exact: true });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(passwordField(page)).toHaveAttribute("type", "text");
    await expect(page.getByRole("button", { name: "Ocultar contraseña", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Ocultar contraseña", exact: true }).click();
    await expect(passwordField(page)).toHaveAttribute("type", "password");
    await expect(passwordField(page)).toHaveValue("Secreta#1");
    expect(page.url()).not.toContain("Secreta");
  });
  test("enters each login route from the root marketing menu without mutation", async ({ page }) => {
    const seen = track(page);
    for (const route of ROUTES) {
      await openHydrated(page, "/");
      const entering = await storage(page);
      await page.locator("#nav").getByRole("button", { name: "Ingresar", exact: true }).click();
      const item = page.getByRole("menuitem", { name: route.menu, exact: true });
      await expect(item).toHaveAttribute("href", route.path);
      await item.click();
      await page.waitForURL(`**${route.path}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(route.heading);
      expect(await storage(page)).toEqual(entering);
    }
    expect(mutations(seen)).toEqual([]);
    expect(foreignReads(seen)).toEqual([]);
  });
});

// Keyboard focus: every sign-in control is a real Tab stop, in reading order,
// with a visible outline or ring, reached with genuine keyboard modality.
test.describe("login keyboard focus order", () => {
  test.use({ viewport: DESKTOP });
  for (const route of ROUTES) {
    test(`${route.path} reaches every sign-in control over real Tab, in order, with visible focus @a11y`, async ({ page }) => {
      await openHydrated(page, route.path);
      const expected: [string, Locator][] = [
        [route.emailLabel, emailField(page, route)],
        ["¿Olvidaste tu contraseña?", page.getByRole("link", { name: "¿Olvidaste tu contraseña?", exact: true })],
        ["Contraseña", passwordField(page)],
        ["Mostrar contraseña", page.getByRole("button", { name: "Mostrar contraseña", exact: true })],
        ["Ingresar", page.getByRole("button", { name: "Ingresar", exact: true })],
        [route.action, page.getByRole("link", { name: route.action, exact: true })],
        ["Ingresa aquí", page.getByRole("link", { name: "Ingresa aquí", exact: true })],
      ];
      // Test-only marker attributes give each control a stable identity for the walk.
      for (const [name, locator] of expected) await locator.evaluate((element, stop) => element.setAttribute("data-e2e-stop", stop), name);

      const order: string[] = [];
      for (let index = 0; index < 40 && order.length < expected.length; index += 1) {
        await page.keyboard.press("Tab");
        // The ring/outline transitions in; read the settled focus paint.
        await page.waitForTimeout(220);
        const stop = await activeFocusStop(page);
        if (!stop?.stop || order.includes(stop.stop)) continue;
        order.push(stop.stop);
        expect(stop.focusVisible, `${stop.stop} must receive the keyboard focus modality`).toBe(true);
        expect(hasVisibleFocus(stop), `${stop.stop} must show a visible outline or ring`).toBe(true);
      }
      expect(order, `every sign-in control must be keyboard reachable in reading order on ${route.path}`).toEqual(expected.map(([name]) => name));
    });
  }
});
