// Captures a local login session for Playwright runs that need an employer or candidate account.
// Usage (from frontend/, app running on localhost:3000):
//   node tests/e2e/capture-session.mjs employer   -> .playwright-auth/employer.json
//   node tests/e2e/capture-session.mjs candidate  -> .playwright-auth/candidate.json
// A visible Chrome window opens on the role's login page; sign in there. The file is saved once the
// session cookie exists and the browser is back on the app origin. The file is a credential: it stays in
// the ignored .playwright-auth/ directory and is never printed, logged or committed.
import { mkdir, chmod } from "node:fs/promises";
import { chromium } from "@playwright/test";

const roles = { employer: "/empresa/login", candidate: "/candidato/login" };
const role = process.argv[2];
if (!(role in roles)) { console.error("Usage: node tests/e2e/capture-session.mjs employer|candidate"); process.exit(2); }
const origin = process.env.PLAYWRIGHT_APP_ORIGIN ?? "http://localhost:3000";
const target = `.playwright-auth/${role}.json`;
const timeoutMs = 10 * 60 * 1000;

const browser = await chromium.launch({ channel: "chrome", headless: false });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(new URL(roles[role], origin).toString());
  console.log(`Sign in as ${role} in the Chrome window (up to 10 minutes)…`);
  const deadline = Date.now() + timeoutMs;
  let last = "";
  for (;;) {
    const cookies = await context.cookies(origin);
    const signedIn = cookies.some(c => /next-auth\.session-token/.test(c.name));
    const url = new URL(context.pages().at(-1)?.url() ?? page.url());
    // Progress shows only the host, path and cookie names, never cookie values or query strings.
    const state = `${url.host}${url.pathname} · cookies: ${cookies.map(c => c.name).join(", ") || "none"}`;
    if (state !== last) { console.log(state); last = state; }
    // Login pages do not redirect a signed-in user, so the session cookie back on the app origin is enough.
    if (signedIn && url.origin === origin) break;
    if (Date.now() > deadline) { console.error("Timed out waiting for the login."); process.exit(1); }
    await page.waitForTimeout(1000);
  }
  await mkdir(".playwright-auth", { recursive: true, mode: 0o700 });
  await context.storageState({ path: target });
  await chmod(target, 0o600);
  console.log(`Session saved to ${target}.`);
} finally {
  await browser.close();
}
