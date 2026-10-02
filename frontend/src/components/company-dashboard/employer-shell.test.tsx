import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import { EmployerShell } from "./employer-shell";
import { SidebarTrigger } from "./ui/sidebar";

// jsdom implements neither matchMedia nor ResizeObserver; the sidebar reads the
// first through `useIsMobile`, so both are stubbed to the requested branch.
function stubBrowserApis(innerWidth = 1280) {
  vi.stubGlobal("matchMedia", () => ({
    matches: false, media: "", onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: () => false,
  }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("innerWidth", innerWidth);
}

const sidebar = () => document.querySelector("[data-slot='sidebar']") as HTMLElement;
const cookie = (name: string) =>
  document.cookie.split("; ").find((e) => e.startsWith(`${name}=`))?.split("=")[1];

// Route headers own the trigger; rendering one here mirrors that composition.
function renderShell(defaultOpen?: boolean, innerWidth = 1280) {
  stubBrowserApis(innerWidth);
  return render(
    <EmployerShell defaultOpen={defaultOpen}>
      <SidebarTrigger />
      <p>contenido de la ruta</p>
    </EmployerShell>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.cookie = "sidebar_state=; max-age=0; path=/";
});

describe("EmployerShell shared employer frame", () => {
  it("toggles the single committed frame with the route trigger and persists the cookie", async () => {
    const user = userEvent.setup();
    renderShell();
    // One provider frame around the committed inset sidebar and route content.
    expect(document.querySelectorAll("[data-slot='sidebar-wrapper']")).toHaveLength(1);
    expect(sidebar()).toHaveAttribute("data-variant", "inset");
    expect(document.querySelector("[data-slot='sidebar-inset']")).not.toBeNull();
    expect(screen.getByText("contenido de la ruta")).toBeInTheDocument();
    expect(sidebar()).toHaveAttribute("data-state", "expanded");

    await user.click(screen.getByRole("button", { name: /toggle sidebar/i }));
    expect(sidebar()).toHaveAttribute("data-state", "collapsed");
    // The desktop rail collapses to icons instead of sliding off canvas.
    expect(sidebar()).toHaveAttribute("data-collapsible", "icon");
    expect(cookie("sidebar_state")).toBe("false");

    await user.click(screen.getByRole("button", { name: /toggle sidebar/i }));
    expect(sidebar()).toHaveAttribute("data-state", "expanded");
    expect(cookie("sidebar_state")).toBe("true");
  });

  it("honors the server-derived collapsed preference without touching the cookie", () => {
    renderShell(false);
    expect(sidebar()).toHaveAttribute("data-state", "collapsed");
    expect(cookie("sidebar_state")).toBeUndefined();
  });

  it("keeps icon-collapsed controls accessible by name and tooltip", () => {
    renderShell(false);
    const dashboard = screen.getByRole("link", { name: "Dashboard" });
    // The label stays in the accessibility tree, so the icon keeps the name.
    expect(dashboard).toHaveAccessibleName("Dashboard");
    expect(sidebar()).toHaveAttribute("data-collapsible", "icon");
    // Bound to a real Base UI tooltip trigger: the collapsed affordance for the
    // hidden label. jsdom cannot open a floating tooltip, so the binding is the
    // verifiable DOM contract here.
    expect(dashboard).toHaveAttribute("data-base-ui-tooltip-trigger");
  });

  it("opens and closes the mobile drawer without mutating the desktop cookie", async () => {
    const user = userEvent.setup();
    renderShell(undefined, 375);
    await user.click(screen.getByRole("button", { name: /toggle sidebar/i }));
    const drawer = await screen.findByRole("dialog");
    expect(drawer).toHaveAccessibleName("Navegación");
    expect(cookie("sidebar_state")).toBeUndefined();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(cookie("sidebar_state")).toBeUndefined();
  });

  it("keeps the mobile drawer on the edge presentation with its 18rem width", async () => {
    const user = userEvent.setup();
    renderShell(undefined, 375);
    await user.click(screen.getByRole("button", { name: /toggle sidebar/i }));
    const drawer = await screen.findByRole("dialog");

    // The navigation drawer owns its own frame: the shared floating sheet
    // default would inset it and shrink the committed 18rem rail.
    expect(drawer).toHaveAttribute("data-presentation", "edge");
    expect(drawer.style.getPropertyValue("--sidebar-width")).toBe("18rem");
    expect(drawer.className).toContain("data-[side=left]:h-full");
    expect(drawer.className).not.toContain("[--sheet-inset:0.5rem]");
    expect(drawer.className).not.toContain(
      "max-w-[calc(100dvw-2*var(--sheet-inset))]",
    );
  });

  it("clips horizontal overflow on the shared inset without a nested scroll boundary", () => {
    renderShell();
    const inset = document.querySelector("[data-slot='sidebar-inset']") as HTMLElement;
    expect(inset).not.toBeNull();
    // `overflow-x-clip` contains wide route content in the shared frame without
    // adding a scroll container; `overflow-x-hidden` would instead create a
    // nested horizontal scrolling boundary inside the inset.
    expect(inset.className).toContain("overflow-x-clip");
    expect(inset.className).not.toContain("overflow-x-hidden");
  });

  it("keeps the Ctrl/Meta+B desktop shortcut from the primitive", async () => {
    const user = userEvent.setup();
    renderShell();
    expect(sidebar()).toHaveAttribute("data-state", "expanded");
    await user.keyboard("{Control>}b{/Control}");
    expect(sidebar()).toHaveAttribute("data-state", "collapsed");
    await user.keyboard("{Meta>}b{/Meta}");
    expect(sidebar()).toHaveAttribute("data-state", "expanded");
  });
});
