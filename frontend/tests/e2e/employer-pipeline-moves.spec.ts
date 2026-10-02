import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const ROUTE = "/empresa/vacantes/backend-developer-senior/pipeline";
const ID = "lucia-fernandez";
const card = (page: Page) => page.locator(`[data-pf-pipeline-card="${ID}"]`);
const column = (page: Page, stage: string) => page.locator(`[data-pf-pipeline-column="${stage}"]`);
const modal = (page: Page) => page.getByRole("dialog");

async function dragToStage(page: Page, stage: string | null) {
  const handle = page.locator(`[data-pf-pipeline-drag="${ID}"]`);
  await handle.scrollIntoViewIfNeeded();
  // Coordinate gestures need the same hit-testing readiness as a normal click.
  await handle.click({ trial: true });
  const from = await handle.boundingBox();
  const to = stage ? await column(page, stage).boundingBox() : { x: 0, y: 0, width: 40, height: 0 };
  if (!from || !to) throw new Error("Missing drag geometry");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 15, from.y + from.height / 2, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + 70, { steps: 18 });
  if (stage) await expect(column(page, stage)).toHaveAttribute("data-pf-pipeline-column-over", "");
  else await expect(page.locator("[data-pf-pipeline-column-over]")).toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator("[data-pf-pipeline-drag-preview]")).toHaveCount(0);
}

async function assertStage(page: Page, stage: string) {
  await expect(column(page, stage).locator(`[data-pf-pipeline-card="${ID}"]`)).toHaveCount(1);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(ROUTE);
  await expect(card(page)).toBeVisible();
});

test("card click opens the existing candidate Sheet without inventing contact data", async ({ page }) => {
  await card(page).getByText("Node.js", { exact: true }).click();
  await expect(modal(page)).toBeVisible();
  await expect(page.locator("[data-pf-talento-sheet-name]")).toHaveText("Lucía Fernández");
  await expect(modal(page).getByText("Node.js", { exact: true })).toBeVisible();
  await expect(modal(page)).not.toContainText("Diego Molina");
  await page.keyboard.press("Escape");
  await expect(modal(page)).toHaveCount(0);
  await assertStage(page, "submitted");
});

test("drop is pending until confirmation; cancellation and same-stage drops are no-ops", async ({ page }) => {
  await dragToStage(page, "in_review");
  await expect(modal(page)).toBeVisible();
  await assertStage(page, "submitted");
  await modal(page).getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(modal(page)).toHaveCount(0);
  await assertStage(page, "submitted");
  await dragToStage(page, "submitted");
  await expect(modal(page)).toHaveCount(0);
  await dragToStage(page, null);
  await expect(modal(page)).toHaveCount(0);
  await assertStage(page, "submitted");
  await dragToStage(page, "hired");
  await expect(modal(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(modal(page)).toHaveCount(0);
  await assertStage(page, "submitted");
  await dragToStage(page, "rejected");
  await expect(modal(page)).toBeVisible();
  await page.locator("[data-slot='dialog-overlay']").click({ position: { x: 5, y: 5 } });
  await expect(modal(page)).toHaveCount(0);
  await assertStage(page, "submitted");
});

test("every stage can be confirmed and the list shares local status without storage or network writes", async ({ page }) => {
  const mutations: string[] = [];
  page.on("request", request => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) mutations.push(request.url());
  });
  const storageBefore = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
  for (const [stage, label] of [["in_review", "En revisión"], ["hired", "Contratados"], ["rejected", "Descartados"], ["submitted", "Nuevos"], ["hired", "Contratados"]]) {
    await dragToStage(page, stage);
    await expect(modal(page)).toBeVisible();
    await modal(page).getByRole("button", { name: /^Confirmar/ }).click();
    await expect(modal(page)).toHaveCount(0);
    await assertStage(page, stage);
    await page.locator('[data-pf-pipeline-view-tab="list"]').click();
    await expect(page.locator(`[data-pf-pipeline-row="${ID}"]`)).toContainText(label);
    await page.locator('[data-pf-pipeline-view-tab="board"]').click();
  }
  expect(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }))).toEqual(storageBefore);
  expect(mutations).toEqual([]);
  await page.reload();
  await assertStage(page, "submitted");
});

test("optional message validates, previews both channels and remains a local draft after confirmation", async ({ page }) => {
  await dragToStage(page, "in_review");
  const dialog = modal(page);
  await dialog.getByRole("switch", { name: /Notificar/ }).click();
  const message = dialog.getByRole("textbox", { name: /Mensaje/ });
  await message.fill("   ");
  await dialog.getByRole("button", { name: /^Confirmar/ }).click();
  await expect(dialog).toBeVisible();
  await expect(message).toHaveAttribute("aria-invalid", "true");
  await message.fill("Hola Lucía, nos gustaría conocer más sobre tu experiencia con Node.js.");
  await expect(dialog).toContainText(/correo/i);
  await expect(dialog).toContainText(/proceso|seguimiento/i);
  await dialog.getByRole("button", { name: /^Confirmar/ }).click();
  await expect(dialog).toHaveCount(0);
  await assertStage(page, "in_review");
  await card(page).getByText("Node.js", { exact: true }).click();
  await expect(modal(page)).toContainText("Hola Lucía, nos gustaría conocer más sobre tu experiencia con Node.js.");
  await page.keyboard.press("Escape");
  await expect(modal(page)).toHaveCount(0);
  await dragToStage(page, "rejected");
  await expect(modal(page).getByRole("switch", { name: /Notificar/ })).not.toBeChecked();
  await modal(page).getByRole("switch", { name: /Notificar/ }).click();
  await expect(modal(page).getByRole("textbox", { name: /Mensaje/ })).toHaveValue("");
});

test("keyboard dragging supports cancellation, same-stage drop and a neighboring stage", async ({ page }) => {
  const handle = page.locator(`[data-pf-pipeline-drag="${ID}"]`);
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(handle).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await page.keyboard.press("Escape");
  await expect(modal(page)).toHaveCount(0);
  await expect(handle).toBeFocused();
  await expect(handle).not.toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-pf-pipeline-drag-preview]")).toHaveCount(0);
  await page.keyboard.press("Space");
  await expect(handle).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await page.keyboard.press("Enter");
  await expect(modal(page)).toHaveCount(0);
  await expect(handle).toBeFocused();
  await expect(handle).not.toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-pf-pipeline-drag-preview]")).toHaveCount(0);
  await page.keyboard.press("Space");
  await expect(handle).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  for (let step = 0; step < 24; step++) {
    if (await column(page, "in_review").getAttribute("data-pf-pipeline-column-over") !== null) break;
    await page.keyboard.press("ArrowRight");
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  }
  await expect(column(page, "in_review")).toHaveAttribute("data-pf-pipeline-column-over", "");
  await page.keyboard.press("Space");
  await expect(modal(page).getByRole("button", { name: /^Confirmar/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await assertStage(page, "submitted");
});

test("pen input activates the same stage confirmation", async ({ page }) => {
  const handle = page.locator(`[data-pf-pipeline-drag="${ID}"]`);
  const from = await handle.boundingBox();
  const to = await column(page, "in_review").boundingBox();
  if (!from || !to) throw new Error("Missing pen geometry");
  const session = await page.context().newCDPSession(page);
  const x = from.x + from.width / 2;
  const y = from.y + from.height / 2;
  await session.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1, pointerType: "pen" });
  await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x + 15, y, buttons: 1, pointerType: "pen" });
  await expect(handle).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: to.x + to.width / 2, y: to.y + 70, buttons: 1, pointerType: "pen" });
  await expect(column(page, "in_review")).toHaveAttribute("data-pf-pipeline-column-over", "");
  await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x + to.width / 2, y: to.y + 70, button: "left", buttons: 0, pointerType: "pen" });
  await session.detach();
  await expect(modal(page).getByRole("button", { name: /^Confirmar/ })).toBeVisible();
});

test.describe("touch movement", () => {
  test.use({ hasTouch: true });
  test("a mobile touch drag reaches the same confirmation without opening details", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const handle = page.locator(`[data-pf-pipeline-drag="${ID}"]`);
    await handle.scrollIntoViewIfNeeded();
    const from = await handle.boundingBox();
    const to = await column(page, "in_review").boundingBox();
    if (!from || !to) throw new Error("Missing touch geometry");
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x + from.width / 2, y: from.y + from.height / 2 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + from.width / 2 + 15, y: from.y + from.height / 2 }] });
    await expect(handle).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: Math.min(to.x + to.width / 2, 351), y: to.y + 70 }] });
    await expect(column(page, "in_review")).toHaveAttribute("data-pf-pipeline-column-over", "");
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await session.detach();
    await expect(modal(page).getByRole("button", { name: /^Confirmar/ })).toBeVisible();
    await modal(page).getByRole("button", { name: "Cancelar", exact: true }).click();
    await assertStage(page, "submitted");
  });
});

test("keyboard detail and stage menus work on desktop and mobile", async ({ page }) => {
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await page.goto(ROUTE);
    const detail = page.locator(`[data-pf-pipeline-detail="${ID}"]`);
    await detail.focus();
    await page.keyboard.press("Enter");
    await expect(modal(page)).toHaveAccessibleName("Lucía Fernández");
    await page.keyboard.press("Escape");
    await expect(modal(page)).toHaveCount(0);
    await expect(detail).toBeFocused();
    await page.locator(`[data-pf-pipeline-move="${ID}"]`).focus();
    await page.keyboard.press("Enter");
    const target = page.getByRole("menuitem", { name: "En revisión", exact: true });
    await target.focus();
    await page.keyboard.press("Enter");
    await expect(modal(page)).toHaveAccessibleName("Confirmar cambio de etapa");
    await modal(page).getByRole("button", { name: /^Confirmar/ }).focus();
    await page.keyboard.press("Enter");
    await expect(modal(page)).toHaveCount(0);
    await assertStage(page, "in_review");
    await expect(page.locator(`[data-pf-pipeline-detail="${ID}"]`)).toBeFocused();
  }
});

test("moving out of a filtered stage preserves filters and restores focus to a usable control", async ({ page }) => {
  await page.locator("[data-pf-pipeline-filter-toggle]").click();
  await page.locator("#pipeline-filtro-status").click();
  await page.locator('[data-pf-pipeline-option="status:submitted"]').click();
  await page.locator("[data-pf-pipeline-filters-close]").click();
  await expect(page.locator("[data-pf-pipeline-card]")).toHaveCount(1);
  await dragToStage(page, "in_review");
  await modal(page).getByRole("button", { name: /^Confirmar/ }).click();
  await expect(modal(page)).toHaveCount(0);
  await expect(page.locator("[data-pf-pipeline-card]")).toHaveCount(0);
  await expect(page.locator("[data-pf-pipeline-chips]")).toContainText("Nuevos");
  await expect.poll(() => page.evaluate(() => document.activeElement?.matches("button,input,[tabindex='0'],[data-pf-pipeline-column]") ?? false)).toBe(true);
  await page.locator("[data-pf-pipeline-clear]").click();
  await assertStage(page, "in_review");
});

test("confirmation stays accessible and overflow-free at desktop and mobile widths", async ({ page }) => {
  await dragToStage(page, "in_review");
  await modal(page).getByRole("switch", { name: /Notificar/ }).click();
  await modal(page).getByRole("textbox", { name: /Mensaje/ }).fill("Queremos conocer más sobre tu experiencia. ".repeat(7));
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await expect(modal(page)).toBeVisible();
    await modal(page).getByRole("button", { name: /^Confirmar/ }).click({ trial: true });
    await expect(modal(page).getByRole("button", { name: /^Confirmar/ })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const audit = await new AxeBuilder({ page }).analyze();
    expect(audit.violations.filter(item => ["serious", "critical"].includes(item.impact ?? ""))).toEqual([]);
    // Visual acceptance belongs to the user after push; this checks layout and semantics only.
  }
});
