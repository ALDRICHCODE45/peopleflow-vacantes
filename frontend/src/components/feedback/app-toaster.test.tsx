import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sileo } from "sileo";

import { AppToaster } from "@/components/feedback/app-toaster";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});
afterEach(() => {
  act(() => sileo.clear());
  cleanup();
  vi.unstubAllGlobals();
});

describe("application notifications", () => {
  it("mounts one inert host without firing notifications on mount", () => {
    const { container } = render(<AppToaster />);
    expect(container.querySelectorAll('[data-pf-toaster]')).toHaveLength(1);
    expect(container.querySelector('[data-sileo-toast]')).toBeNull();
  });

  it("renders an explicitly requested notification using the app surface token", async () => {
    const { container } = render(<AppToaster />);
    act(() => { sileo.success({ title: "Cambios confirmados", description: "Resultado de prueba." }); });
    expect(await screen.findByText("Cambios confirmados")).toBeInTheDocument();
    expect(screen.getByText("Resultado de prueba.")).toBeInTheDocument();
    expect(container.querySelector('[data-sileo-pill]')).toHaveAttribute("fill", "var(--popover)");
    expect(container.querySelector('[data-sileo-viewport]')).toHaveAttribute("data-position", "bottom-right");
    expect(container.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
  });
});

describe("toast placement styles", () => {
  // User: toasts covered the theme toggle at the top right. The viewport must be pinned to the
  // bottom (pinning `top` as well stretched it to full height and stacked toasts at the top),
  // and lifted above the vacancy editor's floating save bar so they never cover «Publicar».
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  const block = css.slice(css.indexOf("[data-pf-toaster] [data-sileo-viewport] {"), css.indexOf("}", css.indexOf("[data-pf-toaster] [data-sileo-viewport] {")));
  it("anchors the viewport to the bottom edge only", () => {
    expect(block).toContain("bottom: var(--pf-toast-bottom, env(safe-area-inset-bottom, 0px))");
    expect(block).toContain("right: var(--pf-toast-right, env(safe-area-inset-right, 0px))");
    expect(block).not.toMatch(/\btop:/);
  });
  it("stacks toasts above modal backdrops so errors raised with a dialog open stay readable", () => {
    expect(block).toMatch(/z-index: \d{3,};/);
  });
  it("lifts toasts above the editor's floating save bar", () => {
    expect(css).toMatch(/body:has\(\[data-pf-draft-save-bar\]\) \[data-pf-toaster\] \[data-sileo-viewport\] \{[^}]*bottom: var\(--pf-toast-bottom, calc\(env\(safe-area-inset-bottom, 0px\) \+ 6\.5rem\)\)/);
  });
});
