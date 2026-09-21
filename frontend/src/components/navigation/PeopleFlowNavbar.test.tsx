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

  it("renders the four product links as placeholders", () => {
    stubMatchMedia();
    renderMarketingNavbar();
    const header = document.querySelector("header")!;
    for (const label of ["Producto", "Soluciones", "Precios", "Recursos"]) {
      const link = findHeaderLink(header, label);
      expect(link, `nav link ${label}`).toBeDefined();
      expect(link).toHaveAttribute("href", "#");
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
    expect(header).not.toHaveTextContent(/candidato|empresa/i);
  });

  it("renders the Empezar gratis primary CTA as a placeholder", () => {
    stubMatchMedia();
    renderMarketingNavbar();
    const header = document.querySelector("header")!;
    const cta = findHeaderLink(header, "Empezar gratis");
    expect(cta).toBeDefined();
    expect(cta).toHaveAttribute("href", "#");
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

  it("renders the sticky reference header shell", () => {
    stubMatchMedia();
    renderMarketingNavbar();
    const header = document.querySelector("[data-pf-marketing-navbar]");
    expect(header).toBeInTheDocument();
    expect(header).toHaveClass("sticky", "top-0", "backdrop-blur-md");
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

  it("composes the shared IngresarMenu once without re-owning menu logic", () => {
    // Shared component is used exactly once; destinations must not be
    // duplicated in the navbar.
    expect(source).toContain('from "@/components/navigation/IngresarMenu"');
    expect(source.match(/<IngresarMenu\b/g)).toHaveLength(1);
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
