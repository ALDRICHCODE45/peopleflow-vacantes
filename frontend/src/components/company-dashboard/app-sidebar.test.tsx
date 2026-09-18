import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { AppSidebar } from "./app-sidebar";
import { SidebarProvider } from "./ui/sidebar";

// Vitest runs from frontend/, so cwd-relative paths keep the assertions stable.
const source = readFileSync(
  join(process.cwd(), "src/components/company-dashboard/app-sidebar.tsx"),
  "utf8",
);

const PRINCIPAL_ITEMS = [
  "Dashboard",
  "Vacantes",
  "Candidatos",
  "Mensajes",
] as const;
const ORGANIZATION_ITEMS = ["Equipo", "Reportes", "Configuración"] as const;

// jsdom implements neither matchMedia nor ResizeObserver; the sidebar reads the
// first through `useIsMobile`, so it is stubbed to the desktop branch.
function stubBrowserApis() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      media: "",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("innerWidth", 1280);
}

function renderSidebar() {
  return render(
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>,
  );
}

/** Returns the `[data-slot="sidebar-group"]` element carrying `label`. */
function groupLabeled(label: string): HTMLElement {
  const labels = Array.from(
    document.querySelectorAll("[data-slot='sidebar-group-label']"),
  );
  const match = labels.find((node) => node.textContent?.trim() === label);
  expect(match, `${label} group label`).toBeDefined();
  return match!.closest("[data-slot='sidebar-group']") as HTMLElement;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("company dashboard sidebar identity", () => {
  beforeEach(stubBrowserApis);

  it("replaces the stock company glyph and name with the PeopleFlow wordmark", () => {
    renderSidebar();

    expect(screen.queryByText("Acme Inc.")).toBeNull();
    expect(document.querySelector("svg.tabler-icon-inner-shadow-top")).toBeNull();

    const brand = screen.getByRole("link", { name: "PeopleFlow" });
    expect(brand).toHaveAttribute("href", "/empresa/dashboard");

    const marks = Array.from(brand.querySelectorAll("img"));
    expect(marks.map((img) => img.getAttribute("src"))).toEqual([
      expect.stringContaining("peopleflow-light"),
      expect.stringContaining("peopleflow-dark"),
    ]);
    // One mark per color scheme: the sidebar must stay correct in both themes
    // through the canonical brand classes, not through a hard-coded variant.
    expect(marks[0].className).toContain("brand-mark-light");
    expect(marks[1].className).toContain("brand-mark-dark");
  });

  it("fits the wordmark into the approved sidebar header geometry", () => {
    renderSidebar();

    const brand = screen.getByRole("link", { name: "PeopleFlow" });

    // The stock header slot was a 20px glyph inside an h-8 button with the
    // approved 6px padding override; the wordmark reuses that same box.
    expect(brand.className).toContain("h-8");
    expect(brand.className).toContain("data-[slot=sidebar-menu-button]:p-1.5!");

    for (const mark of Array.from(brand.querySelectorAll("img"))) {
      expect(mark.className).toContain("h-5");
      expect(mark.className).toContain("w-auto");
      expect(mark.className).not.toContain("h-8");
    }
  });

  it("introduces no raw color value", () => {
    expect(source).not.toMatch(/oklch\(|#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\s*\(/);
  });
});

describe("company dashboard sidebar navigation", () => {
  beforeEach(stubBrowserApis);

  it("labels the two recruiting groups", () => {
    renderSidebar();

    const labels = Array.from(
      document.querySelectorAll("[data-slot='sidebar-group-label']"),
    ).map((node) => node.textContent?.trim());

    expect(labels).toEqual(["Principal", "Organización"]);
  });

  it("lists the primary recruiting destinations in order", () => {
    renderSidebar();

    const group = groupLabeled("Principal");
    const labels = within(group)
      .getAllByRole("link")
      .map((link) => link.textContent);

    expect(labels).toEqual([...PRINCIPAL_ITEMS]);
  });

  it("lists the organization destinations in order", () => {
    renderSidebar();

    const group = groupLabeled("Organización");
    const labels = within(group)
      .getAllByRole("link")
      .map((link) => link.textContent);

    expect(labels).toEqual([...ORGANIZATION_ITEMS]);
  });

  it("keeps Dashboard as the only real route and the rest as safe prototypes", () => {
    renderSidebar();

    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      "/empresa/dashboard",
    );

    for (const label of [...PRINCIPAL_ITEMS.slice(1), ...ORGANIZATION_ITEMS]) {
      expect(
        screen.getByRole("link", { name: label }),
        `${label} prototype target`,
      ).toHaveAttribute("href", "#");
    }

    const hrefs = Array.from(document.querySelectorAll("a")).map((anchor) =>
      anchor.getAttribute("href"),
    );
    expect(new Set(hrefs)).toEqual(new Set(["#", "/empresa/dashboard"]));
  });

  it("marks Dashboard as the active destination", () => {
    renderSidebar();

    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "data-active",
    );
    for (const label of [...PRINCIPAL_ITEMS.slice(1), ...ORGANIZATION_ITEMS]) {
      expect(
        screen.getByRole("link", { name: label }),
        `${label} must not be marked active`,
      ).not.toHaveAttribute("data-active");
    }
  });

  it("renames the quick-create action to the recruiting call to action", () => {
    renderSidebar();

    const cta = screen.getByRole("button", { name: "Nueva vacante" });
    expect(cta.className).toContain("bg-primary");
    expect(cta.className).toContain("text-primary-foreground");
    expect(cta.className).toContain("min-w-8");

    expect(screen.queryByText("Quick Create")).toBeNull();
    expect(screen.queryByRole("button", { name: /inbox/i })).toBeNull();
  });

  it("drops the stock demo navigation definitions", () => {
    renderSidebar();

    for (const stock of [
      "Lifecycle",
      "Analytics",
      "Projects",
      "Team",
      "Documents",
      "Data Library",
      "Reports",
      "Word Assistant",
      "Settings",
      "Get Help",
      "Search",
      "Active Proposals",
      "Archived",
    ]) {
      expect(screen.queryByText(stock), `${stock} stock entry`).toBeNull();
    }

    for (const dead of [
      "navClouds",
      "Active Proposals",
      "Word Assistant",
      "Data Library",
      "IconCamera",
      "IconFileAi",
      "IconFileWord",
      "IconDatabase",
    ]) {
      expect(source, `${dead} dead definition`).not.toContain(dead);
    }
  });
});

describe("company dashboard sidebar account identity", () => {
  beforeEach(stubBrowserApis);

  it("identifies the agreed employer account instead of the retained demo account", () => {
    renderSidebar();

    expect(screen.getByText("Tomás Ríos")).toBeInTheDocument();
    // The account summary carries the agreed role and employer as real text, so
    // the role is part of the trigger's accessible name.
    expect(screen.getByText("Talent Lead · Nexo Labs")).toBeInTheDocument();
    // The account fallback lives in the sidebar footer primitive and stays
    // coherent with the account name.
    expect(screen.getByText("TR")).toBeInTheDocument();

    expect(screen.queryByText("Camila Núñez")).toBeNull();
    expect(screen.queryByText("camila.nunez@nexolabs.com")).toBeNull();
    expect(screen.queryByText("CN")).toBeNull();
    expect(screen.queryByText("shadcn")).toBeNull();
    expect(screen.queryByText("m@example.com")).toBeNull();
  });

  it("binds the agreed employer identity from its account data source", () => {
    expect(source).toContain('name: "Tomás Ríos"');
    expect(source).toContain('email: "tomas.rios@nexolabs.mx"');
    expect(source).toContain('role: "Talent Lead"');
    expect(source).toContain('company: "Nexo Labs"');
    expect(source).not.toContain("Camila");
    expect(source).not.toContain("camila.nunez");
  });

  it("carries no stock avatar in the account data source", () => {
    // PDC-03: identity renders from initials only, so neither the field nor the
    // asset path may survive in the sidebar data.
    expect(source).not.toContain("/avatars");
    expect(source).not.toMatch(/\bavatar\b/i);
  });

  it("renders the initials fallback instead of an avatar image", () => {
    renderSidebar();

    expect(document.querySelectorAll("[data-slot='avatar-image']")).toHaveLength(0);
    // The only images left in the sidebar are the PeopleFlow wordmark marks.
    expect(
      document.querySelectorAll("img[src*='avatars']"),
    ).toHaveLength(0);

    const fallback = screen.getByText("TR");
    expect(fallback).toHaveAttribute("data-slot", "avatar-fallback");
    expect(fallback.className).toContain("bg-primary");
    expect(fallback.className).toContain("text-primary-foreground");
  });

  it("keeps the employer identity out of the PeopleFlow product brand slot", () => {
    renderSidebar();

    const brand = screen.getByRole("link", { name: "PeopleFlow" });
    expect(brand.textContent).not.toMatch(/Nexo|Tomás|Talent/);
  });
});
