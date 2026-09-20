import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PrototypeFeedbackButton } from "./prototype-feedback-island";

/** The shipped source, so the boundary checks read the bytes that ship. */
const source = readFileSync(join(process.cwd(), "src/features/jobs/components/prototype-feedback-island.tsx"), "utf8");
/** Parent-owned classes: the island keeps them and extends them. */
const CLASS = "inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-semibold transition-colors duration-150";
const TOGGLE = { mode: "toggle", icon: "bookmark", label: "Guardar vacante (solo demostración)", activeLabel: "Guardar vacante (marcada solo en esta demostración)", activeFeedback: "Guardado de demostración activado: no se guardó nada real.", inactiveFeedback: "Guardado de demostración desactivado: no se modificó nada real.", text: "Guardar", className: CLASS } as const;
const MOMENTARY = { mode: "momentary", icon: "apply", label: "Postularme (solo demostración)", feedback: "Postulación de demostración: no se envió ninguna postulación real.", text: "Postularme", className: CLASS } as const;
/** Any literal paint would break the token-only contract. */
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|color-mix)\(/u;
const button = () => screen.getByRole("button");
const status = () => screen.getByRole("status");

// Every test leaves the timer mocks and the document exactly as it found them.
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("PrototypeFeedbackButton island boundary", () => {
  it("stays one client module that reaches no network, storage, or browser share API", () => {
    expect(source.startsWith('"use client";')).toBe(true);
    for (const forbidden of ["fetch(", "XMLHttpRequest", "localStorage", "sessionStorage", "indexedDB", "navigator", "clipboard", "window.", "location", "mailto:", "document.cookie", "dangerouslySetInnerHTML", "Math.random", "new Date"]) expect(source).not.toContain(forbidden);
    expect([source.includes("lucide-react"), /style=\{\{/u.test(source)]).toEqual([true, false]);
  });

  it("renders one hidden, empty live region as the control's sibling", () => {
    const { container } = render(<PrototypeFeedbackButton {...MOMENTARY} />);
    const region = status();
    expect([region.tagName, region.getAttribute("aria-live"), region.className, region.textContent]).toEqual(["SPAN", "polite", "sr-only", ""]);
    expect([region.previousElementSibling === button(), container.querySelectorAll("[style]").length]).toEqual([true, 0]);
  });

  it("maps the icon enum internally and keeps icon-only and text controls serializable", () => {
    const { container } = render(
      <>
        <PrototypeFeedbackButton {...MOMENTARY} icon="copy" iconOnly iconClassName="size-[18px]" describedBy="proceso-prototipo" />
        <PrototypeFeedbackButton {...MOMENTARY} iconPosition="end" />
        <PrototypeFeedbackButton {...MOMENTARY} />
      </>,
    );
    const order = (control: HTMLElement) => Array.from(control.childNodes).map((node) => node.nodeName).join("|");
    const [iconOnly, withText, leading] = screen.getAllByRole("button");
    expect([container.querySelectorAll("img").length, container.querySelectorAll("svg").length, [iconOnly, withText, leading].map(order)]).toEqual([0, 3, ["svg", "#text|svg", "svg|#text"]]);
    expect([iconOnly.textContent, iconOnly.querySelector("svg")?.getAttribute("aria-hidden"), iconOnly.querySelector("svg")?.classList.contains("size-[18px]")]).toEqual(["", "true", true]);
    expect([iconOnly.getAttribute("aria-label"), iconOnly.getAttribute("aria-describedby"), iconOnly.getAttribute("title")]).toEqual([MOMENTARY.label, "proceso-prototipo", MOMENTARY.label]);
    expect([withText.textContent, leading.textContent, leading.querySelector("svg")?.classList.contains("size-4")]).toEqual(["Postularme", "Postularme", true]);
  });
});

describe("PrototypeFeedbackButton toggle state", () => {
  it("round-trips the pressed state, name, feedback, keyboard activation, and remount", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<PrototypeFeedbackButton {...TOGGLE} />);
    expect([button().getAttribute("aria-pressed"), button().getAttribute("aria-label"), button().getAttribute("title"), status().textContent]).toEqual(["false", TOGGLE.label, TOGGLE.label, ""]);
    await user.click(button());
    expect([button().getAttribute("aria-pressed"), button().getAttribute("aria-label"), button().textContent, status().textContent]).toEqual(["true", TOGGLE.activeLabel, "Guardar", TOGGLE.activeFeedback]);
    await user.click(button());
    expect([button().getAttribute("aria-pressed"), button().getAttribute("aria-label"), status().textContent]).toEqual(["false", TOGGLE.label, TOGGLE.inactiveFeedback]);
    await user.keyboard("{Enter}");
    expect(button()).toHaveAttribute("aria-pressed", "true");
    await user.keyboard(" ");
    expect(button()).toHaveAttribute("aria-pressed", "false");
    unmount();
    render(<PrototypeFeedbackButton {...TOGGLE} />);
    expect([button().getAttribute("aria-pressed"), status().textContent]).toEqual(["false", ""]);
  });
});

describe("PrototypeFeedbackButton momentary state", () => {
  it("stays unpressed, re-arms on repeat, replaces the announced node, and clears on unmount", () => {
    vi.useFakeTimers();
    const { unmount } = render(<PrototypeFeedbackButton {...MOMENTARY} />);
    expect([button().matches(":enabled"), button().getAttribute("aria-pressed")]).toEqual([true, null]);
    fireEvent.click(button());
    const first = status().firstElementChild;
    act(() => { vi.advanceTimersByTime(2000); });
    fireEvent.click(button());
    expect([status().textContent, status().firstElementChild === first]).toEqual([MOMENTARY.feedback, false]);
    act(() => { vi.advanceTimersByTime(2499); });
    expect(status().textContent).toBe(MOMENTARY.feedback);
    act(() => { vi.advanceTimersByTime(1); });
    expect(status()).toBeEmptyDOMElement();
    fireEvent.click(button());
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("PrototypeFeedbackButton token and motion contract", () => {
  it("keeps the parent geometry, the token layer, and a guarded press feedback", () => {
    const { container } = render(<PrototypeFeedbackButton {...TOGGLE} />);
    const { className } = button();
    for (const utility of ["min-h-11", "rounded-xl", "border-border", "bg-background", "px-4", "text-sm", "font-semibold"]) expect(className).toContain(utility);
    expect([className.includes("active:scale-[0.96]"), className.includes("motion-safe:active:scale-[0.96]"), className.includes("motion-reduce:active:scale-100"), className.includes("motion-reduce:transition-none"), className.includes("transition-colors")]).toEqual([true, true, true, true, false]);
    expect([container.querySelectorAll("[style]").length, RAW_COLOR.test(className)]).toEqual([0, false]);
  });
});
