import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SidebarProvider } from "@/components/company-dashboard/ui/sidebar";

import { CreateVacancyHeader } from "./CreateVacancyHeader";

// Vitest runs from frontend/, so cwd-relative paths keep the assertions stable.
const source = readFileSync(
  join(process.cwd(), "src/features/jobs/create/CreateVacancyHeader.tsx"),
  "utf8",
);

// jsdom implements neither matchMedia nor ResizeObserver; the header mounts the
// sidebar trigger, whose provider reads the first through `useIsMobile`.
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

/** The header only exists inside the shell provider it is mounted in. */
function renderHeader() {
  return render(
    <SidebarProvider>
      <CreateVacancyHeader />
    </SidebarProvider>,
  );
}

function header(): HTMLElement {
  const element = document.querySelector("header");
  expect(element, "route header").not.toBeNull();
  return element as HTMLElement;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("create-vacancy route header", () => {
  beforeEach(stubBrowserApis);

  it("names the screen with exactly one level-one heading", () => {
    renderHeader();

    const headings = within(header()).getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Nueva vacante");

    // One page title, not one per mounted surface.
    expect(document.querySelectorAll("h1")).toHaveLength(1);
  });

  it("carries the employer context trail without linking to it", () => {
    renderHeader();

    const trail = within(header()).getByRole("navigation", {
      name: "Ruta de navegación",
    });

    // The decorative separator is hidden from assistive technology, so only the
    // two context steps are exposed as list items.
    const items = within(trail).getAllByRole("listitem");
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      "Vacantes",
      "Nueva vacante",
    ]);
    expect(items[1]).toHaveAttribute("aria-current", "page");

    // The full trail still renders as visible copy: "Vacantes / Nueva vacante".
    expect(trail).toHaveTextContent(/Vacantes\s*\/\s*Nueva vacante/);

    // The employer vacancies list is not implemented, so the trail is text: the
    // current screen is the only item, and nothing here is a destination.
    expect(within(trail).queryAllByRole("link")).toHaveLength(0);
    expect(trail.querySelectorAll("a")).toHaveLength(0);
  });

  it("advertises no unimplemented employer vacancies destination", () => {
    renderHeader();

    expect(within(header()).queryAllByRole("link")).toHaveLength(0);
    expect(header().querySelectorAll("a")).toHaveLength(0);
    expect(header().outerHTML).not.toMatch(/href="[^"]*empresa\/vacantes/);
  });

  it("reuses the committed sidebar trigger and theme control", () => {
    renderHeader();

    const trigger = within(header()).getByRole("button", {
      name: /toggle sidebar/i,
    });
    expect(trigger).toHaveAttribute("data-slot", "sidebar-trigger");

    const toggles = header().querySelectorAll("[data-pf-theme-toggle]");
    expect(toggles).toHaveLength(1);
    expect(within(header()).getByRole("button", { name: "Cambiar tema" })).toBe(
      toggles[0],
    );
  });

  it("keeps the committed header frame and top-right control position", () => {
    renderHeader();

    expect(header().className).toContain("h-(--header-height)");
    expect(header().className).toContain("border-b");

    const container = header().firstElementChild as HTMLElement;
    expect(container.className).toContain("px-4");
    expect(container.className).toContain("lg:px-6");

    const toggle = screen.getByRole("button", { name: "Cambiar tema" });
    const group = toggle.parentElement;
    expect(group).not.toBeNull();
    expect(group!.className).toContain("ml-auto");
    expect(group!.className).toContain("items-center");
    expect(group!.children).toHaveLength(1);
  });

  it("declares no client directive, navigation or session concern", () => {
    expect(source).not.toContain('"use client"');
    for (const forbidden of [
      "useRouter",
      "next/navigation",
      "localStorage",
      "session",
      "token",
      "fetch(",
    ]) {
      expect(
        source,
        `CreateVacancyHeader.tsx must not declare ${forbidden}`,
      ).not.toContain(forbidden);
    }

    // It composes the committed shell primitives instead of re-implementing them.
    expect(source).toContain(
      'from "@/components/company-dashboard/ui/sidebar"',
    );
    expect(source).toContain(
      'from "@/components/theme/theme-toggle"',
    );
  });
});
