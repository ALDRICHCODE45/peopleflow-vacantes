import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STAKEHOLDER_VACANCIES } from "@/features/identity/stakeholder-routes";
import Page, { metadata } from "./page";

vi.mock("@/features/stakeholder-vacancies/stakeholder-vacancies-page", () => ({ StakeholderVacanciesPage: () => null }));
vi.mock("@/components/company-dashboard/site-header", () => ({ SiteHeader: () => null }));

// Vitest runs from frontend/, so cwd-relative paths keep the assertions stable.
const pageSource = readFileSync(join(process.cwd(), "src/app/(empresa)/empresa/stakeholder/vacantes/page.tsx"), "utf8");

// S12: `/empresa/stakeholder/vacantes`, the stakeholder's read-only «Vacantes» list.
describe("/empresa/stakeholder/vacantes", () => {
  it("lives at the path the sidebar and the stakeholder gate share", () => {
    expect(STAKEHOLDER_VACANCIES).toBe("/empresa/stakeholder/vacantes");
  });
  it("titles the page «Vacantes» and mounts the list under the shared employer header", () => {
    expect(metadata).toEqual({ title: "Vacantes" });
    const tree = JSON.stringify(Page(), (_key, value) => typeof value === "function" ? value.name : value);
    expect(tree).toContain("SiteHeader");
    expect(tree).toContain("StakeholderVacanciesPage");
  });
  it("reads nothing on the server and serves no prototype data", () => {
    expect(pageSource).not.toMatch(/fetch\(|getActionAccessToken|NEXO_|prototype-/u);
  });
});
