import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Route awareness comes from the App Router pathname hook; the suite drives it
// directly so the sidebar marks the talent destination active without a router.
const { pathnameMock } = vi.hoisted(() => ({
  pathnameMock: vi.fn<() => string | null>(() => "/empresa/talento"),
}));
vi.mock("next/navigation", () => ({ usePathname: () => pathnameMock() }));

import { EmployerShell } from "@/components/company-dashboard/employer-shell";

import PageContent, { metadata } from "./page";

// Mirrors the (empresa) layout: the shell wraps the route content.
function Page() {
  return (
    <EmployerShell>
      <PageContent />
    </EmployerShell>
  );
}

const pagePath = join(
  process.cwd(),
  "src/app/(empresa)/empresa/talento/page.tsx",
);
const pageSource = existsSync(pagePath) ? readFileSync(pagePath, "utf8") : "";

// jsdom implements neither matchMedia nor ResizeObserver; the sidebar and the
// route header theme control both read the media query, so it is stubbed.
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
      dispatchEvent: () => false,
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("/empresa/talento employer route", () => {
  beforeEach(stubBrowserApis);

  it("declares its own truthful Spanish route metadata", () => {
    expect(metadata.title).toBe("Base de talento");
  });

  it("reuses the shared employer shell with the talent destination active", () => {
    render(<Page />);

    expect(
      document.querySelectorAll("[data-slot='sidebar-wrapper']"),
    ).toHaveLength(1);
    const link = screen.getByRole("link", { name: "Base de talento" });
    expect(link).toHaveAttribute("href", "/empresa/talento");
    expect(link).toHaveAttribute("data-active");

    // The inert `Candidatos` placeholder is gone.
    expect(screen.queryByRole("button", { name: "Candidatos" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Candidatos" })).toBeNull();
  });

  it("renders the shared header with the route title and shell controls", () => {
    render(<Page />);

    const header = document.querySelector("header") as HTMLElement;
    expect(header).not.toBeNull();
    expect(within(header).getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(within(header).getByRole("heading", { level: 1 })).toHaveTextContent(
      "Base de talento",
    );
    expect(
      within(header).getByRole("button", { name: /toggle sidebar/i }),
    ).toBeInTheDocument();
    expect(
      within(header).getByRole("button", { name: "Cambiar tema" }),
    ).toBeInTheDocument();
    expect(header.querySelector("[aria-label='Ruta de navegación']")).toBeNull();
  });

  it("names the workspace with a real H2 under the single H1", () => {
    render(<Page />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Explora tu base de talento",
      }),
    ).toBeVisible();
  });

  it("mounts one workspace inside the single padded page-content wrapper", () => {
    const { container } = render(<Page />);
    const content = container.querySelector(
      "[data-pf-talento-content]",
    ) as HTMLElement;

    expect(content).not.toBeNull();
    expect(content.hasAttribute("data-pf-page-content")).toBe(true);
    for (const token of ["mx-auto", "w-full", "max-w-screen-2xl"]) {
      expect(content.className).toContain(token);
    }
    expect(content.className).toContain("px-4");
    expect(content.className).toContain("py-4");
    expect(content.className).toContain("md:py-6");
    expect(content.className).toContain("lg:px-6");

    const workspaces = document.querySelectorAll("[data-pf-talento-workspace]");
    expect(workspaces).toHaveLength(1);
    expect(content.contains(workspaces[0])).toBe(true);
    // One padding owner: the workspace adds no second page-level inset.
    expect((workspaces[0] as HTMLElement).className).not.toContain("px-4");
  });
});

describe("/empresa/talento composition boundary", () => {
  it("mounts the shared header, the page-content wrapper and the workspace", () => {
    expect(pageSource).toContain('<SiteHeader title="Base de talento" />');
    expect(pageSource).toContain("<TalentWorkspace");
    expect(pageSource).toContain("<DashboardPageContent");
  });

  it("stays a server component", () => {
    expect(pageSource).not.toContain('"use client"');
    expect(pageSource).not.toContain("use client");
  });

  it("declares no request, credential or client-state concern", () => {
    for (const forbidden of [
      "fetch(",
      "lib/api",
      "QueryClient",
      "useRouter",
      "useState",
      "useEffect",
      "Authorization",
      "Bearer",
      "localStorage",
      "sessionStorage",
      "cookies",
    ]) {
      expect(pageSource, `page.tsx must not declare ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  it("never imports or mounts a second employer shell", () => {
    expect(pageSource).not.toMatch(/<EmployerShell\b/u);
    expect(pageSource).not.toMatch(/<SidebarProvider\b/u);
    expect(pageSource).not.toContain("company-dashboard/employer-shell");
    expect(pageSource).not.toContain("company-dashboard/ui/sidebar");
  });

  it("declares no theme module or raw color", () => {
    expect(pageSource).not.toContain("dashboard-01-theme.module.css");
    expect(pageSource).not.toMatch(/oklch\(|#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });

  it("reuses the agreed feature entry points", () => {
    for (const reuse of [
      'from "@/components/company-dashboard/site-header"',
      'from "@/components/dashboard-page-content"',
      'from "@/features/employer-talent/talent-workspace"',
    ]) {
      expect(pageSource, `page.tsx must reuse ${reuse}`).toContain(reuse);
    }
  });
});
