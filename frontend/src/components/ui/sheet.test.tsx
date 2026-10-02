import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "./sheet";

// jsdom implements neither matchMedia nor ResizeObserver; the Base UI dialog
// reads both. Stubbing them mirrors the committed employer-talent suite.
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
  vi.stubGlobal("innerWidth", 375);
}

type Side = "top" | "right" | "bottom" | "left";

function renderSheet(
  options: {
    side?: Side;
    presentation?: "floating" | "edge";
    className?: string;
  } = {},
) {
  return render(
    <Sheet open>
      <SheetContent
        side={options.side ?? "right"}
        presentation={options.presentation}
        className={options.className}
      >
        <SheetHeader>
          <SheetTitle>Detalle de la persona</SheetTitle>
          <SheetDescription>Contexto breve.</SheetDescription>
        </SheetHeader>
        <div data-testid="sheet-body">cuerpo desplazable</div>
        <SheetFooter>
          <SheetClose render={<button type="button">Cerrar</button>} />
        </SheetFooter>
      </SheetContent>
    </Sheet>,
  );
}

function panel(): HTMLElement {
  const node = document.querySelector<HTMLElement>("[data-slot='sheet-content']");
  expect(node, "sheet content panel").not.toBeNull();
  return node as HTMLElement;
}

const CLAMP_WIDTH = "max-w-[calc(100dvw-2*var(--sheet-inset))]";
const CLAMP_HEIGHT = "max-h-[calc(100dvh-2*var(--sheet-inset))]";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("shared Sheet floating presentation", () => {
  beforeEach(stubBrowserApis);

  it("defaults to a floating panel with an inset, rounded, clamped surface", () => {
    renderSheet();
    const content = panel();

    expect(content).toHaveAttribute("data-presentation", "floating");
    // 8px on mobile, 16px from the desktop breakpoint on.
    expect(content.className).toContain("[--sheet-inset:0.5rem]");
    expect(content.className).toContain("md:[--sheet-inset:1rem]");
    // Opposing insets determine the side height; `h-full` is gone.
    expect(content.className).toContain("data-[side=right]:inset-y-(--sheet-inset)");
    expect(content.className).toContain("data-[side=right]:right-(--sheet-inset)");
    expect(content.className).not.toContain("data-[side=right]:h-full");
    // The clamp is inset-adjusted against the dynamic viewport.
    expect(content.className).toContain(CLAMP_WIDTH);
    expect(content.className).toContain(CLAMP_HEIGHT);
    // Rounded, elevated and clipped so children never paint outside the radius.
    expect(content.className).toContain("rounded-2xl");
    expect(content.className).toContain("overflow-hidden");
    expect(content.className).toContain("shadow-lg");
  });

  it("keeps the explicit edge opt-out full-bleed and full-height", () => {
    renderSheet({ presentation: "edge" });
    const content = panel();

    expect(content).toHaveAttribute("data-presentation", "edge");
    expect(content.className).toContain("data-[side=right]:h-full");
    expect(content.className).toContain("data-[side=right]:inset-y-0");
    expect(content.className).toContain("data-[side=right]:right-0");
    expect(content.className).not.toContain("[--sheet-inset:0.5rem]");
    expect(content.className).not.toContain(CLAMP_WIDTH);
    // The edge presentation keeps the original elevated shadow.
    expect(content.className).toContain("shadow-xl");
  });

  it.each<Side>(["top", "right", "bottom", "left"])(
    "floats the %s side against the inset-adjusted viewport",
    (side) => {
      renderSheet({ side });
      const content = panel();

      if (side === "top") {
        expect(content.className).toContain("data-[side=top]:top-(--sheet-inset)");
        expect(content.className).toContain("data-[side=top]:inset-x-(--sheet-inset)");
      } else if (side === "bottom") {
        expect(content.className).toContain("data-[side=bottom]:bottom-(--sheet-inset)");
        expect(content.className).toContain("data-[side=bottom]:inset-x-(--sheet-inset)");
      } else {
        expect(content.className).toContain(`data-[side=${side}]:inset-y-(--sheet-inset)`);
      }
      expect(content.className).toContain(CLAMP_WIDTH);
      expect(content.className).toContain(CLAMP_HEIGHT);
    },
  );

  it("keeps the viewport clamp when a consumer passes w-full and its own max width", () => {
    renderSheet({ className: "w-full sm:max-w-2xl" });
    const content = panel();

    // `w-full` cannot defeat `max-w-*`, and the clamp survives the merge.
    expect(content.className).toContain("w-full");
    expect(content.className).toContain("sm:max-w-2xl");
    expect(content.className).toContain(CLAMP_WIDTH);
  });

  it("keeps header and footer fixed while the consumer body owns the scroll", () => {
    renderSheet();
    const content = panel();
    const header = document.querySelector<HTMLElement>("[data-slot='sheet-header']");
    const footer = document.querySelector<HTMLElement>("[data-slot='sheet-footer']");

    expect(header).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(header!.className).toContain("shrink-0");
    expect(footer!.className).toContain("shrink-0");
    // The panel is a column that can shrink, so `flex-1` bodies scroll.
    expect(content.className).toContain("min-h-0");
    expect(content.className).toContain("flex-col");
  });

  it("keeps the floating panel a named dialog with an accessible close", () => {
    renderSheet();

    expect(
      screen.getByRole("dialog", { name: "Detalle de la persona" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
  });
});
