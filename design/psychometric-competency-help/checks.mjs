// Design-only checks. No product server, credentials, storage or network access.
// Run with Node 22 from the repository root; screenshots are explicitly requested artifacts.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '/tmp/t12qa/lib.mjs';

const root = resolve('design/psychometric-competency-help');
const output = '/tmp/t12qa/comp-help';
const manifest = JSON.parse(await readFile(resolve(root, 'design.json'), 'utf8'));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const errors = [];
const copies = [];
try {
  for (const [index, board] of manifest.artboards.entries()) {
    const source = await readFile(resolve(root, board.file), 'utf8');
    assert(!/innerHTML|createContextualFragment|<script[^>]+src=|<link\b|<iframe\b|<img\b/i.test(source), 'Self-contained static markup / textContent only');
    assert(!/(?:href|src)=["']https?:/i.test(source), 'No external assets');
    const context = await browser.newContext({ viewport: { width: board.width, height: board.height }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(`${board.file}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`${board.file}: ${m.text()}`); });
    await page.route(/^https?:/, route => { errors.push(`External request: ${route.request().url()}`); return route.abort(); });
    await page.goto(pathToFileURL(resolve(root, board.file)).href);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const size = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
    assert.equal(size.width, board.width, `${board.file}: no horizontal overflow`);
    assert.equal(size.height, board.height, `${board.file}: actual full height matches manifest`);
    const contrasts = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      const luminance = token => {
        ctx.fillStyle = style.getPropertyValue('--' + token).trim();
        ctx.fillRect(0, 0, 1, 1);
        const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(v => {
          const c = v / 255;
          return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
        });
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
      };
      return [['foreground', 'card'], ['muted-foreground', 'card'], ['muted-foreground', 'muted'], ['muted-foreground', 'background'], ['primary', 'card'], ['primary-foreground', 'primary'], ['status-info', 'card'], ['status-success', 'card']]
        .filter(pair => pair.every(t => style.getPropertyValue('--' + t).trim()))
        .map(pair => { const values = pair.map(luminance).sort((a, b) => b - a); return { pair: pair.join('/'), ratio: (values[0] + .05) / (values[1] + .05) }; });
    });
    for (const c of contrasts) assert(c.ratio >= 4.5, `${board.file}: AA token text contrast ${c.pair}: ${c.ratio}`);
    const pop = page.locator('#help-popover');
    assert.equal(await pop.isVisible(), index < 2, 'Only requested example popover initially open');
    await page.screenshot({ path: `${output}/${board.file.replace('.html', '-full.png')}`, fullPage: true });
    if (index < 2) {
      await page.keyboard.press('Escape');
      assert.equal(await pop.isVisible(), false);
      assert.equal(await page.locator('.info:focus').count(), 1, 'Escape returns focus');
    }
    const buttons = page.locator('.info');
    const count = await buttons.count();
    assert.equal(count, index === 0 ? 13 : 7, 'Seven rows + detail + five fields where applicable');
    const texts = [];
    for (let i = 0; i < count; i++) {
      const trigger = buttons.nth(i);
      const box = await trigger.boundingBox();
      assert(box.width >= 40 && box.height >= 40, '40 px hit target');
      assert.equal(await trigger.getAttribute('aria-controls'), 'help-popover');
      assert(await trigger.getAttribute('aria-label'), 'Named trigger');
      await trigger.click();
      assert(await pop.isVisible());
      assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
      assert.equal(await page.locator('.info[aria-expanded="true"]').count(), 1, 'Only one open');
      assert((await pop.locator('h2').textContent()).trim());
      texts.push(await page.locator('#help-text').textContent());
      await page.keyboard.press('Escape');
      assert.equal(await pop.isVisible(), false);
      assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
      assert(await trigger.evaluate(e => document.activeElement === e), 'Focus restored to same trigger');
      // Keyboard activation and outside dismissal are public interactions too.
      await trigger.press('Enter');
      assert(await pop.isVisible());
      await page.locator('h1').click();
      assert.equal(await pop.isVisible(), false);
      assert(await trigger.evaluate(e => document.activeElement === e), 'Outside click returns focus');
    }
    copies.push(texts.slice(0, 7));
    // Opening another trigger replaces content without a second panel.
    await buttons.nth(0).click();
    await buttons.nth(count - 1).click();
    assert.equal(await page.locator('.info[aria-expanded="true"]').count(), 1);
    assert.equal(await buttons.nth(0).getAttribute('aria-expanded'), 'false');
    await page.keyboard.press('Escape');
    const screenshotTrigger = index === 0 ? page.locator('[data-help="band"] .info') : buttons.nth(1);
    await screenshotTrigger.click();
    await page.screenshot({ path: `${output}/${board.file.replace('.html', '-click-open.png')}`, fullPage: true });
    await page.keyboard.press('Escape');
    if (index === 0) {
      const before = await page.locator('#detail-title').textContent();
      await buttons.nth(1).click();
      assert.equal(await page.locator('#detail-title').textContent(), before, 'Info does not select the list row');
      await page.keyboard.press('Escape');
      await page.locator('.row-select').nth(1).click();
      assert.equal(await page.locator('#detail-title').textContent(), 'Cumplimiento de compromisos');
      assert.equal(await page.locator('#task-field').isVisible(), false, 'Task only for Clave');
      await page.locator('[name=importance][value="No relevante"]').check();
      for (const id of ['band-field', 'task-field', 'rationale-field']) assert.equal(await page.locator('#' + id).isVisible(), false);
      assert.equal(await page.locator('#confirmation').textContent(), 'Perfil sin confirmar');
    }
    // Focus ring and reduced-motion are present without animation.
    await buttons.nth(0).focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    assert(await buttons.nth(0).evaluate(e => document.activeElement === e));
    assert.equal(await buttons.nth(0).evaluate(e => getComputedStyle(e).outlineStyle), 'solid');
    console.log(`PASS ${board.file}: ${size.width}×${size.height}; ${count} help triggers; full + click-open screenshots`);
    await context.close();
  }
  assert.deepEqual(copies[0], copies[1], 'Identical competency copy in configuration and candidate sheet');
  assert.deepEqual(copies[0], copies[2], 'Identical approved-copy table and interactive popovers');
  assert.deepEqual(errors, [], 'Zero console/page errors or external requests');
  console.log('PASS copy consistency, standalone assets, focus, dismissals, row isolation; zero console/page errors.');
} finally {
  await browser.close();
}
