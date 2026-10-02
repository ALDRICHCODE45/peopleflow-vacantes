import * as React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { PeopleFlowNavbar } from "@/components/navigation/PeopleFlowNavbar";

// The marketing header composes the shared login menu instead of owning a
// placeholder anchor. Source-level because the Base UI menu popup lives in a
// jsdom-unreachable portal, matching the IngresarMenu/PublicShell precedents.
const source = readFileSync(
  join(process.cwd(), "src", "components", "navigation", "PeopleFlowNavbar.tsx"),
  "utf8",
);

// ─── MatchMedia stub (matches ThemeToggle / PublicShell pattern) ──────────────
function stubMatchMedia() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  // The shared menu root also reads ResizeObserver while it mounts.
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

// ─── Candidate mode helpers ───────────────────────────────────────────────────

function renderCandidateNavbar() {
  return render(<PeopleFlowNavbar mode="candidate" />);
}

// ─── Marketing mode helpers ──────────────────────────────────────────────────

function renderMarketingNavbar() {
  return render(<PeopleFlowNavbar mode="marketing" />);
}

// ─── Public mode helpers ─────────────────────────────────────────────────────

// Literal, not imported from the implementation: the canonical prototype
// company route must stay truthful even if that constant drifts.
const EMPRESAS_HREF = "/empresas/0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f";
const renderPublicNavbar = () => render(<PeopleFlowNavbar mode="public" />);

/** Find a header link whose trimmed text matches exactly. */
function findHeaderLink(header: Element, label: string) {
  return Array.from(header.querySelectorAll("a")).find(
    (a) => a.textContent?.trim() === label,
  );
}

/** The single shared Ingresar trigger, matched by accessible name. */
function ingresarTrigger() {
  return screen.getByRole("button", { name: /^ingresar$/i });
}

/**
 * Every brand mark and plain-text destination must own an explicit >=40px
 * pointer target, so no text-only link relies on its glyph box as the hit area.
 */
function expectNavTarget(element: Element | null, label: string) {
  expect(element, `${label} must exist`).not.toBeNull();
  const tokens = new Set(element!.className.split(/\s+/).filter(Boolean));
  for (const token of ["inline-flex", "min-h-10", "items-center"]) {
    expect(tokens.has(token), `${label} must carry ${token}`).toBe(true);
  }
}

// ─── Candidate mode tests (frozen contract — unchanged) ──────────────────────

describe("PeopleFlowNavbar candidate mode", () => {
  it("renders the PeopleFlow brand link to /", () => {
    stubMatchMedia();
    renderCandidateNavbar();
    // Query within the header to avoid the outer test wrapper <Link>
    const header = document.querySelector("header");
    const brandLink = header!.querySelector("a[aria-label='PeopleFlow']");
    expect(brandLink).not.toBeNull();
    expect(brandLink).toHaveAttribute("href", "/");
  });

  it("renders exactly one Vacantes link to /vacantes", () => {
    stubMatchMedia();
    renderCandidateNavbar();
    const vacantesLinks = screen.getAllByRole("link", { name: /vacantes/i });
    expect(vacantesLinks).toHaveLength(1);
    expect(vacantesLinks[0]).toHaveAttribute("href", "/vacantes");
  });

  it("renders one accessible theme toggle button", () => {
    stubMatchMedia();
    renderCandidateNavbar();
    expect(
      screen.getByRole("button", { name: /cambiar tema/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /cambiar tema/i }),
    ).toHaveAttribute("data-pf-theme-toggle");
  });

  it("gives the candidate brand and Vacantes link explicit >=40px targets", () => {
    stubMatchMedia();
    renderCandidateNavbar();
    const header = document.querySelector("header")!;
    expectNavTarget(
      header.querySelector("a[aria-label='PeopleFlow']"),
      "candidate brand",
    );
    expectNavTarget(
      screen.getByRole("link", { name: /vacantes/i }),
      "candidate Vacantes",
    );
  });

  it("does NOT render marketing CTA buttons in candidate mode", () => {
    stubMatchMedia();
    renderCandidateNavbar();
    expect(
      screen.queryByRole("link", { name: /empezar gratis/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /iniciar sesión/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^ingresar$/i }),
    ).not.toBeInTheDocument();
  });

  it("does NOT render marketing nav links in candidate mode", () => {
    stubMatchMedia();
    renderCandidateNavbar();
    for (const label of ["Producto", "Soluciones", "Precios", "Recursos"]) {
      expect(
        screen.queryByRole("link", { name: label }),
      ).not.toBeInTheDocument();
    }
  });

  it("does NOT render a hamburger button in candidate mode", () => {
    stubMatchMedia();
    renderCandidateNavbar();
    // The only button in candidate mode should be the theme toggle
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute("data-pf-theme-toggle");
  });
});

// ─── Marketing mode tests (reference replica nav set) ────────────────────────

describe("PeopleFlowNavbar marketing mode", () => {
  it("renders the PeopleFlow brand link to /", () => {
    stubMatchMedia();
    renderMarketingNavbar();
    const header = document.querySelector("header");
    const brandLink = header!.querySelector("a[aria-label='PeopleFlow']");
    expect(brandLink).not.toBeNull();
    expect(brandLink).toHaveAttribute("href", "/");
  });

  it("renders Vacantes as a real first nav link to /vacantes", () => {
    stubMatchMedia();
    renderMarketingNavbar();
    const header = document.querySelector("header")!;
    const vacantes = findHeaderLink(header, "Vacantes");
    expect(vacantes).toBeDefined();
    expect(vacantes).toHaveAttribute("href", "/vacantes");
    // Candidate discoverability: Vacantes leads the marketing nav list.
    expect(Array.from(header.querySelectorAll("ul a"))[0]).toBe(vacantes);
  });

  it("renders only real nav destinations, in order, with no placeholder", () => {
    stubMatchMedia();
    renderMarketingNavbar();
    const header = document.querySelector("header")!;
    expect(findHeaderLink(header, "Producto")).toHaveAttribute(
      "href",
      "#producto",
    );
    expect(findHeaderLink(header, "Soluciones")).toHaveAttribute(
      "href",
      "#soluciones",
    );
    // Unsupported destinations are removed from the DOM entirely instead of
    // surviving as non-operational `#` placeholders.
    expect(findHeaderLink(header, "Precios")).toBeUndefined();
    expect(findHeaderLink(header, "Recursos")).toBeUndefined();
    expect(
      Array.from(header.querySelectorAll("ul a")).map((a) =>
        a.getAttribute("href"),
      ),
    ).toEqual(["/vacantes", "#producto", "#soluciones", "/candidatos"]);
    // Every marketing nav anchor must lead somewhere real.
    for (const anchor of Array.from(header.querySelectorAll("a"))) {
      expect(anchor.getAttribute("href"), anchor.textContent!).not.toBe("#");
    }
  });

  it("renders one accessible Ingresar menu trigger instead of a login placeholder", () => {
    stubMatchMedia();
    renderMarketingNavbar();
    const header = document.querySelector("header")!;
    // The shared menu owns the destinations, so no direct login anchor remains.
    expect(findHeaderLink(header, "Iniciar sesión")).toBeUndefined();
    expect(findHeaderLink(header, "Ingresar")).toBeUndefined();
    const triggers = screen.getAllByRole("button", { name: /^ingresar$/i });
    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toHaveAttribute("aria-haspopup", "menu");
    expect(triggers[0]).toHaveAttribute("aria-expanded", "false");
    // The login entry stays visible at mobile width via its compact shared
    // trigger: it is never hidden and reserves the 40px target.
    const tokens = new Set(triggers[0].className.split(/\s+/).filter(Boolean));
    expect(Array.from(tokens).filter((t) => /:?hidden$/.test(t))).toHaveLength(
      0,
    );
    expect(tokens.has("min-h-10")).toBe(true);
    expect(tokens.has("max-sm:px-0")).toBe(true);
    // Closed menu: no auth destination is duplicated outside the popup.
    expect(header.querySelector('a[href="/candidato/login"]')).toBeNull();
    expect(header.querySelector('a[href="/empresa/login"]')).toBeNull();
  });

  it("points the Empezar gratis primary CTA at the closing section", () => {
    stubMatchMedia();
    renderMarketingNavbar();
    const header = document.querySelector("header")!;
    const cta = findHeaderLink(header, "Empezar gratis");
    expect(cta).toBeDefined();
    expect(cta).toHaveAttribute("href", "#empezar");
  });

  it("orders the header actions Ingresar menu, theme toggle, then Empezar gratis", () => {
    stubMatchMedia();
    renderMarketingNavbar();
    const header = document.querySelector("header")!;
    const cta = findHeaderLink(header, "Empezar gratis")!;
    const actions = Array.from(cta.parentElement!.children);
    expect(actions).toHaveLength(3);
    expect(actions[0]).toBe(ingresarTrigger());
    expect(actions[1]).toHaveAttribute("data-pf-theme-toggle");
    expect(actions[2]).toBe(cta);
  });

  it("gives every marketing control an explicit >=40px target", () => {
    stubMatchMedia();
    renderMarketingNavbar();
    const header = document.querySelector("header")!;
    expectNavTarget(
      header.querySelector("a[aria-label='PeopleFlow']"),
      "marketing brand",
    );
    for (const label of ["Vacantes", "Producto", "Soluciones"]) {
      expectNavTarget(findHeaderLink(header, label) ?? null, label);
    }
    // The icon-only theme control owns a 40px square, not the previous 36px.
    const toggle = screen.getByRole("button", { name: /cambiar tema/i });
    const toggleTokens = new Set(toggle.className.split(/\s+/).filter(Boolean));
    expect(toggleTokens.has("size-10")).toBe(true);
    expect(toggleTokens.has("size-9")).toBe(false);
    // The primary CTA raises the shared `lg` Button geometry to 40px.
    const cta = findHeaderLink(header, "Empezar gratis");
    expect(cta).toBeDefined();
    expect(
      new Set(cta!.className.split(/\s+/).filter(Boolean)).has("min-h-10"),
    ).toBe(true);
  });

  it("renders the sticky reference header shell with a floating inner surface", () => {
    stubMatchMedia();
    renderMarketingNavbar();
    const header = document.querySelector("[data-pf-marketing-navbar]");
    expect(header).toBeInTheDocument();
    // The shell keeps positioning + the scroll-state class owner...
    expect(header).toHaveClass("sticky", "top-0");
    expect(header!.className).not.toContain("backdrop-blur-md");
    // ...while the detached capsule owns the surface treatment.
    const surface = header!.querySelector("nav[data-pf-nav-floating]");
    expect(surface).not.toBeNull();
    expect(surface).toHaveClass("rounded-2xl", "backdrop-blur-md", "mx-auto");
  });

  it("renders one accessible theme toggle button", () => {
    stubMatchMedia();
    renderMarketingNavbar();
    const toggles = screen.getAllByRole("button", { name: /cambiar tema/i });
    expect(toggles).toHaveLength(1);
    expect(toggles[0]).toHaveAttribute("data-pf-theme-toggle");
  });

  it("renders exactly the shared login trigger and theme toggle, never a hamburger", () => {
    stubMatchMedia();
    renderMarketingNavbar();
    const buttons = screen.getAllByRole("button");
    // Two controls only: the shared Ingresar menu and the theme toggle.
    expect(buttons).toHaveLength(2);
    const trigger = ingresarTrigger();
    const toggle = screen.getByRole("button", { name: /cambiar tema/i });
    expect(buttons).toContain(trigger);
    expect(buttons).toContain(toggle);
    // The login entry is the shared menu, not a sheet/hamburger control.
    expect(trigger).not.toHaveAttribute("data-pf-theme-toggle");
    expect(toggle).not.toHaveAttribute("aria-haspopup");
    expect(
      screen.queryByRole("button", { name: /abr?ir?.*men[úu]/i }),
    ).not.toBeInTheDocument();
  });

  it("composes the shared IngresarMenu without re-owning menu logic", () => {
    // Both marketing audiences share one shell; public browsing owns the
    // second usage. Login destinations still live only in IngresarMenu.
    expect(source).toContain('from "@/components/navigation/IngresarMenu"');
    expect(source.match(/<IngresarMenu\b/g)).toHaveLength(2);
    expect(source).not.toContain("/candidato/login");
    expect(source).not.toContain("/empresa/login");
    expect(source).not.toContain("@base-ui/react/menu");
    expect(source).not.toContain("DropdownMenu");
  });

  it("renders the reference h-7 wordmark in the marketing nav", () => {
    stubMatchMedia();
    renderMarketingNavbar();
    const header = document.querySelector("header")!;
    const marks = header.querySelectorAll("img[alt='PeopleFlow']");
    expect(marks.length).toBeGreaterThanOrEqual(1);
    expect(marks[0].className).toContain("h-7");
  });
});

describe("PeopleFlowNavbar candidate marketing mode", () => {
  it("shares the employer capsule geometry and violet CTA with working candidate anchors", () => {
    stubMatchMedia();
    const { container, rerender } = render(<PeopleFlowNavbar mode="marketing" />);
    const shellClass = container.querySelector("header")?.className;
    const surfaceClass = container.querySelector("[data-pf-nav-floating]")?.className;
    rerender(<PeopleFlowNavbar mode="candidate-marketing" />);
    expect(container.querySelector("header")?.className).toBe(shellClass);
    expect(container.querySelector("[data-pf-nav-floating]")?.className).toBe(surfaceClass);
    expect(container.querySelector("header")).toHaveAttribute("id", "nav");
    expect(screen.getByRole("link", { name: "Cómo funciona" })).toHaveAttribute("href", "#soluciones");
    expect(screen.getByRole("link", { name: "Oportunidades" })).toHaveAttribute("href", "#producto");
    expect(screen.getByRole("link", { name: "Explorar vacantes" })).toHaveClass("bg-brand", "btn-primary");
  });

  it("offers real discovery and employer links without changing the candidate shell mode", () => {
    stubMatchMedia();
    render(<PeopleFlowNavbar mode="candidate-marketing" />);
    expect(document.querySelector("[data-pf-candidate-marketing-navbar]")).not.toBeNull();
    for (const link of screen.getAllByRole("link", { name: "Para empresas" })) expect(link).toHaveAttribute("href", "/");
    for (const link of screen.getAllByRole("link", { name: "Explorar vacantes" })) expect(link).toHaveAttribute("href", "/vacantes");
    expect(screen.getByRole("link", { name: "PeopleFlow" })).toHaveAttribute("href", "/candidatos");
    expect(screen.getAllByRole("button", { name: /^ingresar$/i })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /cambiar tema/i })).toHaveLength(1);
  });
});

// ─── Public mode tests (shared floating capsule on browsing routes) ──────────

describe("PeopleFlowNavbar public mode", () => {
  it("renders the PeopleFlow brand link to / with an honest 40px target", () => {
    stubMatchMedia();
    renderPublicNavbar();
    const brand = document.querySelector("header a[aria-label='PeopleFlow']")!;
    expect(brand).toHaveAttribute("href", "/");
    // The brand keeps an honest >=40px pointer target at every width.
    expect(brand).toHaveClass("inline-flex", "min-h-10", "items-center");
  });

  it("renders only real public destinations, in order, with no Recursos", () => {
    stubMatchMedia();
    renderPublicNavbar();
    const header = document.querySelector("header")!;
    const links = Array.from(
      header.querySelectorAll("[data-pf-public-nav-links] a"),
    );
    expect(
      links.map((a) => [a.textContent?.trim(), a.getAttribute("href")]),
    ).toEqual([
      ["Vacantes", "/vacantes"],
      ["Empresas", EMPRESAS_HREF],
    ]);
    // The unsupported placeholder is removed and no anchor is a bare hash.
    expect(findHeaderLink(header, "Recursos")).toBeUndefined();
    for (const anchor of Array.from(header.querySelectorAll("a"))) {
      expect(anchor.getAttribute("href"), anchor.textContent!).not.toBe("#");
    }
  });

  it("renders the sticky shell and the shared floating capsule surface", () => {
    stubMatchMedia();
    renderPublicNavbar();
    const header = document.querySelector("header[data-pf-public-navbar]")!;
    // The sticky shell owns positioning but never the surface treatment.
    expect(header).toHaveClass("sticky", "top-0");
    expect(header.className).not.toContain("backdrop-blur-md");
    const surface = header.querySelector("nav[data-pf-nav-floating]")!;
    expect(surface.getAttribute("aria-label")).toBe("Navegación principal");
    expect(surface).toHaveClass(
      "mx-auto", "rounded-2xl", "border", "border-border/80",
      "bg-background/70", "shadow-lg", "backdrop-blur-md",
      "max-w-[1280px]",
    );
  });

  it("shares the exact marketing capsule frame without duplicating markup", () => {
    stubMatchMedia();
    const marketing = renderMarketingNavbar();
    const frame = document.querySelector("nav[data-pf-nav-floating]")!;
    marketing.unmount();
    renderPublicNavbar();
    // One shared frame: identical geometry and surface tokens in both modes.
    expect(
      document.querySelector("nav[data-pf-nav-floating]")!.className,
    ).toBe(frame.className);
  });

  it("gives every public plain-text control an explicit >=40px target", () => {
    stubMatchMedia();
    renderPublicNavbar();
    const header = document.querySelector("header")!;
    expectNavTarget(
      header.querySelector("a[aria-label='PeopleFlow']"),
      "public brand",
    );
    for (const label of ["Vacantes", "Empresas", "Publicar vacante"]) {
      expectNavTarget(findHeaderLink(header, label) ?? null, label);
    }
  });

  it("orders the public actions Ingresar, theme, then Publicar vacante", () => {
    stubMatchMedia();
    renderPublicNavbar();
    const header = document.querySelector("header")!;
    const cta = findHeaderLink(header, "Publicar vacante")!;
    expect(cta).toHaveAttribute("href", "/empresa/vacantes/nueva");
    const actions = Array.from(cta.parentElement!.children);
    expect(actions).toHaveLength(3);
    expect(actions[0]).toBe(ingresarTrigger());
    expect(actions[1]).toHaveAttribute("data-pf-theme-toggle");
    expect(actions[2]).toBe(cta);
  });

  it("keeps the Ingresar trigger and CTA reachable with intact labels at 375px", () => {
    stubMatchMedia();
    renderPublicNavbar();
    // The Ingresar trigger keeps its >=40px target and never hides on mobile.
    expect(ingresarTrigger()).toHaveClass("min-h-10");
    expect(ingresarTrigger().className).not.toMatch(/(?:^|\s)\S*hidden(?:\s|$)/);
    // The CTA compacts padding/typography below sm, never its label or its
    // 40px minimum target.
    const cta = findHeaderLink(document.querySelector("header")!, "Publicar vacante")!;
    expect(cta.className).toContain("min-h-10");
    expect(cta.className).toContain("max-sm:px-2.5");
    expect(cta.className).toContain("max-sm:text-[13px]");
    expect(cta.textContent?.trim()).toBe("Publicar vacante");
  });

  it("hides the desktop public destinations below md", () => {
    stubMatchMedia();
    renderPublicNavbar();
    const list = document.querySelector("header [data-pf-public-nav-links]")!;
    expect(list.className).toContain("hidden");
    expect(list.className).toContain("md:flex");
  });

  it("renders exactly the shared login trigger and theme toggle, never a hamburger", () => {
    stubMatchMedia();
    renderPublicNavbar();
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons).toContain(ingresarTrigger());
    expect(
      screen.getByRole("button", { name: /cambiar tema/i }),
    ).toBeInTheDocument();
    // The login entry is the shared menu, not a sheet/hamburger control.
    expect(
      screen.queryByRole("button", { name: /abr?ir?.*men[úu]/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps the removed Recursos placeholder out of the navbar source", () => {
    expect(source).not.toMatch(/"Recursos"|#recursos/);
  });
});

// ─── Shared tests ────────────────────────────────────────────────────────────

describe("PeopleFlowNavbar shared behavior", () => {
  it("renders the brand wordmark at reference h-6 height in candidate mode", () => {
    stubMatchMedia();
    renderCandidateNavbar();
    // Both light and dark marks render; verify at least one is h-6
    const brandImages = screen.getAllByAltText(/peopleflow/i);
    expect(brandImages.length).toBeGreaterThanOrEqual(1);
    expect(brandImages[0].className).toContain("h-6");
  });

  it("keeps every link addressable with a non-null href", () => {
    stubMatchMedia();
    renderMarketingNavbar();
    const anchors = screen.getAllByRole("link");
    for (const anchor of anchors) {
      expect(anchor.getAttribute("href")).not.toBeNull();
    }
  });
});
