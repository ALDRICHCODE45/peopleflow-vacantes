import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PrototypeFeedbackButton } from "./prototype-feedback-island";

/** The shipped source, so the boundary checks read the bytes that ship. */
const source = readFileSync(join(process.cwd(), "src/features/jobs/components/prototype-feedback-island.tsx"), "utf8");
/** Parent-owned classes: the renderer keeps them and extends them. */
const CLASS = "inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-semibold transition-colors duration-150";
const WITH_TEXT = { icon: "bookmark", label: "Guardar vacante", text: "Guardar", className: CLASS } as const;
const ICON_ONLY = { icon: "copy", label: "Copiar enlace", className: CLASS, iconOnly: true, iconClassName: "size-[18px]" } as const;
/** Any literal paint would break the token-only contract. */
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|color-mix)\(/u;
const button = () => screen.getByRole("button");

// Every test leaves the globals and the document exactly as it found them.
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("PrototypeFeedbackButton inert boundary", () => {
  it("stays an inert module that reaches no state, network, storage, timer, or browser share API", () => {
    // No client directive survives: the renderer owns no client behavior.
    expect(source).not.toMatch(/["']use client["']/u);
    for (const forbidden of ["useState", "useEffect", "useRef", "onClick", "onKeyDown", "setTimeout", "role=\"status\"", "aria-pressed", "fetch(", "XMLHttpRequest", "localStorage", "sessionStorage", "indexedDB", "navigator", "clipboard", "window.", "location", "mailto:", "document.cookie", "dangerouslySetInnerHTML", "Math.random", "new Date"])
      expect(source).not.toContain(forbidden);
    expect([source.includes("lucide-react"), /style=\{\{/u.test(source)]).toEqual([true, false]);
  });

  it("renders one enabled native button with a label and no status or pressed state", () => {
    const { container } = render(<PrototypeFeedbackButton {...WITH_TEXT} />);
    const control = button();
    expect([control.tagName, control.getAttribute("type"), control.matches(":enabled"), control.getAttribute("aria-label"), control.getAttribute("title")]).toEqual(["BUTTON", "button", true, WITH_TEXT.label, WITH_TEXT.label]);
    expect([control.getAttribute("aria-pressed"), control.getAttribute("aria-disabled"), control.getAttributeNames().some((name) => name.startsWith("on"))]).toEqual([null, null, false]);
    expect([container.querySelector("[role='status']"), container.querySelector("[role='note']"), container.querySelectorAll("[style]").length]).toEqual([null, null, 0]);
    expect(container.textContent).toBe("Guardar");
  });

  it("maps the icon enum internally and keeps icon-only and text controls serializable", () => {
    const { container } = render(
      <>
        <PrototypeFeedbackButton {...ICON_ONLY} />
        <PrototypeFeedbackButton {...WITH_TEXT} iconPosition="end" />
        <PrototypeFeedbackButton {...WITH_TEXT} />
      </>,
    );
    const order = (control: HTMLElement) => Array.from(control.childNodes).map((node) => node.nodeName).join("|");
    const [iconOnly, withText, leading] = screen.getAllByRole("button");
    expect([container.querySelectorAll("img").length, container.querySelectorAll("svg").length, [iconOnly, withText, leading].map(order)]).toEqual([0, 3, ["svg", "#text|svg", "svg|#text"]]);
    expect([iconOnly.textContent, iconOnly.querySelector("svg")?.getAttribute("aria-hidden"), iconOnly.querySelector("svg")?.classList.contains("size-[18px]")]).toEqual(["", "true", true]);
    expect([iconOnly.getAttribute("aria-label"), iconOnly.getAttribute("aria-describedby")]).toEqual([ICON_ONLY.label, null]);
    expect([withText.textContent, leading.textContent, leading.querySelector("svg")?.classList.contains("size-4")]).toEqual(["Guardar", "Guardar", true]);
  });
});

describe("PrototypeFeedbackButton inert activation", () => {
  it("keeps pointer and keyboard activation free of label, pressed, and feedback changes", async () => {
    const user = userEvent.setup();
    const before = window.location.href;
    const { container } = render(<PrototypeFeedbackButton {...WITH_TEXT} />);
    const control = button();
    await user.click(control);
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect([control.getAttribute("aria-label"), control.getAttribute("aria-pressed"), control.textContent]).toEqual([WITH_TEXT.label, null, "Guardar"]);
    expect([container.querySelector("[role='status']"), window.location.href]).toEqual([null, before]);
  });

  it("writes nothing and emits no request when activated", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const storageBefore = JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } });
    render(<PrototypeFeedbackButton {...ICON_ONLY} />);
    fireEvent.click(button());
    fireEvent.click(button());
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } })).toBe(storageBefore);
  });
});

describe("PrototypeFeedbackButton token and motion contract", () => {
  it("keeps the parent geometry, the token layer, and a guarded press feedback", () => {
    const { container } = render(<PrototypeFeedbackButton {...WITH_TEXT} />);
    const { className } = button();
    for (const utility of ["min-h-11", "rounded-xl", "border-border", "bg-background", "px-4", "text-sm", "font-semibold"]) expect(className).toContain(utility);
    expect([className.includes("motion-safe:active:scale-[0.96]"), className.includes("motion-reduce:active:scale-100"), className.includes("motion-reduce:transition-none"), className.includes("transition-colors")]).toEqual([true, true, true, false]);
    expect([container.querySelectorAll("[style]").length, RAW_COLOR.test(className)]).toEqual([0, false]);
  });
});
