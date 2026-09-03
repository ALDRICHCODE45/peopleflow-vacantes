import * as React from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { PeopleFlowLogo } from "./logo";

// Vitest runs from frontend/, so cwd-relative paths keep the assertions stable.
const brandRoot = join(process.cwd(), "public/brand");

describe("PeopleFlow brand", () => {
  it("keeps the approved PeopleFlow wordmarks under public/brand", () => {
    expect(existsSync(join(brandRoot, "peopleflow-light.webp"))).toBe(true);
    expect(existsSync(join(brandRoot, "peopleflow-dark.webp"))).toBe(true);
  });

  it("renders both color-scheme wordmarks with reserved dimensions", () => {
    const { container } = render(<PeopleFlowLogo />);

    const images = Array.from(container.querySelectorAll("img"));
    const light = images.find((img) => (img.getAttribute("src") ?? "").includes("peopleflow-light"));
    const dark = images.find((img) => (img.getAttribute("src") ?? "").includes("peopleflow-dark"));

    expect(light).toBeDefined();
    expect(dark).toBeDefined();
    expect(light).toHaveAttribute("alt", "PeopleFlow");
    expect(dark).toHaveAttribute("alt", "PeopleFlow");

    for (const img of [light, dark]) {
      const width = Number(img!.getAttribute("width"));
      const height = Number(img!.getAttribute("height"));
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
      expect(width / height).toBe(4); // approved wordmarks are 1584x396
    }
  });
});
