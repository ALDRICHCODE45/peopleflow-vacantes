import * as React from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import MarketingPage from "./page";

const pageSource = readFileSync(
  join(process.cwd(), "src/app/(marketing)/page.tsx"),
  "utf8",
);

beforeAll(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.reject(new Error("the minimal root must not call any API")),
    ),
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("minimal marketing root page", () => {
  it("renders exactly one minimal root h1", () => {
    const { container } = render(<MarketingPage />);

    const headings = container.querySelectorAll("h1");
    expect(headings).toHaveLength(1);
    expect(headings[0]).not.toBeEmpty();
  });

  it("exposes one clear vacancy link pointing to /vacantes", () => {
    const { container } = render(<MarketingPage />);

    const vacantesLinks = Array.from(container.querySelectorAll("a")).filter(
      (a) => a.getAttribute("href") === "/vacantes",
    );
    expect(vacantesLinks).toHaveLength(1);
    expect(vacantesLinks[0]).toHaveTextContent(/vacantes/i);
  });

  it("makes no API call while rendering", () => {
    render(<MarketingPage />);

    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("stays a server component without a broad client boundary", () => {
    expect(pageSource).not.toMatch(/["']use client["']/);
    expect(pageSource).not.toMatch(/fetch\(/);
    expect(pageSource).not.toMatch(/useState|useEffect|useContext/);
  });

  it("renders no unsupported marketing actions", () => {
    const { container } = render(<MarketingPage />);

    const hrefs = Array.from(container.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    for (const href of hrefs) {
      expect(["/", "/vacantes"]).toContain(href);
    }
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container).not.toHaveTextContent(
      /(iniciar|inicia)\s+sesi[oó]n|publicar|post[uú]late|aplica|reg[ií]strate|reg[ií]strate/i,
    );
  });
});
