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
