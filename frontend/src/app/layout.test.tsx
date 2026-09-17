import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("next/font/google", () => ({
  Inter: vi.fn(() => ({
    className: "mock-inter-variable",
    variable: "--font-sans",
    style: { fontFamily: "Inter" },
  })),
}));

import RootLayout, { metadata } from "./layout";
import { THEME_BOOTSTRAP_SCRIPT } from "@/components/theme/theme-preferences";

const layoutSource = readFileSync(
  join(process.cwd(), "src/app/layout.tsx"),
  "utf8",
);

describe("root layout", () => {
  it("renders the document with lang es-MX", () => {
    // React 19 pins <html>/<body> onto the real document, not the RTL container.
    render(
      <RootLayout>
        <p>contenido</p>
      </RootLayout>,
    );

    const html = document.querySelector("html");
    expect(html).not.toBeNull();
    expect(html).toHaveAttribute("lang", "es-MX");
  });

  it("applies the Inter font variable to the document root", () => {
    // React 19 pins <html>/<body> onto the real document, not the RTL container.
    render(
      <RootLayout>
        <p>contenido</p>
      </RootLayout>,
    );

    const html = document.querySelector("html");
    expect(html?.className).toContain("mock-inter-variable");
  });

  it("renders children inside the body", () => {
    // React 19 pins <html>/<body> onto the real document, not the RTL container.
    render(
      <RootLayout>
        <p>contenido</p>
      </RootLayout>,
    );

    const body = document.querySelector("body");
    expect(body).not.toBeNull();
    expect(body).toHaveTextContent("contenido");
  });

  it("exposes the PeopleFlow title template metadata", () => {
    expect(metadata).toBeDefined();
    const title = metadata?.title;
    expect(typeof title === "object" && title !== null).toBe(true);
    if (typeof title === "object" && title !== null) {
      expect((title as { template?: string }).template).toBe("%s | PeopleFlow");
    }
  });

  it("keeps the root layout on the server without a client boundary", () => {
    expect(layoutSource).not.toMatch(/["']use client["']/);
    expect(layoutSource).not.toMatch(/fetch\(/);
  });

  it("loads Inter through next/font for the body role", () => {
    expect(layoutSource).toMatch(/next\/font\/google/);
    expect(layoutSource).toMatch(/\bInter\b/);
  });

  it("loads no external font stylesheet, preconnect, or @import", () => {
    // Build-safe typography: framework-managed next/font for the body role and
    // a declared --font-heading stack for the heading role. No hosted
    // stylesheet, no preconnect to a font CDN, no CSS @import of remote faces.
    expect(layoutSource).not.toMatch(/fontshare/i);
    expect(layoutSource).not.toMatch(/rel="preconnect"/);
    expect(layoutSource).not.toMatch(/rel="stylesheet"/);
    expect(layoutSource).not.toMatch(/@import/i);
    // No network font dependency of any kind may be re-introduced in markup.
    expect(layoutSource).not.toMatch(/https?:\/\//);
  });

  it("tolerates pre-paint document mutations during hydration", () => {
    // The theme bootstrap mutates <html> before React hydrates; the root
    // element must declare suppressHydrationWarning so that mutation is not
    // reported as a hydration mismatch.
    expect(layoutSource).toMatch(/suppressHydrationWarning/);
  });

  it("inlines the theme bootstrap before first paint", () => {
    render(
      <RootLayout>
        <p>contenido</p>
      </RootLayout>,
    );

    const script = document.querySelector<HTMLScriptElement>(
      "script[data-pf-theme-bootstrap]",
    );
    expect(script).not.toBeNull();
    // The rendered inline script is exactly the shared bootstrap source, so
    // the pre-paint behavior and the control stay in lockstep.
    expect(script?.textContent).toBe(THEME_BOOTSTRAP_SCRIPT);
  });

  it("places the theme bootstrap in a valid root-layout position", () => {
    // A <script> rendered directly under <html> is invalid HTML placement:
    // React/Next flag it and surface a hydration-error risk (the dev overlay
    // exposed it in browser verification). The bootstrap must render inside
    // <body> — as its first element — so the emitted document is valid and the
    // script still runs parser-blocking before any following content.
    //
    // Structural source contract: the jsdom test environment renders the whole
    // <html>/<body> tree inside a container div (React pins only the
    // attributes of root-level html/body onto the real document), so DOM
    // parenting cannot prove placement here. layout.tsx source structure is
    // the verifiable contract; the runtime check below proves rendering emits
    // no invalid-HTML/hydration-placement warnings.
    //
    // JSX comments are stripped first: they document the placement rule in
    // prose that mentions the very tags being asserted, and would otherwise
    // poison positional matching.
    const structuralSource = layoutSource
      .replace(/\{\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const bodyOpen = structuralSource.indexOf("<body");
    const bodyClose = structuralSource.indexOf("</body>");
    const scriptOpen = structuralSource.indexOf("<script");

    expect(bodyOpen).toBeGreaterThanOrEqual(0);
    expect(bodyClose).toBeGreaterThan(bodyOpen);
    expect(scriptOpen).toBeGreaterThan(bodyOpen);
    expect(scriptOpen).toBeLessThan(bodyClose);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      render(
        <RootLayout>
          <p>contenido</p>
        </RootLayout>,
      );

      const script = document.querySelector<HTMLScriptElement>(
        "script[data-pf-theme-bootstrap]",
      );
      expect(script).not.toBeNull();
      // First element inside its rendered parent: still parser-blocking, so
      // the resolved theme applies before any following content paints.
      expect(script!.parentElement!.firstElementChild).toBe(script);

      // Rendering must not emit invalid-HTML/hydration-placement warnings.
      const placementErrors = errorSpy.mock.calls
        .map((args) => args.join(" "))
        .filter((message) =>
          /In HTML|validateDOMNesting|hydrat/i.test(message),
        );
      expect(placementErrors).toEqual([]);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("bootstraps the theme from persisted choice or system preference", () => {
    // The bootstrap must read the persisted manual choice and fall back to the
    // OS preference, applying the resolved theme before first paint.
    expect(THEME_BOOTSTRAP_SCRIPT).toContain('"pf-theme"');
    expect(THEME_BOOTSTRAP_SCRIPT).toContain("localStorage.getItem");
    expect(THEME_BOOTSTRAP_SCRIPT).toContain("prefers-color-scheme");
    expect(THEME_BOOTSTRAP_SCRIPT).toContain('classList.toggle("dark"');
    // Storage access is guarded: private mode or a denied store must never
    // break the bootstrap.
    expect(THEME_BOOTSTRAP_SCRIPT).toMatch(/try\{[\s\S]*catch/);
  });
});
