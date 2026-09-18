import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SiteHeader } from "./site-header";
import { SidebarProvider } from "./ui/sidebar";

// Vitest runs from frontend/, so cwd-relative paths keep the assertions stable.
const source = readFileSync(
  join(process.cwd(), "src/components/company-dashboard/site-header.tsx"),
  "utf8",
);

// jsdom implements neither matchMedia nor ResizeObserver; the sidebar trigger
// reads the first through `useIsMobile`, so it is stubbed to the desktop branch.
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

function renderHeader() {
  return render(
    <SidebarProvider>
      <SiteHeader />
    </SidebarProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("company dashboard header content", () => {
  beforeEach(stubBrowserApis);

  it("titles the page Dashboard", () => {
    renderHeader();

    const header = document.querySelector("header");
    expect(header).not.toBeNull();
    expect(
      within(header!).getByRole("heading", { level: 1 }),
    ).toHaveTextContent("Dashboard");
  });

  it("drops the GitHub demo action", () => {
    renderHeader();

    const header = document.querySelector("header")!;
    expect(within(header).queryByText(/github/i)).toBeNull();
    expect(within(header).queryAllByRole("link")).toHaveLength(0);
    expect(source).not.toMatch(/github/i);
  });

  it("keeps the sidebar trigger and its separator", () => {
    renderHeader();

    const header = document.querySelector("header")!;
    expect(
      within(header).getByRole("button", { name: /toggle sidebar/i }),
    ).toBeInTheDocument();
    expect(header.querySelector("[data-slot='separator']")).not.toBeNull();
  });

  it("preserves the approved header geometry", () => {
    renderHeader();

    const header = document.querySelector("header")!;
    const container = header.firstElementChild as HTMLElement;

    expect(header.className).toContain("h-(--header-height)");
    expect(header.className).toContain("border-b");
    expect(container.className).toContain("px-4");
    expect(container.className).toContain("lg:px-6");
  });
});

describe("company dashboard header theme control", () => {
  beforeEach(stubBrowserApis);

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.classList.remove("dark");
    for (const node of document.querySelectorAll("[data-pf-theme-suppression]")) {
      node.remove();
    }
  });

  it("keeps exactly one theme control inside the header", () => {
    renderHeader();

    const controls = document.querySelectorAll("[data-pf-theme-toggle]");
    expect(controls).toHaveLength(1);

    const header = document.querySelector("header")!;
    expect(header.contains(controls[0])).toBe(true);
    expect(
      within(header).getByRole("button", { name: "Cambiar tema" }),
    ).toBe(controls[0]);
  });

  it("keeps the control in the top-right group as its only member", () => {
    renderHeader();

    const toggle = screen.getByRole("button", { name: "Cambiar tema" });
    const group = toggle.parentElement;

    expect(group).not.toBeNull();
    expect(group!.className).toContain("ml-auto");
    expect(group!.className).toContain("items-center");
    expect(group!.children).toHaveLength(1);
  });

  it("stays a >=32px control available at every breakpoint", () => {
    renderHeader();

    const toggle = screen.getByRole("button", { name: "Cambiar tema" });

    expect(toggle.className).toMatch(/(^|\s)size-8(\s|$)/);
    expect(toggle.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    expect(toggle.className).not.toContain("sm:hidden");
  });

  it("drives the existing theme mechanism on click", async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByRole("button", { name: "Cambiar tema" }));

    expect(localStorage.getItem("pf-theme")).toBe("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(document.documentElement).toHaveClass("dark");
  });
});
