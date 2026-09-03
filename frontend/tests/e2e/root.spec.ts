import { expect, test } from "@playwright/test";

test.describe("minimal public root", () => {
  test("renders the shared public shell with one clear vacancy entry point", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.locator("html")).toHaveAttribute("lang", "es-MX");

    const rootHeadings = page.getByRole("heading", { level: 1 });
    await expect(rootHeadings).toHaveCount(1);
    await expect(rootHeadings.first()).not.toBeEmpty();

    const vacantesLinks = page.getByRole("link", { name: /vacantes/i });
    await expect(vacantesLinks).toHaveCount(1);
    await expect(vacantesLinks.first()).toHaveAttribute("href", "/vacantes");

    const hrefs = await page.locator("a").evaluateAll((anchors) =>
      anchors.map((a) => a.getAttribute("href")),
    );
    for (const href of hrefs) {
      expect(["/", "/vacantes"]).toContain(href);
    }

    await expect(page.getByRole("button")).toHaveCount(0);
  });
});
