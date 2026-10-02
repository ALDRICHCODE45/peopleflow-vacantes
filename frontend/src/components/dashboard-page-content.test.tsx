import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DASHBOARD_PAGE_PADDING,
  DashboardPageContent,
} from "./dashboard-page-content";

// Source as text, so the server-component and token-only contracts stay asserted.
const SOURCE = readFileSync(
  join(process.cwd(), "src/components/dashboard-page-content.tsx"),
  "utf8",
);

// The agreement recovered for the dashboard spacing normalization: 16px on
// mobile, 24px from `md` up on the vertical axis, and the existing 16px mobile /
// 24px `lg`+ horizontal inset. This exact recipe is the single outer padding
// owner each dashboard route mounts.
const PADDING_TOKENS = ["px-4", "py-4", "md:py-6", "lg:px-6"] as const;
const RAW_COLOR = /oklch\(|#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\s*\(/u;

/** One compact owner probe: an element that re-adds both page insets. */
const paddingOwners = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll("[class]")).filter((node) => {
    const value = (node.getAttribute("class") ?? "").split(/\s+/u);
    return value.includes("px-4") && value.includes("lg:px-6");
  }) as HTMLElement[];

afterEach(cleanup);

describe("DashboardPageContent canonical page padding", () => {
  it("exports the single canonical padding recipe with 16px mobile and 24px desktop steps", () => {
    expect(DASHBOARD_PAGE_PADDING.split(/\s+/u)).toEqual([
      "px-4",
      "py-4",
      "md:py-6",
      "lg:px-6",
    ]);
  });

  it("renders exactly one padding owner carrying every canonical token", () => {
    const { container } = render(
      <DashboardPageContent data-pf-test-content="">body</DashboardPageContent>,
    );

    const root = container.querySelector("[data-pf-test-content]") as HTMLElement;
    expect(root).not.toBeNull();
    const tokens = root.className.split(/\s+/u);
    for (const token of PADDING_TOKENS) expect(tokens, token).toContain(token);

    // No descendant re-adds the inset, so the route cannot double pad.
    expect(paddingOwners(container)).toEqual([root]);
  });

  it("keeps the full canvas free of a width cap by default", () => {
    const { container } = render(
      <DashboardPageContent data-pf-test-content="" />,
    );

    const tokens = (
      container.querySelector("[data-pf-test-content]") as HTMLElement
    ).className.split(/\s+/u);
    expect(tokens.filter((token) => token.startsWith("max-w-"))).toEqual([]);
    expect(tokens).not.toContain("mx-auto");
  });

  it("bounds the candidate canonical measure at screen-2xl and nothing narrower", () => {
    const { container } = render(
      <DashboardPageContent data-pf-test-content="" width="screen-2xl" />,
    );

    const tokens = (
      container.querySelector("[data-pf-test-content]") as HTMLElement
    ).className.split(/\s+/u);
    for (const token of ["mx-auto", "w-full", "max-w-screen-2xl"]) {
      expect(tokens, token).toContain(token);
    }
    expect(tokens.filter((token) => token.startsWith("max-w-"))).toEqual([
      "max-w-screen-2xl",
    ]);
  });

  it("bounds the enriched employer form at 7xl", () => {
    const { container } = render(
      <DashboardPageContent data-pf-test-content="" width="7xl" />,
    );

    const tokens = (
      container.querySelector("[data-pf-test-content]") as HTMLElement
    ).className.split(/\s+/u);
    for (const token of ["mx-auto", "w-full", "max-w-7xl"]) {
      expect(tokens, token).toContain(token);
    }
    expect(tokens.filter((token) => token.startsWith("max-w-"))).toEqual([
      "max-w-7xl",
    ]);
  });

  it("opts the route into the @container/main query root when asked", () => {
    const { container } = render(
      <DashboardPageContent data-pf-test-content="" container />,
    );

    const root = container.querySelector("[data-pf-test-content]") as HTMLElement;
    expect(root.className).toContain("@container/main");
  });

  it("stays out of the container query root by default", () => {
    const { container } = render(
      <DashboardPageContent data-pf-test-content="" />,
    );

    const root = container.querySelector("[data-pf-test-content]") as HTMLElement;
    expect(root.className).not.toContain("@container/main");
  });

  it("merges caller layout classes without losing the canonical padding", () => {
    const { container } = render(
      <DashboardPageContent
        data-pf-test-content=""
        className="grid grid-cols-1 gap-5"
      />,
    );

    const tokens = (
      container.querySelector("[data-pf-test-content]") as HTMLElement
    ).className.split(/\s+/u);
    for (const token of [
      ...PADDING_TOKENS,
      "grid",
      "grid-cols-1",
      "gap-5",
    ]) {
      expect(tokens, token).toContain(token);
    }
  });

  it("stays a server component with token-only paint", () => {
    expect(SOURCE).not.toMatch(/["']use client["']/u);
    expect(SOURCE).not.toMatch(RAW_COLOR);
    expect(SOURCE).not.toMatch(/space-[xy]-/u);
    // The padding recipe is declared once and reused by the component.
    expect(SOURCE).toContain("DASHBOARD_PAGE_PADDING");
  });
});
