import { expect as baseExpect, test, type APIRequestContext, type Page } from "@playwright/test";

// A4.7 — embedded auth end to end, through the real screens, the real NextAuth
// routes and Server Actions, against the mock Cognito (tests/fixtures/cognito-mock.mjs)
// and the fixture API (tests/fixtures/embedded-auth-accounts.mjs inside jobs-server.mjs).
// The stack is started by playwright.config.ts (Next with NODE_ENV=test and
// COGNITO_IDP_ENDPOINT on the mock). Codes are read from the mock's test-only
// control endpoint, as a person would read them from the email.
//
// Every test records every URL the browser requests or navigates to and fails if
// a password or a verification/reset code ever appears in one; the login pages
// keep the FloatingLines panel (L11).

const COGNITO = process.env.COGNITO_MOCK_ORIGIN ?? "http://127.0.0.1:4599";
const PASSWORD = "Mariposa!71";
const NEW_PASSWORD = "Girasol#2027";
const PANEL = "[data-login-visual-panel]";
const CANVAS = "[data-floating-lines-host] canvas";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 800 } });
// Dev-mode first compiles of each auth route are slow; the flows themselves are short.
test.setTimeout(180_000);
const expect = baseExpect.configure({ timeout: 30_000 });

let sequence = 0;
const uniqueEmail = (label: string) => `${label}.${Date.now().toString(36)}${(sequence += 1)}@e2e.peopleflow.test`;

/** Every URL the page requested or navigated to, for the «nothing secret in a URL» check. */
function recordUrls(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  page.on("framenavigated", (frame) => urls.push(frame.url()));
  return urls;
}

function expectNoSecretInUrls(urls: readonly string[], secrets: readonly string[]) {
  const decoded = urls.map((url) => {
    try {
      return decodeURIComponent(url);
    } catch {
      return url;
    }
  });
  for (const secret of secrets.filter(Boolean)) {
    const leaks = decoded.filter((url) => url.includes(secret) || url.includes(encodeURIComponent(secret)));
    expect(leaks, "a password or code must never appear in a URL").toEqual([]);
  }
  expect(urls.length).toBeGreaterThan(0);
}

async function expectFloatingLines(page: Page) {
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.locator(PANEL)).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator(CANVAS)).toHaveCount(1);
}

// Scoped to the page content: Next's route announcer is also a live `alert` region.
const alertIn = (page: Page) => page.getByRole("main").getByRole("alert");
const statusIn = (page: Page) => page.getByRole("main").getByRole("status");

async function seedUser(request: APIRequestContext, user: { email: string; password: string; name?: string; confirmed?: boolean }) {
  const response = await request.post(`${COGNITO}/__cognito/users`, { data: user });
  expect(response.status()).toBe(201);
}

async function codes(request: APIRequestContext, email: string): Promise<{ confirmation: string | null; reset: string | null }> {
  const response = await request.get(`${COGNITO}/__cognito/codes`, { params: { email } });
  expect(response.ok()).toBe(true);
  return response.json();
}

async function waitForCode(request: APIRequestContext, email: string, kind: "confirmation" | "reset"): Promise<string> {
  let value: string | null = null;
  await expect.poll(async () => (value = (await codes(request, email))[kind]), { message: `${kind} code for the account` }).toMatch(/^\d{6}$/);
  return value!;
}

async function typeCode(page: Page, code: string) {
  await page.getByRole("textbox", { name: "Dígito 1 de 6" }).click();
  await page.keyboard.type(code);
  await expect(page.getByRole("textbox", { name: "Dígito 6 de 6" })).toHaveValue(code[5]!);
}

async function signIn(page: Page, email: string, password: string, emailLabel = "Correo") {
  const field = page.getByLabel(emailLabel, { exact: true });
  if ((await field.inputValue()) !== email) await field.fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  const answered = page.waitForResponse((response) => response.url().includes("/api/auth/callback/password"));
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  return answered;
}

async function signUp(page: Page, { name, email, password, emailLabel, submit }: { name: string; email: string; password: string; emailLabel: string; submit: string }) {
  await page.getByLabel("Nombre completo", { exact: true }).fill(name);
  await page.getByLabel(emailLabel, { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("checkbox", { name: "Acepto los Términos y el Aviso de privacidad." }).check();
  await page.getByRole("button", { name: submit, exact: true }).click();
}

async function sessionUser(page: Page): Promise<unknown> {
  const response = await page.request.get("/api/auth/session");
  return ((await response.json()) as { user?: unknown }).user ?? null;
}

test("candidate: sign-up → code → login notice → sign-in → onboarding", async ({ page, request }) => {
  const urls = recordUrls(page);
  const email = uniqueEmail("candidata");
  await page.goto("/candidato/registro");
  await expectFloatingLines(page);
  await signUp(page, { name: "Ximena Robles", email, password: PASSWORD, emailLabel: "Correo", submit: "Crear perfil" });

  await page.waitForURL("**/candidato/verificar");
  await expect(page.getByRole("heading", { level: 1, name: "Verifica tu correo" })).toBeVisible();
  await expectFloatingLines(page);
  const code = await waitForCode(request, email, "confirmation");
  await typeCode(page, code);
  await page.getByRole("button", { name: "Verificar", exact: true }).click();

  await page.waitForURL("**/candidato/login");
  await expect(statusIn(page)).toContainText("Tu correo quedó verificado. Ingresa para continuar.");
  await expect(page.getByLabel("Correo", { exact: true })).toHaveValue(email);
  await expect(page.getByLabel("Contraseña", { exact: true })).toBeFocused();
  await expectFloatingLines(page);
  await signIn(page, email, PASSWORD);

  await page.waitForURL("**/candidato/ingresar**");
  await expect(page.getByRole("heading", { name: "Crear mi cuenta de candidato" })).toBeVisible();
  await expect(page.getByLabel("Nombre completo")).toHaveValue("Ximena Robles");
  await page.getByRole("button", { name: "Crear mi cuenta de candidato" }).click();
  await page.waitForURL("**/candidato/dashboard**");
  expect(await sessionUser(page)).toMatchObject({ email });
  expectNoSecretInUrls(urls, [PASSWORD, code]);
});

test("employer: sign-up → code → login → «Tu empresa» → dashboard", async ({ page, request }) => {
  const urls = recordUrls(page);
  const email = uniqueEmail("laura");
  await page.goto("/empresa/registro");
  await expect(page.getByText("Registro de empresa · Paso 1 de 3")).toBeVisible();
  await expectFloatingLines(page);
  await signUp(page, { name: "Laura Méndez", email, password: PASSWORD, emailLabel: "Correo corporativo", submit: "Continuar" });

  await page.waitForURL("**/empresa/verificar");
  await expect(page.getByText("Registro de empresa · Paso 2 de 3")).toBeVisible();
  const code = await waitForCode(request, email, "confirmation");
  await typeCode(page, code);
  await page.getByRole("button", { name: "Verificar", exact: true }).click();

  await page.waitForURL("**/empresa/login");
  await expect(statusIn(page)).toContainText("Tu correo quedó verificado.");
  await expectFloatingLines(page);
  await signIn(page, email, PASSWORD, "Correo corporativo");

  await page.waitForURL("**/empresa/registro/empresa**");
  await expect(page.getByRole("heading", { level: 1, name: "Tu empresa" })).toBeVisible();
  await expect(page.getByText("Registro de empresa · Paso 3 de 3")).toBeVisible();
  await expectFloatingLines(page);
  await page.getByLabel("Nombre comercial").fill("Andamios del Norte");
  await page.getByLabel("RFC").fill("ADN200101AB1");
  await page.getByLabel("Industria").selectOption("tecnologia");
  await page.getByRole("button", { name: "Crear empresa" }).click();

  await page.waitForURL("**/empresa/dashboard**");
  expect(await sessionUser(page)).toMatchObject({ email });
  expectNoSecretInUrls(urls, [PASSWORD, code]);
});

test("sign-in: a wrong password and an unknown email get the same generic message", async ({ page, request }) => {
  const urls = recordUrls(page);
  const email = uniqueEmail("generic");
  await seedUser(request, { email, password: PASSWORD, name: "Gabriel Ortiz" });
  await page.goto("/candidato/login");
  await expectFloatingLines(page);

  for (const [who, password] of [[email, "Equivocada!1"], [uniqueEmail("nobody"), PASSWORD]] as const) {
    const answer = await signIn(page, who, password);
    expect(answer.status()).toBe(401);
    const alert = alertIn(page);
    await expect(alert).toHaveText("Correo o contraseña incorrectos.");
    await expect(page.getByLabel("Contraseña", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Correo", { exact: true })).toHaveAttribute("aria-invalid", "true");
    expect(new URL(page.url()).pathname).toBe("/candidato/login");
  }
  expect(await sessionUser(page)).toBeNull();
  expectNoSecretInUrls(urls, [PASSWORD, "Equivocada!1"]);
});

test("sign-in: an unconfirmed account goes to «Verifica tu correo», which resends a code on arrival", async ({ page, request }) => {
  const urls = recordUrls(page);
  const email = uniqueEmail("pending");
  await seedUser(request, { email, password: PASSWORD, name: "Paula Núñez", confirmed: false });
  expect((await codes(request, email)).confirmation).toBeNull();
  await page.goto("/candidato/login");
  await signIn(page, email, PASSWORD);

  await page.waitForURL("**/candidato/verificar");
  await expect(statusIn(page)).toContainText("Tu cuenta aún no está verificada.");
  await expect(page.getByText(email)).toBeVisible();
  const code = await waitForCode(request, email, "confirmation");
  await typeCode(page, code);
  await page.getByRole("button", { name: "Verificar", exact: true }).click();
  await page.waitForURL("**/candidato/login");
  await expect(statusIn(page)).toContainText("Tu correo quedó verificado.");
  expectNoSecretInUrls(urls, [PASSWORD, code]);
});

test("forgot password: code → new password → login notice → sign-in with the new password", async ({ page, request }) => {
  const urls = recordUrls(page);
  const email = uniqueEmail("reset");
  await seedUser(request, { email, password: PASSWORD, name: "Rocío Lara" });
  await page.goto("/candidato/login");
  await page.getByRole("link", { name: "¿Olvidaste tu contraseña?" }).click();

  await page.waitForURL("**/candidato/recuperar");
  await expect(page.getByRole("heading", { level: 1, name: "Restablece tu contraseña" })).toBeVisible();
  await expectFloatingLines(page);
  await page.getByLabel("Correo", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Enviar código" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Crea una contraseña nueva" })).toBeVisible();
  await expect(statusIn(page)).toContainText("Si hay una cuenta con ese correo, te enviamos un código.");
  const code = await waitForCode(request, email, "reset");
  await typeCode(page, code);
  await page.getByLabel("Nueva contraseña").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Cambiar contraseña" }).click();

  await page.waitForURL("**/candidato/login");
  await expect(statusIn(page)).toContainText("Tu contraseña se actualizó. Ingresa con tu nueva contraseña.");
  await expect(page.getByLabel("Correo", { exact: true })).toHaveValue(email);
  expect((await signIn(page, email, PASSWORD)).status()).toBe(401);
  await expect(alertIn(page)).toHaveText("Correo o contraseña incorrectos.");
  await signIn(page, email, NEW_PASSWORD);
  await page.waitForURL("**/candidato/ingresar**");
  expect(await sessionUser(page)).toMatchObject({ email });
  expectNoSecretInUrls(urls, [PASSWORD, NEW_PASSWORD, code]);
});

test("logout: «Cerrar sesión» ends a password session and returns to the audience login", async ({ page, request }) => {
  const urls = recordUrls(page);
  const email = uniqueEmail("logout");
  await seedUser(request, { email, password: PASSWORD, name: "Lucía Paz" });
  await page.goto("/empresa/login");
  await signIn(page, email, PASSWORD, "Correo corporativo");
  await page.waitForURL("**/empresa/registro/empresa**");
  expect(await sessionUser(page)).toMatchObject({ email });

  await page.goto("/empresa/login");
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await page.waitForURL("**/empresa/login");
  await expect(page.getByRole("button", { name: "Ingresar", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cerrar sesión" })).toHaveCount(0);
  await expectFloatingLines(page);
  expect(await sessionUser(page)).toBeNull();
  // A password session never hops through the Cognito hosted /logout.
  expect(urls.filter((url) => url.includes("amazoncognito.com"))).toEqual([]);
  expectNoSecretInUrls(urls, [PASSWORD]);
});

test("rate limit: once the per-email budget is spent, even the right password gets 429 «Demasiados intentos.»", async ({ page, request }) => {
  const urls = recordUrls(page);
  const email = uniqueEmail("limit");
  await seedUser(request, { email, password: PASSWORD, name: "Iván Solís" });
  await page.goto("/empresa/login");
  // Budget: 10 per email per 15 min (AUTH_RATE_LIMITS.signIn).
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    expect((await signIn(page, email, `Equivocada!${attempt}`, "Correo corporativo")).status(), `attempt ${attempt}`).toBe(401);
    await expect(alertIn(page)).toHaveText("Correo o contraseña incorrectos.");
  }
  // Even the right password is refused once the budget is spent.
  expect((await signIn(page, email, PASSWORD, "Correo corporativo")).status()).toBe(429);
  const alert = alertIn(page);
  await expect(alert).toContainText("Demasiados intentos.");
  await expect(alert.getByRole("link", { name: "Restablecer contraseña" })).toHaveAttribute("href", "/empresa/recuperar");
  expect(await sessionUser(page)).toBeNull();
  expectNoSecretInUrls(urls, [PASSWORD]);
});
