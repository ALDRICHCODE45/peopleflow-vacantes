import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { PublicShell } from "./PublicShell";

// ─── MatchMedia stub (ThemeToggle is a client leaf inside the shell) ──────────
function stubMatchMedia() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// Literal, not imported from the implementation: the header must point at the
// canonical prototype company even if that constant drifts.
const EMPRESAS_HREF = "/empresas/0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f";

function renderShell() {
  stubMatchMedia();
  return render(<PublicShell>contenido</PublicShell>);
}

/** Find a header link whose trimmed text matches exactly. */
function headerLink(container: HTMLElement, label: string) {
  const header = container.querySelector("header")!;
  return Array.from(header.querySelectorAll("a")).find(
    (a) => a.textContent?.trim() === label,
  );
}

/** Exact class-token membership: substring checks cannot see display conflicts. */
function classTokens(element: Element): Set<string> {
  return new Set(element.className.split(/\s+/).filter(Boolean));
}

/** Every plain-text header link must own a >=40px pointer target. */
function expectMin40Target(label: string, target: Element | null) {
  expect(target, `${label} must exist`).not.toBeNull();
  const tokens = classTokens(target!);
  expect(tokens.has("inline-flex"), `${label} must lay out as inline-flex`).toBe(
    true,
  );
  expect(
    tokens.has("min-h-10"),
    `${label} must reserve the 40px minimum target height`,
  ).toBe(true);
  expect(tokens.has("items-center"), `${label} must center in its target`).toBe(
    true,
  );
}

describe("PublicShell", () => {
  it("renders a main landmark containing the composed content", () => {
    const { container } = renderShell();

    const main = container.querySelector("main");
    expect(main).not.toBeNull();
    expect(main).toHaveTextContent("contenido");
  });

  it("renders the PeopleFlow brand as the home link to /", () => {
    const { container } = renderShell();

    const brand = container.querySelector("header a[aria-label='PeopleFlow']");
    expect(brand).not.toBeNull();
    expect(brand).toHaveAttribute("href", "/");
    expect(brand!.querySelector("img[alt*='PeopleFlow' i]")).not.toBeNull();
  });

  it("renders exactly one Vacantes link to /vacantes", () => {
    const { container } = renderShell();

    const vacantesLinks = Array.from(container.querySelectorAll("a")).filter(
      (a) => a.getAttribute("href") === "/vacantes",
    );
    expect(vacantesLinks).toHaveLength(1);
    expect(vacantesLinks[0]).toHaveTextContent(/vacantes/i);
  });

  it("renders the Empresas link to the canonical prototype company", () => {
    const { container } = renderShell();

    const empresas = headerLink(container, "Empresas");
    expect(empresas).toBeDefined();
    expect(empresas).toHaveAttribute("href", EMPRESAS_HREF);
  });

  it("renders Recursos as an in-page placeholder flagged Próximamente", () => {
    const { container } = renderShell();

    const recursos = headerLink(container, "Recursos");
    expect(recursos).toBeDefined();
    // No invented route: the anchor stays on the current page and says so.
    expect(recursos).toHaveAttribute("href", "#recursos");
    expect(recursos).toHaveAttribute("title", "Próximamente");
  });

  it("renders the persisted theme toggle as the header client leaf", () => {
    const { container } = renderShell();

    const toggle = container.querySelector("header [data-pf-theme-toggle]");
    expect(toggle).not.toBeNull();
    expect(toggle).toHaveAccessibleName(/cambiar tema/i);
    // Comfortable hit target: the shared Button icon default (size-8) is
    // replaced by a 40px control.
    expect(toggle!.className).toContain("size-10");
    expect(toggle!.className).not.toContain("size-8");
  });

  it("gives every plain-text header link a >=40px pointer target", () => {
    const { container } = renderShell();

    expectMin40Target(
      "logo",
      container.querySelector("header a[aria-label='PeopleFlow']"),
    );
    for (const label of ["Vacantes", "Empresas", "Recursos", "Ingresar"]) {
      expectMin40Target(label, headerLink(container, label) ?? null);
    }
  });

  it("renders Ingresar to /candidato/login, hidden at tight mobile widths", () => {
    const { container } = renderShell();

    const ingresar = headerLink(container, "Ingresar");
    expect(ingresar).toBeDefined();
    expect(ingresar).toHaveAttribute("href", "/candidato/login");
    // Exactly one display mechanism: a variant-scoped hide cannot be defeated
    // by a competing base display utility, and the >=640px state stays flex.
    const tokens = classTokens(ingresar!);
    expect(tokens.has("inline-flex")).toBe(true);
    expect(tokens.has("max-sm:hidden")).toBe(true);
    expect(tokens.has("hidden")).toBe(false);
  });

  it("renders Publicar vacante to the employer create route with shared button styling", () => {
    const { container } = renderShell();

    const publish = headerLink(container, "Publicar vacante");
    expect(publish).toBeDefined();
    expect(publish).toHaveAttribute("href", "/empresa/vacantes/nueva");
    // Reuses the project's Button variant output rather than a new component.
    expect(publish!.className).toContain("bg-primary");
    expect(publish!.className).toContain("text-primary-foreground");
    // Shared `lg` variant already owns the >=36px target height.
    expect(publish!.className).toContain("h-9");
  });

  it("hides the desktop nav until md and keeps the 6xl header container", () => {
    const { container } = renderShell();

    const nav = container.querySelector("header nav");
    expect(nav).not.toBeNull();
    expect(nav).toHaveAccessibleName(/navegación principal/i);
    expect(nav!.className).toContain("hidden");
    expect(nav!.className).toContain("md:flex");
    for (const label of ["Vacantes", "Empresas", "Recursos"]) {
      expect(headerLink(container, label)).toBeDefined();
    }

    const headerInner = container.querySelector("header > div");
    expect(headerInner!.className).toContain("h-16");
    expect(headerInner!.className).toContain("max-w-6xl");
  });

  it("renders only the allowed truthful public links", () => {
    const { container } = renderShell();

    const hrefs = Array.from(container.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    const allowedHrefs = [
      "/",
      "/vacantes",
      EMPRESAS_HREF,
      "#recursos",
      // Placeholder auth/publish routes stay truthful and non-mutating.
      "/candidato/login",
      "/empresa/vacantes/nueva",
    ];
    expect(hrefs).toHaveLength(allowedHrefs.length);
    for (const href of hrefs) {
      expect(allowedHrefs).toContain(href);
    }
    // No invented legal or employer-side destinations.
    expect(container).not.toHaveTextContent(
      /t[eé]rminos|privacidad|empleador/i,
    );
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });

  it("renders a restrained footer", () => {
    const { container } = renderShell();

    expect(container.querySelector("footer")).not.toBeNull();
  });

  it("renders a sticky translucent 64px public header", () => {
    const { container } = renderShell();

    const header = container.querySelector("header");
    expect(header).not.toBeNull();
    expect(header!.className).toContain("sticky");
    expect(header!.className).toContain("backdrop-blur");
    const headerInner = header!.querySelector("div");
    expect(headerInner!.className).toContain("h-16");
  });

  it("renders static decorative ambient depth behind the content", () => {
    const { container } = renderShell();

    // Decorative layers are inert containers: the ThemeToggle icons are also
    // aria-hidden, so scope to the container elements the effect owns.
    const ambient = Array.from(
      container.querySelectorAll("div[aria-hidden='true']"),
    );
    expect(ambient.length).toBeGreaterThanOrEqual(2);
    for (const layer of ambient) {
      expect(layer.className).toContain("pointer-events-none");
      expect(layer.textContent).toBe("");
    }
  });
});
