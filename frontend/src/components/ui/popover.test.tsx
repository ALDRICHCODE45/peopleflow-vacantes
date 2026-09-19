import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import * as PopoverModule from "./popover";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "./popover";
import { Button } from "./button";

function popoverSource(): string {
  return readFileSync(
    join(process.cwd(), "src", "components", "ui", "popover.tsx"),
    "utf8",
  );
}

// jsdom implements neither matchMedia nor ResizeObserver, both of which the
// Base UI positioner reads while it anchors the portalled popup.
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

beforeEach(() => {
  stubBrowserApis();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * The documented Date Picker composition: a `Button` supplied through the Base
 * UI `render` prop owns the trigger markup, and the portalled content carries
 * the official header/title/description parts plus one focusable day control.
 */
function renderDatePopover(contentProps: { className?: string } = {}) {
  const view = render(
    <Popover>
      <PopoverTrigger render={<Button variant="outline">Elegir fecha</Button>} />
      <PopoverContent {...contentProps}>
        <PopoverHeader>
          <PopoverTitle>Fecha de cierre</PopoverTitle>
          <PopoverDescription>Elegí una fecha de cierre.</PopoverDescription>
        </PopoverHeader>
        <button type="button">Elegir hoy</button>
      </PopoverContent>
    </Popover>,
  );

  return {
    container: view.container,
    trigger: screen.getByRole("button", { name: "Elegir fecha" }),
  };
}

/** Opens the popover through its rendered trigger and returns the dialog. */
function openByTrigger(trigger: HTMLElement): HTMLElement {
  trigger.focus();
  fireEvent.click(trigger);
  return screen.getByRole("dialog");
}

/** Dismisses the popover so it is unmounted before the test ends. */
function closeByEscape() {
  fireEvent.keyDown(document.activeElement ?? document.body, {
    key: "Escape",
  });
}

describe("Popover primitive surface", () => {
  it("exports the official Base UI popover parts", () => {
    expect(Object.keys(PopoverModule).sort()).toEqual(
      [
        "Popover",
        "PopoverContent",
        "PopoverDescription",
        "PopoverHeader",
        "PopoverTitle",
        "PopoverTrigger",
      ].sort(),
    );
  });

  it("builds on the official Base UI popover primitive and the local cn helper", () => {
    const source = popoverSource();
    const sources = [...source.matchAll(/from\s+"([^"]+)"/gu)].map(
      (match) => match[1],
    );

    expect(sources).toContain("@base-ui/react/popover");
    expect(sources).toContain("@/lib/utils");
    // The registry item imports `cn` from its own package; this project keeps
    // the existing `@/lib/utils` helper instead of adding that dependency.
    expect(sources).not.toContain("cn");
    expect(source).not.toMatch(/@radix-ui|asChild/u);

    // Base UI owns the portal, the positioning, and the popup element.
    for (const part of ["Root", "Trigger", "Portal", "Positioner", "Popup"]) {
      expect(source).toContain(`PopoverPrimitive.${part}`);
    }
    for (const slot of [
      "popover",
      "popover-trigger",
      "popover-content",
      "popover-header",
      "popover-title",
      "popover-description",
    ]) {
      expect(source).toContain(`data-slot="${slot}"`);
    }
  });
});

describe("Popover documented render composition", () => {
  it("opens, exposes its relationship, merges classes, and restores focus", async () => {
    const { container, trigger } = renderDatePopover({
      className: "w-96 max-w-sm",
    });

    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAttribute("type", "button");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog")).toBeNull();

    const dialog = openByTrigger(trigger);
    expect(screen.getByRole("dialog", { name: "Fecha de cierre" })).toBe(dialog);
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("data-popup-open");
    expect(dialog).toHaveAttribute("id");
    expect(trigger).toHaveAttribute("aria-controls", dialog.getAttribute("id"));

    const title = document.querySelector('[data-slot="popover-title"]');
    const description = document.querySelector(
      '[data-slot="popover-description"]',
    );
    expect(dialog).toHaveAttribute("aria-labelledby", title?.getAttribute("id"));
    expect(dialog).toHaveAttribute(
      "aria-describedby",
      description?.getAttribute("id"),
    );
    expect(dialog).toHaveClass("bg-popover", "rounded-3xl", "flex-col", "p-4");
    expect(dialog).toHaveClass("w-96", "max-w-sm");
    expect(dialog).not.toHaveClass("w-72");

    const dayControl = screen.getByRole("button", { name: "Elegir hoy" });
    dayControl.focus();
    expect(dayControl).toHaveFocus();
    closeByEscape();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).not.toHaveAttribute("data-popup-open");
    await Promise.resolve();
    expect(trigger).toHaveFocus();
  });
});
