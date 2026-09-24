import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import { ThemeToggle } from "./theme-toggle";

type ChangeListener = (event: { matches: boolean }) => void;

function stubMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<ChangeListener>();
  const media = {
    get matches() {
      return matches;
    },
    addEventListener: vi.fn((_type: string, listener: ChangeListener) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: string, listener: ChangeListener) => {
      listeners.delete(listener);
    }),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => media),
  );
  return {
    media,
    emit(next: boolean) {
      matches = next;
      for (const listener of listeners) listener({ matches });
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.classList.remove("dark");
});

describe("ThemeToggle", () => {
  it("renders a keyboard-focusable control with an accessible name", () => {
    stubMatchMedia(true);
    render(<ThemeToggle />);

    const button = screen.getByRole("button", { name: /cambiar tema/i });
    expect(button).toHaveAttribute("data-pf-theme-toggle");
  });

  it("defaults to the shared 40x40 hit target", () => {
    stubMatchMedia(true);
    render(<ThemeToggle />);

    const button = screen.getByRole("button", { name: /cambiar tema/i });
    expect(button.className).toContain("size-10");
    // The shared Button icon default (size-8) must not survive the override.
    expect(button.className).not.toContain("size-8");
  });

  it("lets an explicit caller size override the 40px default", () => {
    stubMatchMedia(true);
    render(<ThemeToggle className="size-11" />);

    const button = screen.getByRole("button", { name: /cambiar tema/i });
    expect(button.className).toContain("size-11");
    expect(button.className).not.toContain("size-10");
  });

  it("renders the CSS-driven icon contract for both themes and system", () => {
    stubMatchMedia(true);
    const { container } = render(<ThemeToggle />);

    // All three icons are always in the DOM; globals.css decides visibility
    // from the resolved theme, so markup never depends on browser state.
    expect(container.querySelector("svg.pf-icon-sun")).not.toBeNull();
    expect(container.querySelector("svg.pf-icon-moon")).not.toBeNull();
    expect(container.querySelector("svg.pf-icon-system")).not.toBeNull();
  });

  it("renders identical markup regardless of stored or system state", () => {
    // Server render cannot know browser state; the first client render must
    // not either, or hydration mismatches. A stored dark choice plus a dark
    // OS preference must produce the same markup as an empty store.
    stubMatchMedia(true);
    localStorage.setItem("pf-theme", "dark");
    const stored = render(<ThemeToggle />);
    const storedMarkup = stored.container.innerHTML;
    stored.unmount();

    localStorage.clear();
    const fresh = render(<ThemeToggle />);
    expect(fresh.container.innerHTML).toBe(storedMarkup);
  });

  it("applies and persists the opposite of the resolved system theme on first click", async () => {
    const user = userEvent.setup();
    stubMatchMedia(true); // OS prefers dark
    document.documentElement.classList.add("dark");
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: /cambiar tema/i }));

    expect(localStorage.getItem("pf-theme")).toBe("light");
    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("persists light and removes dark class when toggling from dark effective on dark OS", async () => {
    const user = userEvent.setup();
    stubMatchMedia(true); // OS prefers dark
    document.documentElement.classList.add("dark");
    document.documentElement.setAttribute("data-theme", "dark");
    localStorage.setItem("pf-theme", "dark"); // Manual dark preference
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: /cambiar tema/i }));

    // Binary toggle: dark → light, NO system intermediate
    expect(localStorage.getItem("pf-theme")).toBe("light");
    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("alternates light and dark across repeated clicks (binary toggle)", async () => {
    const user = userEvent.setup();
    stubMatchMedia(false); // OS prefers light; first click goes to dark
    render(<ThemeToggle />);

    // First click: system → dark
    await user.click(screen.getByRole("button", { name: /cambiar tema/i }));
    expect(localStorage.getItem("pf-theme")).toBe("dark");
    expect(document.documentElement).toHaveClass("dark");

    // Second click: dark → light
    await user.click(screen.getByRole("button", { name: /cambiar tema/i }));
    expect(localStorage.getItem("pf-theme")).toBe("light");
    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");

    // Third click: light → dark
    await user.click(screen.getByRole("button", { name: /cambiar tema/i }));
    expect(localStorage.getItem("pf-theme")).toBe("dark");
    expect(document.documentElement).toHaveClass("dark");

    // Fourth click: dark → light (cycle continues)
    await user.click(screen.getByRole("button", { name: /cambiar tema/i }));
    expect(localStorage.getItem("pf-theme")).toBe("light");
    expect(document.documentElement).not.toHaveClass("dark");
  });

  it("follows live OS preference changes while in system mode", () => {
    const stub = stubMatchMedia(false);
    // System mode holds no explicit choice; the control must keep the
    // document in sync when the OS preference flips, without persisting it.
    localStorage.removeItem("pf-theme");
    render(<ThemeToggle />);

    stub.emit(true);
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(localStorage.getItem("pf-theme")).toBeNull();

    stub.emit(false);
    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });
});
