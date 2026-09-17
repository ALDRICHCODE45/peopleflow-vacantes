import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { PeopleFlowNavbar } from "@/components/navigation/PeopleFlowNavbar";

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

  it("renders the reference nav link set as placeholder links", () => {
    stubMatchMedia();
    renderMarketingNavbar();
    const header = document.querySelector("header")!;
    for (const label of ["Producto", "Soluciones", "Precios", "Recursos"]) {
      const link = findHeaderLink(header, label);
      expect(link, `nav link ${label}`).toBeDefined();
      expect(link).toHaveAttribute("href", "#");
    }
  });

  it("renders the Iniciar sesión link as a placeholder", () => {
    stubMatchMedia();
    renderMarketingNavbar();
    const header = document.querySelector("header")!;
    const login = findHeaderLink(header, "Iniciar sesión");
    expect(login).toBeDefined();
    expect(login).toHaveAttribute("href", "#");
  });

  it("renders the Empezar gratis primary CTA as a placeholder", () => {
    stubMatchMedia();
    renderMarketingNavbar();
    const header = document.querySelector("header")!;
    const cta = findHeaderLink(header, "Empezar gratis");
    expect(cta).toBeDefined();
    expect(cta).toHaveAttribute("href", "#");
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

  it("renders no mobile hamburger or sheet (reference nav has none)", () => {
    stubMatchMedia();
    renderMarketingNavbar();
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute("data-pf-theme-toggle");
    expect(
      screen.queryByRole("button", { name: /abr?ir?.*men[úu]/i }),
    ).not.toBeInTheDocument();
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
