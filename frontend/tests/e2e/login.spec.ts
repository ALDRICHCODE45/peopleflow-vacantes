import { expect, test, type Page } from "@playwright/test";

// CCP-R7D2C — real-browser contract for the login FloatingLines leaf. Every visual
// assertion reads the SHADER drawing buffer (`shaderSample`), never the panel's
// static fallback tint, and requires lit pixels first: no cell can pass on the
// fallback alone. Shell truthfulness/axe/keyboard/mutation corpus stay with R7E.
// Reuses the live preview server (PLAYWRIGHT_APP_ORIGIN, default :3100) and never
// clicks a disabled auth action.

const ROUTES = { employer: "/empresa/login", candidate: "/candidato/login" } as const;
const HEADINGS = { employer: "Ingresa a tu cuenta", candidate: "Ingresa a tu perfil" } as const;
const DISCLOSURE = "Vista previa: acceso aún no disponible.";
const DESKTOP = { width: 1280, height: 720 };
const MOBILE = { width: 375, height: 812 };
const FIXTURE_ORIGIN = process.env.JOBS_FIXTURE_ORIGIN ?? "http://127.0.0.1:4010";
const PANEL = "[data-login-visual-panel]";
const HOST = "[data-floating-lines-host]";
const CANVAS = `${HOST} canvas`;

type Variant = keyof typeof ROUTES;
type Rgb = { r: number; g: number; b: number };
type Sample = { r: number; g: number; b: number; lit: number; hash: number; inverted: boolean; visible: Rgb };
const distance = (a: Rgb, b: Rgb) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);

/** Collects every runtime error the browser reports for the rest of the test. */
function trackRuntimeErrors(page: Page) {
  const errors = { uncaught: [] as string[], consoleErrors: [] as string[] };
  page.on("pageerror", (error) => errors.uncaught.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.consoleErrors.push(message.text());
  });
  return errors;
}

/** Loads a login route and waits for the exact shell plus the leaf's state. */
async function openLogin(page: Page, variant: Variant, state: string) {
  const response = await page.goto(ROUTES[variant]);
  expect(response?.status(), `${ROUTES[variant]} must exist`).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: HEADINGS[variant], exact: true }),
  ).toBeVisible();
  await expect(page.getByText(DISCLOSURE)).toBeVisible();
  await expect(page.locator(PANEL)).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator(HOST)).toHaveCount(1);
  await expect(page.locator(HOST)).toHaveAttribute("data-floating-lines-state", state);
}

/** The app's own persisted theme mechanism: `pf-theme` + the pre-paint bootstrap. */
async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((next) => window.localStorage.setItem("pf-theme", next), theme);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator(HOST)).toHaveAttribute(
    "data-floating-lines-state",
    /^(ready-animated|ready-static)$/,
  );
}

/**
 * Mean RGB, lit fraction and frame signature read straight from the shader's
 * drawing buffer, which only survives inside a frame. An optional theme applies
 * the same document mutation the persisted control applies; doing it inside that
 * frame is what makes a reduced-motion static redraw observable.
 *
 * The buffer is sampled BEFORE CSS compositing, so `r/g/b` and `lit` are the raw
 * shader bytes (light therefore arrives as complement strokes over black). The
 * `inverted` flag and `visible` triple apply the host's own computed `invert(1)`
 * so visual assertions measure what the user actually sees after `multiply`,
 * while `lit` keeps proving the raw shader really drew nonblack line pixels.
 */
async function shaderSample(page: Page, theme?: "light" | "dark"): Promise<Sample> {
  return page.evaluate(async (next) => {
    const host = document.querySelector("[data-floating-lines-host]") as HTMLElement | null;
    const canvas = host?.querySelector("canvas") as HTMLCanvasElement | null;
    if (!canvas) throw new Error("no shader canvas mounted");
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGL2RenderingContext;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(async () => {
        if (next) {
          const root = document.documentElement;
          root.classList.toggle("dark", next === "dark");
          root.setAttribute("data-theme", next);
          await null; // one microtask turn lets the leaf redraw its static frame
        }
        resolve();
      });
    });
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let r = 0;
    let g = 0;
    let b = 0;
    let lit = 0;
    let samples = 0;
    // FNV-1a over the same stride: a frame signature proves real movement.
    let hash = 2166136261;
    for (let index = 0; index < pixels.length; index += 64) {
      r += pixels[index]!;
      g += pixels[index + 1]!;
      b += pixels[index + 2]!;
      if (pixels[index]! + pixels[index + 1]! + pixels[index + 2]! > 12) lit += 1;
      samples += 1;
      hash = ((hash ^ pixels[index]!) * 16777619) >>> 0;
    }
    const mean = { r: r / samples, g: g / samples, b: b / samples };
    const inverted = !!host && getComputedStyle(host).filter.includes("invert(1)");
    const visible = inverted ? { r: 255 - mean.r, g: 255 - mean.g, b: 255 - mean.b } : mean;
    return { ...mean, lit: lit / samples, hash, inverted, visible };
  }, theme ?? null);
}

/** Fails loudly if the shader buffer is empty, so tint-only panels cannot pass. */async function litSample(page: Page, theme?: "light" | "dark"): Promise<Sample> {
  const sample = await shaderSample(page, theme);
  expect(sample.lit, `shader buffer must contain real lit pixels: ${JSON.stringify(sample)}`).toBeGreaterThan(0);
  return sample;
}

test.describe("login FloatingLines WebGL animation", () => {
  test.use({ viewport: DESKTOP });

  test("mounts one healthy animated canvas per route and advances real frames", async ({ page }) => {
    for (const variant of ["employer", "candidate"] as const) {
      const errors = trackRuntimeErrors(page);
      const mutations: string[] = [];
      page.on("request", (entry) => {
        if (entry.method() !== "GET" || entry.url().startsWith(FIXTURE_ORIGIN)) {
          mutations.push(`${entry.method()} ${entry.url()}`);
        }
      });

      await openLogin(page, variant, "ready-animated");
      await expect(page.locator(CANVAS)).toHaveCount(1);
      await expect(page.locator("canvas")).toHaveCount(1); // exactly one in the document

      const gl = await page.evaluate(() => {
        const host = document.querySelector("[data-floating-lines-host]");
        const canvas = host?.querySelector("canvas") as HTMLCanvasElement | null;
        if (!canvas) return null;
        const context = (canvas.getContext("webgl2") ??
          canvas.getContext("webgl")) as WebGL2RenderingContext | null;
        if (!context) return null;
        return {
          error: context.getError(),
          bufferWidth: context.drawingBufferWidth,
          bufferHeight: context.drawingBufferHeight,
          hostWidth: (host as HTMLElement).clientWidth,
          cappedDpr: Math.min(window.devicePixelRatio || 1, 2),
        };
      });
      expect(gl, `${variant}: a real WebGL context must exist`).not.toBeNull();
      expect(gl!.error, `${variant}: gl.getError() must report NO_ERROR`).toBe(0);
      expect(gl!.bufferWidth).toBeGreaterThan(0);
      expect(gl!.bufferHeight).toBeGreaterThan(0);
      expect(
        Math.abs(gl!.bufferWidth - Math.round(gl!.hostWidth * gl!.cappedDpr)),
        `${variant}: buffer ${gl!.bufferWidth}px for host ${gl!.hostWidth}px`,
      ).toBeLessThanOrEqual(1);
      // The program linked and renders: real content, then real movement.
      const firstFrame = await litSample(page);
      await page.waitForTimeout(700);
      const laterFrame = await litSample(page);
      expect(
        laterFrame.hash,
        `${variant}: the animation must advance between frames`,
      ).not.toBe(firstFrame.hash);

      expect(errors.uncaught, `${variant}: no uncaught page error`).toEqual([]);
      expect(errors.consoleErrors, `${variant}: no console error`).toEqual([]);
      expect(mutations, `${variant}: the animation must not fetch or mutate`).toEqual([]);
    }
  });

  test("renders visibly divergent candidate/employer shader palettes", async ({ page }) => {
    await openLogin(page, "employer", "ready-animated");
    await setTheme(page, "dark");
    const employer = await litSample(page);
    await openLogin(page, "candidate", "ready-animated");
    const candidate = await litSample(page);

    // Candidate starts at cyan #22d3ee, employer at violet #9336ea: the candidate
    // buffer is greener and the employer buffer clearly redder.
    expect(
      candidate.visible.g - employer.visible.g,
      `candidate green ${candidate.visible.g.toFixed(2)} vs employer ${employer.visible.g.toFixed(2)}`,
    ).toBeGreaterThan(1);
    expect(
      employer.visible.r - candidate.visible.r,
      `employer red ${employer.visible.r.toFixed(2)} vs candidate ${candidate.visible.r.toFixed(2)}`,
    ).toBeGreaterThan(1);
  });

  test("flips blend mode and shader pixels with the real theme control", async ({ page }) => {
    await openLogin(page, "employer", "ready-animated");
    const host = page.locator(HOST);
    const html = page.locator("html");
    await setTheme(page, "dark");
    await expect(host).toHaveCSS("mix-blend-mode", "screen");
    await expect(host).toHaveCSS("filter", "none");
    const dark = await litSample(page);
    // The shell's own persisted control flips the theme in place: no reload, no
    // re-mount, one canvas, visibly redrawn shader pixels.
    await page.getByRole("button", { name: /cambiar tema/i }).click();
    await expect(html).toHaveAttribute("data-theme", "light");
    await expect(host).toHaveCSS("mix-blend-mode", "multiply");
    await expect(host).toHaveCSS("filter", "invert(1)");
    await expect(host).toHaveAttribute("data-floating-lines-state", "ready-animated");
    await expect(page.locator("canvas")).toHaveCount(1);
    const light = await litSample(page);
    expect(distance(dark.visible, light.visible), `visible pixels dark ${dark.visible.r.toFixed(2)}/${dark.visible.g.toFixed(2)}/${dark.visible.b.toFixed(2)} light ${light.visible.r.toFixed(2)}/${light.visible.g.toFixed(2)}/${light.visible.b.toFixed(2)}`).toBeGreaterThan(1);
  });

  test("keeps both light-mode panels predominantly light with real line signal", async ({ page }) => {
    const errors = trackRuntimeErrors(page);
    const light: Partial<Record<Variant, Sample>> = {};
    for (const variant of ["employer", "candidate"] as const) {
      await openLogin(page, variant, "ready-animated");
      await setTheme(page, "light");
      const host = page.locator(HOST);
      await expect(host).toHaveCSS("mix-blend-mode", "multiply");
      await expect(host).toHaveCSS("filter", "invert(1)");
      // Warm --base fallback: multiply of the inverted white framebuffer is neutral.
      await expect(page.locator(PANEL)).toHaveCSS("background-color", "rgb(247, 245, 251)");
      await expect(page.locator(CANVAS)).toHaveCount(1);
      await expect(page.locator("canvas")).toHaveCount(1);
      // `litSample` still reads RAW bytes: the shader genuinely drew line pixels.
      const sample = await litSample(page);
      expect(sample.inverted, `${variant}: the light host must invert before multiply`).toBe(true);
      // Transformed framebuffer is predominantly light, never opaque black.
      // Calibrated from measured values, not permissive guesses: the per-channel
      // floor sits ~15 below the measured light minimum (employer green 164.88)
      // and the mean floor sits below the measured animated band (candidate
      // 189.60-190.22, employer 195.89), so a near-white panel passes while an
      // opaque-black regression (mean ~= 0) cannot.
      expect(sample.visible.r, `${variant}: transformed red ${sample.visible.r.toFixed(2)}`).toBeGreaterThan(150);
      expect(sample.visible.g, `${variant}: transformed green ${sample.visible.g.toFixed(2)}`).toBeGreaterThan(150);
      expect(sample.visible.b, `${variant}: transformed blue ${sample.visible.b.toFixed(2)}`).toBeGreaterThan(150);
      const mean = (sample.visible.r + sample.visible.g + sample.visible.b) / 3;
      expect(mean, `${variant}: transformed mean RGB ${mean.toFixed(2)}`).toBeGreaterThan(185);
      light[variant] = sample;
    }
    // Distinct variant identities survive the light transform.
    expect(
      light.candidate!.visible.g - light.employer!.visible.g,
      `light candidate green ${light.candidate!.visible.g.toFixed(2)} vs employer ${light.employer!.visible.g.toFixed(2)}`,
    ).toBeGreaterThan(1);
    expect(
      light.employer!.visible.r - light.candidate!.visible.r,
      `light employer red ${light.employer!.visible.r.toFixed(2)} vs candidate ${light.candidate!.visible.r.toFixed(2)}`,
    ).toBeGreaterThan(1);
    expect(errors.uncaught).toEqual([]);
    expect(errors.consoleErrors).toEqual([]);
  });

  test("replaces the animation cleanly on reciprocal navigation", async ({ page }) => {
    const errors = trackRuntimeErrors(page);
    await openLogin(page, "employer", "ready-animated");
    await page.getByRole("link", { name: /ingresa aquí/i }).click();
    await page.waitForURL(`**${ROUTES.candidate}`);
    await expect(
      page.getByRole("heading", { level: 1, name: HEADINGS.candidate, exact: true }),
    ).toBeVisible();
    // One fresh host and canvas after the route swap: the employer instance and
    // its loop are gone, and the candidate shader really renders.
    await expect(page.locator(HOST)).toHaveCount(1);
    await expect(page.locator(HOST)).toHaveAttribute("data-floating-lines-state", "ready-animated");
    await expect(page.locator("canvas")).toHaveCount(1);
    await litSample(page);
    expect(errors.uncaught).toEqual([]);
    expect(errors.consoleErrors).toEqual([]);
  });
});

test.describe("login FloatingLines mobile gating", () => {
  test.use({ viewport: MOBILE });

  test("never initializes WebGL at 375px and keeps the shell usable", async ({ page }) => {
    const errors = trackRuntimeErrors(page);
    await openLogin(page, "candidate", "hidden");
    await expect(page.locator(PANEL)).toBeHidden();
    await expect(page.locator(HOST)).toBeHidden();
    await expect(page.locator(CANVAS)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ingresar" })).toBeDisabled();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "the login shell must not overflow at 375px").toBeLessThanOrEqual(0);
    expect(errors.uncaught).toEqual([]);
    expect(errors.consoleErrors).toEqual([]);
  });
});

test.describe("login FloatingLines reduced motion", () => {
  // Playwright 1.62 context emulation options live under `contextOptions`.
  test.use({ viewport: DESKTOP, contextOptions: { reducedMotion: "reduce" } });

  test("renders one frozen frame that stays stable and follows the theme", async ({ page }) => {
    const errors = trackRuntimeErrors(page);
    await openLogin(page, "employer", "ready-static");
    await expect(page.locator(CANVAS)).toHaveCount(1);
    // Content first: the frozen frame is a real shader frame, not an empty buffer.
    const dark = await litSample(page, "dark");
    const firstFrame = await page.locator(PANEL).screenshot();
    await page.waitForTimeout(700);
    const stableFrame = await page.locator(PANEL).screenshot();
    expect(Buffer.compare(firstFrame, stableFrame), "reduced motion must render one static frame with no RAF advancement").toBe(0);
    // A theme change still redraws that single static frame.
    const light = await litSample(page, "light");
    await expect(page.locator(HOST)).toHaveAttribute("data-floating-lines-state", "ready-static");
    await expect(page.locator(HOST)).toHaveCSS("filter", "invert(1)");
    expect(distance(dark.visible, light.visible), `static visible frame dark ${dark.visible.r.toFixed(2)}/${dark.visible.g.toFixed(2)}/${dark.visible.b.toFixed(2)} light ${light.visible.r.toFixed(2)}/${light.visible.g.toFixed(2)}/${light.visible.b.toFixed(2)}`).toBeGreaterThan(1);
    expect(errors.uncaught).toEqual([]);
    expect(errors.consoleErrors).toEqual([]);
  });
});

test.describe("login FloatingLines WebGL failure containment", () => {
  test.use({ viewport: DESKTOP });

  test("keeps the shell usable when WebGL is unavailable", async ({ page }) => {
    // Deny every WebGL context before the app boots.
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        return /webgl/i.test(type) ? null : (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof original;
    });
    const errors = trackRuntimeErrors(page);
    // Every non-GET is classified by path below: framework diagnostics may not
    // hide an application/business mutation.
    const nonGet: string[] = [];
    page.on("request", (entry) => {
      if (entry.method() !== "GET") nonGet.push(`${entry.method()} ${new URL(entry.url()).pathname}`);
    });
    await openLogin(page, "employer", "failed");
    await expect(page.locator(CANVAS)).toHaveCount(0);
    // The shell stays truthful and usable, with no uncaught error.
    await expect(page.getByRole("button", { name: "Ingresar" })).toBeDisabled();
    await expect(page.getByRole("link", { name: /ingresa aquí/i })).toBeVisible();
    expect(errors.uncaught, "a contained WebGL failure must not escape uncaught").toEqual([]);
    // The only console error allowed is ogl's own diagnostic inside the leaf.
    expect(errors.consoleErrors.every((message) => message.includes("unable to create webgl context")), `unexpected console error: ${JSON.stringify(errors.consoleErrors)}`).toBe(true);
    // Zero application/business mutations: only Next's own dev diagnostics for
    // the intentionally trapped init failure may use a non-GET, classified by
    // path so no other mutation can hide behind it.
    const internal = /^\w+ \/(?:_next\/|__nextjs_original-stack-frames)/;
    expect(nonGet.filter((entry) => !internal.test(entry)), "no business/application mutation").toEqual([]);
    expect(nonGet.every((entry) => entry === "POST /__nextjs_original-stack-frames"), `unexpected non-GET: ${JSON.stringify(nonGet)}`).toBe(true);
  });
});
