import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({ headless: true });
try {
  await fetch("http://127.0.0.1:4010/__reset");
  const page = await browser.newPage();
  const failures = [];
  page.on("response", response => { if (response.url().includes("/api/geo/") || response.url().includes("/api/catalogs/")) { if (!response.ok()) failures.push(`${response.status()} ${response.url()}`); } });
  await page.goto("http://127.0.0.1:3100/vacantes");
  await expect(page.getByRole("link", { name: "Ingeniera Frontend", exact: true })).toBeVisible();
  await expect(page.getByText("No pudimos cargar las vacantes", { exact: false })).toHaveCount(0);
  console.log("PASS list: real Ingeniera Frontend vacancy link");
  const id = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d92";
  await page.goto(`http://127.0.0.1:3100/vacantes/${id}`);
  await expect(page.getByRole("article")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Desarrolladora Go" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Beneficios para ti" })).toBeVisible();
  console.log("PASS detail: article, title and benefits");
  await page.goto(`http://127.0.0.1:3100/vacantes/${id}/postular`);
  await expect(page.getByRole("button", { name: "Ingresar como candidato" })).toBeVisible();
  console.log("PASS visitor application: sign-in gate");
  expect(failures).toEqual([]);
  console.log("PASS no failed catalog/geo proxy responses");
} finally { await browser.close(); }
