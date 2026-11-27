// Self-check: render every artboard in light and dark, axe (incl. iframes), overflow, JS errors, screenshots.
// Run from the repo root: node design/notification-emails/_src/check.mjs
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..");
const require = createRequire(resolve("frontend/package.json"));
const { chromium } = require("@playwright/test");
const { default: AxeBuilder } = await import(require.resolve("@axe-core/playwright"));

const files = ["01-membrete.html", "02-encabezado-por-tipo.html", "03-centrada.html", "04-sistema-de-correo.html"];
const shots = join(OUT, "_review"); mkdirSync(shots, { recursive: true });
const browser = await chromium.launch();
const report = [];
for (const f of files) for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => m.type() === "error" && errors.push(m.text()));
  await page.goto("file://" + join(OUT, f));
  if (theme === "dark") await page.click('.seg button[data-theme="dark"]');
  await page.waitForTimeout(600);
  const m = await page.evaluate(() => {
    const out = { pageOverflow: document.documentElement.scrollWidth > 1440, height: document.documentElement.scrollHeight, frames: [] };
    for (const fr of document.querySelectorAll("iframe[data-mail]")) {
      const d = fr.contentDocument; const w = fr.clientWidth;
      out.frames.push({ id: fr.dataset.mail, w, docW: d.documentElement.scrollWidth, h: d.documentElement.scrollHeight, overflow: d.documentElement.scrollWidth > w + 1,
        bodyBg: getComputedStyle(d.body).backgroundColor, h1: d.querySelector("h1") && getComputedStyle(d.querySelector("h1")).color });
    }
    return out;
  });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  await page.screenshot({ path: join(shots, `${f.replace(".html", "")}-${theme}.png`), fullPage: true });
  const secs = await page.$$("section.row, section.spec, section.trade");
  for (let i = 0; i < secs.length; i++) await secs[i].screenshot({ path: join(shots, `${f.replace(".html", "")}-${theme}-s${i}.png`) });
  report.push({ f, theme, errors, pageOverflow: m.pageOverflow, height: m.height,
    frameOverflow: m.frames.filter(x => x.overflow).map(x => `${x.id} ${x.docW}>${x.w}`),
    frames: m.frames.map(x => `${x.id}:${x.h}px bg=${x.bodyBg} h1=${x.h1}`),
    axe: axe.violations.map(v => `${v.id} (${v.nodes.length}): ${v.nodes.slice(0, 3).map(n => n.target.join(" ")).join(" | ")}`) });
  await ctx.close();
}
await browser.close();
writeFileSync(join(shots, "report.json"), JSON.stringify(report, null, 2));
for (const r of report) console.log(r.f, r.theme, "h=" + r.height, "errors=" + r.errors.length, "pageOverflow=" + r.pageOverflow, "frameOverflow=" + JSON.stringify(r.frameOverflow), "axe=" + JSON.stringify(r.axe));
