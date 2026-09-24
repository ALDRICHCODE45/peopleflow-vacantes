import * as React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { PublicShell } from "./PublicShell";

// The shell consumes the shared menu, so it must not re-own a candidate-login
// anchor. Source-level because the popup lives in a jsdom-unreachable portal.
const source = readFileSync(
  join(process.cwd(), "src/components/shells/PublicShell.tsx"),
  "utf8",
);

// ─── Browser API stubs (ThemeToggle and the menu trigger are client leaves) ───
function stubBrowserApis() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
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
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// Literal, not imported from the implementation: the header must point at the
// canonical prototype company even if that constant drifts.
const EMPRESAS_HREF = "/empresas/0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f";

function renderShell() {
  stubBrowserApis();
  return render(<PublicShell>contenido</PublicShell>);
}

/** The single Ingresar menu trigger, matched by accessible name. */
function ingresarTrigger(container: HTMLElement) {
  return within(container.querySelector("header")!).getByRole("button", {
    name: /^ingresar$/i,
  });
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

  it("removes the unsupported Recursos placeholder entirely", () => {
    const { container } = renderShell();

    // The placeholder is gone from the DOM and from the shell source.
    expect(headerLink(container, "Recursos")).toBeUndefined();
    expect(source).not.toMatch(/Recursos|#recursos/);
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
    for (const label of ["Vacantes", "Empresas"]) {
      expectMin40Target(label, headerLink(container, label) ?? null);
    }
  });

  it("delegates the header to the shared public navbar without owning it inline", () => {
    const { container } = renderShell();

    // The shell composes the shared navbar in public mode at runtime...
    const header = container.querySelector("header[data-pf-public-navbar]");
    expect(header).not.toBeNull();
    expect(header!.querySelector("nav[data-pf-nav-floating]")).not.toBeNull();
    // ...and owns no duplicated inline header markup in source.
    expect(source).toMatch(/<PeopleFlowNavbar mode="public" \/>/);
    expect(source).not.toMatch(
      /<header|<nav|<IngresarMenu|ThemeToggle|buttonVariants|PROTOTYPE_COMPANY_ID/,
    );
  });

  it("mounts exactly one Ingresar menu trigger, not a candidate-only link", () => {
    const { container } = renderShell();

    // The shared menu owns the destinations, so the shell owns no login link.
    expect(headerLink(container, "Ingresar")).toBeUndefined();
    const ingresar = ingresarTrigger(container);
    expect(ingresar).toHaveAttribute("aria-haspopup", "menu");
    expect(ingresar).toHaveAttribute("aria-expanded", "false");
    expect(source).not.toContain("/candidato/login");
    // Exactly one trigger, ordered menu -> theme control -> publish CTA.
    const publish = headerLink(container, "Publicar vacante")!;
    const actions = Array.from(publish.parentElement!.children);
    expect(actions).toHaveLength(3);
    expect(actions[0]).toBe(ingresar);
    expect(actions[1]).toHaveAttribute("data-pf-theme-toggle");
    expect(actions[2]).toBe(publish);
  });

  it("keeps the Ingresar trigger visible at 375px with a 40px focus target", () => {
    const { container } = renderShell();

    const tokens = classTokens(ingresarTrigger(container));
    // The only login entry point must never be hidden at tight mobile widths.
    const hiddenTokens = Array.from(tokens).filter((t) => /:?hidden$/.test(t));
    expect(hiddenTokens).toHaveLength(0);
    expect(tokens.has("min-h-10")).toBe(true);
    // Trigger-only className keeps the shared focus ring on the shell control.
    for (const token of [
      "focus-visible:outline-2",
      "focus-visible:outline-offset-2",
      "focus-visible:outline-ring",
    ]) {
      expect(tokens.has(token)).toBe(true);
    }
  });

  it("renders Publicar vacante to the employer create route with shared button styling", () => {
    const { container } = renderShell();

    const publish = headerLink(container, "Publicar vacante");
    expect(publish).toBeDefined();
    expect(publish).toHaveAttribute("href", "/empresa/vacantes/nueva");
    // Reuses the project's Button variant output rather than a new component.
    expect(publish!.className).toContain("bg-primary");
    expect(publish!.className).toContain("text-primary-foreground");
    // The shared `lg` variant owns the base geometry; the explicit `min-h-10`
    // raises the publish CTA to the global >=40px target.
    expect(publish!.className).toContain("min-h-10");
  });

  it("hides the desktop destinations until md inside the shared capsule", () => {
    const { container } = renderShell();

    const nav = container.querySelector("header nav");
    expect(nav).not.toBeNull();
    expect(nav).toHaveAccessibleName(/navegación principal/i);
    const list = nav!.querySelector("[data-pf-public-nav-links]");
    expect(list).not.toBeNull();
    expect(list!.className).toContain("hidden");
    expect(list!.className).toContain("md:flex");
    for (const label of ["Vacantes", "Empresas"]) {
      expect(headerLink(container, label)).toBeDefined();
    }
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
      // Login destinations live inside the Ingresar menu popup, so the publish
      // CTA is the only auth-adjacent anchor left in the closed DOM.
      "/empresa/vacantes/nueva",
    ];
    expect(hrefs).toHaveLength(allowedHrefs.length);
    for (const href of hrefs) {
      expect(allowedHrefs).toContain(href);
    }
    // Closed menu: no candidate-login anchor is duplicated in the shell DOM.
    expect(hrefs).not.toContain("/candidato/login");
    // No invented legal or employer-side destinations.
    expect(container).not.toHaveTextContent(
      /t[eé]rminos|privacidad|empleador/i,
    );
    // Theme control plus the single Ingresar menu trigger.
    expect(container.querySelectorAll("button")).toHaveLength(2);
  });

  it("renders a restrained footer", () => {
    const { container } = renderShell();

    expect(container.querySelector("footer")).not.toBeNull();
  });

  it("renders a sticky floating public navbar capsule", () => {
    const { container } = renderShell();

    const header = container.querySelector("header");
    expect(header).not.toBeNull();
    expect(header!.className).toContain("sticky");
    expect(header!.className).toContain("top-0");
    // The detached capsule owns the translucent surface treatment.
    const capsule = header!.querySelector("[data-pf-nav-floating]")!;
    expect(capsule.className).toContain("backdrop-blur-md");
    expect(capsule.className).toContain("bg-background/70");
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
