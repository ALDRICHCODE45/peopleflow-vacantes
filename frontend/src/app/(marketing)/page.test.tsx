import * as React from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import MarketingPage from "./page";

const pageSource = readFileSync(
  join(process.cwd(), "src/app/(marketing)/page.tsx"),
  "utf8",
);
const landingCss = readFileSync(
  join(process.cwd(), "src/components/marketing/reference-landing.css"),
  "utf8",
);

beforeAll(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.reject(new Error("the marketing page must not call any API")),
    ),
  );
  // Client leaves read matchMedia (ThemeToggle) and IntersectionObserver
  // (ReferenceLandingMotion); jsdom implements neither.
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      readonly root = null;
      readonly rootMargin = "";
      readonly thresholds: ReadonlyArray<number> = [];
      takeRecords = vi.fn(() => []);
    },
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
});

/** Assert `first` precedes `second` in document order. */
function precedes(first: Element, second: Element) {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe("employer marketing page (reference replica)", () => {
  it("renders exactly one hero h1 inside a main landmark", () => {
    render(<MarketingPage />);

    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(/publica\.?\s*recibe\.?\s*contrata/i);

    const main = document.querySelector("main");
    expect(main).not.toBeNull();
    expect(main!.contains(headings[0])).toBe(true);
  });

  it("scopes the whole landing under the reference root class", () => {
    render(<MarketingPage />);

    const root = document.querySelector("[data-pf-reference-landing]");
    expect(root).not.toBeNull();
    expect(root).toHaveClass("pf-reference-landing");
    // nav + main + footer all live inside the scoped root so the stylesheet
    // cannot leak into candidate/auth routes.
    expect(root!.querySelector("header")).not.toBeNull();
    expect(root!.querySelector("main")).not.toBeNull();
    expect(root!.querySelector("footer")).not.toBeNull();
  });

  it("renders the reference hero copy verbatim", () => {
    render(<MarketingPage />);

    expect(
      screen.getByText("Ecosistema de reclutamiento"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Publica tus vacantes en la bolsa de trabajo, recibe postulaciones y gestiona cada candidato en tu pipeline\. La bolsa y el ATS, conectados de punta a punta\./,
      ),
    ).toBeInTheDocument();
    // Reference CTAs (placeholder links, non-operational prototype content).
    expect(
      screen.getAllByRole("link", { name: /empezar gratis/i }).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      screen.getAllByRole("link", { name: /agendar demo/i }).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("renders the hero pipeline illustration with its four stages", () => {
    render(<MarketingPage />);

    const aurora = document.getElementById("heroAurora");
    expect(aurora).not.toBeNull();
    expect(aurora).toHaveAttribute("data-pf-hero-aurora");

    // SVG connector layer from the reference markup.
    const pipelineSvg = document.querySelector('svg[viewBox="0 0 580 420"]');
    expect(pipelineSvg).not.toBeNull();
    expect(pipelineSvg!.querySelector("#linkGrad")).not.toBeNull();
    expect(pipelineSvg!.querySelector("#dotGlow")).not.toBeNull();

    for (const stage of ["Nueva vacante", "Screening", "Entrevista", "Contratado"]) {
      expect(screen.getAllByText(stage).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("renders the reference stats strip with the exact values", () => {
    render(<MarketingPage />);

    expect(screen.getByText("\u221268%")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("tiempo por vacante")).toBeInTheDocument();
    expect(
      screen.getByText("del pipeline, siempre visible"),
    ).toBeInTheDocument();
    expect(screen.getByText("solo lugar para todo el equipo")).toBeInTheDocument();
  });

  it("renders the two-systems section with Sistema A and Sistema B", () => {
    render(<MarketingPage />);

    expect(
      screen.getByRole("heading", {
        name: /La bolsa de trabajo y tu ATS, conectados\./,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Bolsa de trabajo" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "ATS · Pipeline" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Sistema A")).toBeInTheDocument();
    expect(screen.getByText("Sistema B")).toBeInTheDocument();
    expect(screen.getByText("fluye a")).toBeInTheDocument();
  });

  it("renders the value-props bento with its three cards", () => {
    render(<MarketingPage />);

    expect(
      screen.getByRole("heading", { name: "Todo el proceso, bajo tu control" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Pipeline visible" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Screening con IA" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Tu equipo, coordinado" }),
    ).toBeInTheDocument();
  });

  it("renders the reference kanban showcase with all eight named candidates", () => {
    render(<MarketingPage />);

    expect(
      screen.getByRole("heading", { name: "Tu tablero, en acción" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Vacante · Backend Developer (Senior)"),
    ).toBeInTheDocument();

    for (const name of [
      "Sofía Ramírez",
      "Diego Herrera",
      "Valeria Cruz",
      "Mateo Gómez",
      "Camila Ríos",
      "Andrés Vega",
      "Lucía Peña",
      "Javier Solís",
    ]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }

    // Reference card hover affordances are preserved, not plain static cards.
    expect(
      document.querySelector(".hover\\:border-brand\\/50"),
    ).not.toBeNull();
    expect(
      document.querySelector(".hover\\:border-cyan\\/60"),
    ).not.toBeNull();
    expect(
      document.querySelector(".hover\\:border-magenta\\/50"),
    ).not.toBeNull();
  });

  it("renders the closing CTA with both reference actions", () => {
    render(<MarketingPage />);

    const cta = screen.getByRole("heading", {
      name: "Empieza a ver todo tu proceso",
    });
    expect(cta).toBeInTheDocument();
    expect(
      screen.getByText(
        /Publica tu primera vacante en la bolsa y sigue cada postulación en tu pipeline\. Sin tarjeta, sin fricción\./,
      ),
    ).toBeInTheDocument();
  });

  it("renders the semantic reference footer with all link columns", () => {
    render(<MarketingPage />);

    const footer = document.querySelector("footer[role='contentinfo']");
    expect(footer).not.toBeNull();
    for (const column of ["Producto", "Empresa", "Recursos"]) {
      expect(
        screen.getAllByText(column, { selector: "p" }).length,
      ).toBeGreaterThanOrEqual(1);
    }
    expect(
      screen.getByText(/© 2026 PeopleFlow/),
    ).toBeInTheDocument();
  });

  it("orders the sections exactly like the reference", () => {
    render(<MarketingPage />);

    const h1 = screen.getByRole("heading", { level: 1 });
    const twoSystems = screen.getByRole("heading", {
      name: /La bolsa de trabajo y tu ATS, conectados\./,
    });
    const valueProps = screen.getByRole("heading", {
      name: "Todo el proceso, bajo tu control",
    });
    const showcase = screen.getByRole("heading", {
      name: "Tu tablero, en acción",
    });
    const closing = screen.getByRole("heading", {
      name: "Empieza a ver todo tu proceso",
    });
    const footer = document.querySelector("footer")!;

    expect(precedes(h1, twoSystems)).toBe(true);
    expect(precedes(twoSystems, valueProps)).toBe(true);
    expect(precedes(valueProps, showcase)).toBe(true);
    expect(precedes(showcase, closing)).toBe(true);
    expect(precedes(closing, footer)).toBe(true);
  });

  it("keeps the single persisted theme toggle in the header", () => {
    render(<MarketingPage />);

    const themeButtons = screen.getAllByRole("button", {
      name: /cambiar tema/i,
    });
    expect(themeButtons).toHaveLength(1);
    expect(themeButtons[0]).toHaveAttribute("data-pf-theme-toggle");
    expect(themeButtons[0]!.closest("header")).not.toBeNull();
  });

  it("renders the reference navigation link set as placeholder links", () => {
    render(<MarketingPage />);

    const header = document.querySelector("header")!;
    for (const label of ["Producto", "Soluciones", "Precios", "Recursos"]) {
      const link = Array.from(header.querySelectorAll("a")).find(
        (a) => a.textContent?.trim() === label,
      );
      expect(link, `nav link ${label}`).toBeDefined();
      expect(link).toHaveAttribute("href", "#");
    }
    const login = Array.from(header.querySelectorAll("a")).find(
      (a) => a.textContent?.trim() === "Iniciar sesión",
    );
    expect(login).toBeDefined();
    expect(login).toHaveAttribute("href", "#");
  });

  it("keeps every prototype anchor addressable (placeholder '#' allowed)", () => {
    render(<MarketingPage />);

    const anchors = screen.getAllByRole("link");
    expect(anchors.length).toBeGreaterThan(10);
    for (const anchor of anchors) {
      expect(anchor.getAttribute("href")).not.toBeNull();
    }
  });

  it("serves the licensed reference fonts from local assets", () => {
    expect(landingCss).toMatch(/@font-face/);
    // Landing-local family names: the app-wide `--font-heading` ("Clash
    // Display") used by candidate/auth screens must NOT be registered here.
    expect(landingCss).toContain('font-family: "PF Reference Clash Display"');
    expect(landingCss).toContain('font-family: "PF Reference JetBrains Mono"');
    expect(landingCss).not.toMatch(/font-family:\s*"Clash Display"/);
    expect(landingCss).not.toMatch(/font-family:\s*"JetBrains Mono"/);
    expect(landingCss).toContain("/fonts/clash-display-500.woff2");
    expect(landingCss).toContain("/fonts/clash-display-600.woff2");
    expect(landingCss).toContain("/fonts/clash-display-700.woff2");
    expect(landingCss).toContain("/fonts/jetbrains-mono-latin.woff2");
    // The reference palette values are defined locally, not by editing the
    // shared globals.
    expect(landingCss).toContain("--pf-brand: 147 54 234");
    expect(landingCss).toContain("--pf-base: 12 9 18");
  });

  it("keeps the landing root sticky-safe and ambient-isolated", () => {
    render(<MarketingPage />);

    const root = document.querySelector("[data-pf-reference-landing]");
    expect(root).not.toBeNull();
    // `overflow-x: hidden` turns the wrapper into a non-scrolling scroll
    // container, which traps the sticky header (the reference keeps it sticky
    // against the viewport). The root must CLIP horizontally instead.
    expect(root).not.toHaveClass("overflow-x-hidden");
    expect(root).toHaveClass("overflow-x-clip");
    // The opaque wrapper background would hide the negative-z fixed ambient
    // layers unless the root establishes its own stacking context.
    expect(root).toHaveClass("isolate");
  });

  it("uses overflow-clip with a visible vertical axis (no scroll container)", () => {
    // A wrapper that scrolls (or that forces overflow-y to auto) breaks the
    // viewport sticky contract regardless of the unit-test DOM state.
    expect(pageSource).toMatch(/overflow-x-clip/);
    expect(pageSource).not.toMatch(/overflow-y-auto/);
    expect(pageSource).not.toMatch(/overflow-x-hidden/);
  });

  it("keeps AA light accent text and the exact reference accents in dark", () => {
    const lightBlock = landingCss.split(".dark .pf-reference-landing")[0];
    const darkBlock = landingCss.match(
      /\.dark \.pf-reference-landing \{([^}]*)\}/,
    )?.[1];
    expect(darkBlock).toBeDefined();

    // Light surface chips need the darker same-hue shades so accent text
    // clears WCAG AA (>= 4.5:1); the exact reference accents are kept for
    // dark, where they pass on the near-black palette.
    expect(lightBlock).toMatch(/--pf-on-green:\s*#166534;/);
    expect(lightBlock).toMatch(/--pf-on-cyan:\s*#155e75;/);
    expect(lightBlock).toMatch(/--pf-on-amber:\s*#92400e;/);
    // The reference accents must never be declared on the light palette.
    expect(lightBlock).not.toMatch(
      /--pf-on-(?:green|cyan|amber):\s*#(?:34d07a|22d3ee|e0a83e);/,
    );

    expect(darkBlock).toMatch(/--pf-on-green:\s*#34d07a;/);
    expect(darkBlock).toMatch(/--pf-on-cyan:\s*#22d3ee;/);
    expect(darkBlock).toMatch(/--pf-on-amber:\s*#e0a83e;/);

    // Neither the reference accents nor the previously rejected shades may
    // leak back in as light declarations.
    for (const recolored of ["#0e7490", "#146c34", "#8a5a00"]) {
      expect(landingCss).not.toContain(recolored);
    }

    // Text utilities follow the same boundary: cyan is darkened on light and
    // restored to the raw token on dark, and the text-only brand color is
    // lightened on dark without touching the shared --pf-brand channel.
    expect(landingCss).toMatch(
      /\.pf-reference-landing \.text-cyan \{\s*\/\*[\s\S]*?\*\/\s*color: rgb\(14 116 144\);\s*\}/,
    );
    expect(landingCss).toMatch(
      /\.dark \.pf-reference-landing \.text-cyan \{\s*color: rgb\(var\(--pf-cyan\)\);\s*\}/,
    );
    expect(landingCss).toMatch(
      /\.dark \.pf-reference-landing \.text-brand \{\s*color: rgb\(192 132 252\);\s*\}/,
    );
  });

  it("scopes the reference 18px icon size to the marketing theme control", () => {
    const rule = landingCss.match(
      /\.pf-reference-landing\s+\[data-pf-theme-toggle\]\s+svg\s*\{[^}]*\}/,
    );
    expect(rule).not.toBeNull();
    expect(rule![0]).toMatch(/width:\s*18px/);
    expect(rule![0]).toMatch(/height:\s*18px/);
    // Never a global theme-control rule: candidate/auth keep their own sizing.
    expect(landingCss).not.toMatch(
      /(^|\n)\[data-pf-theme-toggle\]\s+svg\s*\{/,
    );
  });

  it("retains the full official ITF Free Font License for Clash Display", () => {
    const license = readFileSync(
      join(process.cwd(), "public/fonts/clash-display.ITF-LICENSE.txt"),
      "utf8",
    );
    expect(license).toMatch(/ITF Free Font License/i);
    expect(license).toMatch(/Indian Type Foundry/);
    // The full text is retained locally, not just a URL: several official
    // section headings must be present.
    expect(license).toMatch(/NOTICE TO USER/i);
    expect(license).toMatch(/GRANT OF LICENSE/i);
    expect(license).toMatch(/EMBEDDING/i);
    expect(license).toMatch(/TERMINATION/i);
    expect(license).toMatch(/FINAL PROVISIONS/i);
    expect(license).toContain("https://www.fontshare.com/licenses/itf-ffl");
  });

  it("makes no API call while rendering", () => {
    render(<MarketingPage />);

    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("stays a server component without 'use client' in the page file", () => {
    expect(pageSource).not.toMatch(/['"]use client['"]/);
    expect(pageSource).not.toMatch(/fetch\(/);
    expect(pageSource).not.toMatch(/useState|useEffect|useContext/);
  });
});
