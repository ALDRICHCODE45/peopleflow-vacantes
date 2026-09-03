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

const layoutSource = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");

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

  it("loads Inter through next/font for heading and body roles", () => {
    expect(layoutSource).toMatch(/next\/font\/google/);
    expect(layoutSource).toMatch(/\bInter\b/);
  });
});
