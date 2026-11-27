// Read-only review of the artboards: JS errors, axe (WCAG 2.2 AA), overflow, phone targets.
// Usage (repo root): node design/embedded-auth/_src/check.mjs [--shots <state,...>]
// --shots [--aud E|C] [--theme light|dark] writes PNGs into design/embedded-auth/_src/shots/ (inside the allowed surface).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../../frontend/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const { default: AxeBuilder } = require('@axe-core/playwright');

const files = ['01-panel-dividido.html', '02-tarjeta-centrada.html', '03-recorrido-guiado.html'];
const shotArg = process.argv.indexOf('--shots');
const shotStates = shotArg > 0 ? process.argv[shotArg + 1].split(',') : null;
const shotAud = process.argv.includes('--aud') ? process.argv[process.argv.indexOf('--aud') + 1] : null;
const shotTheme = process.argv.includes('--theme') ? process.argv[process.argv.indexOf('--theme') + 1] : null;
const shotDir = new URL('shots/', import.meta.url);
if (shotStates) mkdirSync(shotDir, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1488, height: 900 } }); const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

let runs = 0; const problems = [];
for (const f of files) {
  const url = new URL(`../${f}`, import.meta.url).href;
  await page.goto(url);
  const states = await page.evaluate(() => STATES.map((s) => ({ id: s.id, only: s.only })));
  for (const st of states) {
    for (const aud of st.only ? [st.only] : ['E', 'C']) {
      for (const theme of ['light', 'dark']) {
        await page.goto(`${url}#s=${st.id}&aud=${aud}&theme=${theme}`);
        await page.reload();
        await page.waitForTimeout(30);
        runs++;
        const tag = `${f.slice(0, 2)} ${st.id} ${aud} ${theme}`;
        const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
        for (const v of axe.violations) problems.push(`${tag} axe ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
        const geo = await page.evaluate(() => {
          const out = [];
          for (const id of ['fd', 'fm']) {
            const fr = document.getElementById(id); const R = fr.getBoundingClientRect();
            for (const el of fr.querySelectorAll('*')) {
              if (el.closest('.sr,svg,[hidden]') && !el.matches('svg')) continue;
              const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
              if (el.closest('.vis')) continue;
              if (r.right > R.right + 1 || r.left < R.left - 1) out.push(`${id} outside: ${el.tagName}.${el.className?.baseVal ?? el.className}`);
              const cs = getComputedStyle(el);
              if (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) out.push(`${id} hscroll: ${el.className}`);
              if (el.scrollWidth > el.clientWidth + 1 && cs.overflow === 'hidden' && el.tagName !== 'INPUT' && !el.classList.contains('vp')) out.push(`${id} clipped: ${el.tagName}.${el.className}`);
              if (id === 'fm' && el.matches('a,button,input:not([type=checkbox]),summary') && el.offsetParent !== null && r.height < 43.5) out.push(`fm target ${Math.round(r.height)}px: ${el.tagName} ${el.textContent.trim().slice(0, 30)}`);
            }
          }
          return out;
        });
        for (const g of geo) problems.push(`${tag} ${g}`);
        if (shotStates && shotStates.includes(st.id) && (!shotAud || shotAud === aud) && (!shotTheme || shotTheme === theme)) {
          await page.screenshot({ path: fileURLToPath(new URL(`${f.slice(0, 2)}-${st.id}-${aud}-${theme}.png`, shotDir)), fullPage: true });
        }
      }
    }
  }
}
await browser.close();
console.log(`runs: ${runs}`);
console.log(`js errors: ${errors.length}`); errors.slice(0, 10).forEach((e) => console.log('  ', e));
console.log(`problems: ${problems.length}`); [...new Set(problems)].slice(0, 80).forEach((p) => console.log('  ', p));
