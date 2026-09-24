import * as React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { IngresarMenu } from "@/components/navigation/IngresarMenu";

// The Base UI menu popup mounts through a floating-ui portal that jsdom cannot
// drive, so open/Escape/focus behavior is verified in the CCP-R7E browser
// contracts. This suite pins the closed trigger contract plus the primitive
// composition at the source boundary, matching the nav-user/data-table
// precedents already reviewed in this repository.
const source = readFileSync(
  join(process.cwd(), "src", "components", "navigation", "IngresarMenu.tsx"),
  "utf8",
);

// jsdom implements neither matchMedia nor ResizeObserver; the Base UI menu root
// reads both while it mounts.
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
}

function trigger() {
  return screen.getByRole("button", { name: /^ingresar$/i });
}

beforeEach(stubBrowserApis);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("IngresarMenu closed trigger", () => {
  it("renders one closed Ingresar button with menu semantics and no open popup", () => {
    render(<IngresarMenu />);

    expect(
      screen.getAllByRole("button", { name: /^ingresar$/i }),
    ).toHaveLength(1);
    const button = trigger();
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(
      document.querySelector('[data-slot="dropdown-menu-content"]'),
    ).toBeNull();
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
  });

  it("keeps a 40px minimum target carrying a single decorative icon", () => {
    render(<IngresarMenu />);

    const button = trigger();
    expect(button.className).toMatch(/min-h-10/);
    expect(button.querySelectorAll("svg")).toHaveLength(1);
  });

  it("applies the optional className to the trigger only", () => {
    render(<IngresarMenu className="h-11 px-5" />);

    expect(trigger()).toHaveClass("h-11", "px-5");
  });
});

describe("IngresarMenu side-effect boundary", () => {
  it("performs no fetch or storage access while rendering", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const getItem = vi.spyOn(Storage.prototype, "getItem");

    render(<IngresarMenu />);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
  });
});

describe("IngresarMenu destination contract", () => {
  it("routes each destination through Next Link on the shared menu item", () => {
    expect(source).toContain('from "next/link"');
    expect(source).toMatch(/render=\{<Link href="\/candidato\/login" \/>\}/);
    expect(source).toMatch(/render=\{<Link href="\/empresa\/login" \/>\}/);
    expect(source).not.toContain("next/navigation");
    expect(source).not.toContain("useRouter");
  });

  it("exposes exactly two unique entries under one Ingresar como label", () => {
    expect(source.match(/<DropdownMenuItem\b/g)).toHaveLength(2);
    expect(source.match(/href="\/candidato\/login"/g)).toHaveLength(1);
    expect(source.match(/href="\/empresa\/login"/g)).toHaveLength(1);
    expect(source.match(/Ingresar como/g)).toHaveLength(1);
    // Touch-friendly 40px entries, one per destination.
    expect(source.match(/"min-h-10"/g)).toHaveLength(2);
    expect(source).toMatch(
      /<DropdownMenuContent[\s\S]*?align="end"[\s\S]*?side="bottom"/,
    );
  });

  it("nests the Ingresar como label and both items inside one DropdownMenuGroup", () => {
    // Base UI group parts throw without a Group ancestor, so the label and both
    // destinations must live inside the single group, as nav-user already does.
    expect(source.match(/<DropdownMenuGroup\b/g)).toHaveLength(1);
    const group = source.match(/<DropdownMenuGroup>[\s\S]*?<\/DropdownMenuGroup>/)![0];
    // The entry-count test above pins both totals, so in-group counts prove
    // nothing was left outside the group.
    expect(group.match(/<DropdownMenuLabel\b/g)).toHaveLength(1);
    expect(group.match(/<DropdownMenuItem\b/g)).toHaveLength(2);
    expect(group).toContain('href="/candidato/login"');
    expect(group).toContain('href="/empresa/login"');
  });

  it("reuses the shared menu primitive and Button variants without a custom popup", () => {
    expect(source).toContain('from "@/components/ui/dropdown-menu"');
    expect(source).toContain('from "@/components/ui/button"');
    expect(source).toContain("<DropdownMenuTrigger");
    expect(source).toMatch(/render=\{<Button\b/);
    expect(source).toMatch(/variant="/);
    expect(source).not.toContain("@base-ui/react/menu");
    expect(source).not.toContain("@base-ui/react/popover");
    expect(source).not.toMatch(/\bfetch\(|localStorage|sessionStorage/);
  });
});
