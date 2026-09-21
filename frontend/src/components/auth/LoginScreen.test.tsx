import * as React from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import CandidateLoginPage, { metadata as candidateMetadata } from "../../app/(auth)/candidato/login/page";
import EmployerLoginPage, { metadata as employerMetadata } from "../../app/(auth)/empresa/login/page";
import { LoginScreen } from "./LoginScreen";

const DISCLOSURE = "Vista previa: acceso aún no disponible.";

// Vitest runs from frontend/, so the CSS-module source is read directly: jsdom
// never loads the stylesheet, and the panel fallback is a visual contract.
const visualPanelCss = readFileSync(
  join(process.cwd(), "src/components/auth/login-screen.module.css"),
  "utf8",
);

// CCP-R7D2C: jsdom has no WebGL, so the OGL leaf is stubbed here and the real
// canvas/palette/blend proof lives in the Chromium slice. The stub renders the
// leaf's own host element and echoes the `variant` prop, which is exactly what
// the shell must wire.
vi.mock("./FloatingLines", () => ({
  FloatingLines: ({ variant, className }: { variant: string; className?: string }) => (
    <div data-floating-lines-host="" data-floating-lines-variant={variant} className={className} />
  ),
}));

beforeAll(() => {
  // The shell mounts the persisted ThemeToggle client leaf; jsdom implements
  // neither matchMedia nor, therefore, that leaf's media listener.
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  // Visual-only stage: rendering must never trigger a network read.
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("login shell must not call any API"))));
});

describe("LoginScreen variant copy", () => {
  it("renders the employer reference copy and providers", () => {
    render(<LoginScreen variant="employer" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Ingresa a tu cuenta");
    expect(screen.getByText("Gestiona tus vacantes y tu pipeline.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continuar con microsoft/i })).toBeInTheDocument();
  });

  it("renders the candidate reference copy and providers", () => {
    render(<LoginScreen variant="candidate" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Ingresa a tu perfil");
    expect(screen.getByText("Sigue tus postulaciones y su estado.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continuar con linkedin/i })).toBeInTheDocument();
  });
});

describe("LoginScreen truthfulness and security", () => {
  it("renders no form, no submit surface and no credential names", () => {
    const { container } = render(<LoginScreen variant="employer" />);
    expect(container.querySelector("form")).toBeNull();
    expect(document.querySelector('[name="email"], [name="password"], [name="remember"]')).toBeNull();
    expect(document.querySelectorAll('button[type="submit"], input[type="submit"]')).toHaveLength(0);
  });

  it("keeps both credential inputs non-editable, unnamed and fixed empty", () => {
    render(<LoginScreen variant="employer" />);
    const email = screen.getByLabelText("Email corporativo");
    const password = screen.getByLabelText("Contraseña");
    expect(email).toHaveAttribute("type", "email");
    expect(password).toHaveAttribute("type", "password");
    for (const field of [email, password]) {
      expect(field).toHaveAttribute("readonly");
      expect(field).toHaveValue("");
      expect(field).not.toHaveAttribute("name");
    }
  });

  it("disables every unavailable auth action and discloses the preview", () => {
    render(<LoginScreen variant="candidate" />);
    expect(screen.getByRole("button", { name: "Ingresar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /continuar con google/i })).toBeDisabled();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByText(DISCLOSURE)).toBeInTheDocument();
  });

  it("keeps recovery and registration as plain unavailable text, never links", () => {
    render(<LoginScreen variant="employer" />);
    expect(screen.getByText(/¿olvidaste tu contraseña\?/i)).toBeInTheDocument();
    expect(screen.getByText(/registra tu empresa/i)).toBeInTheDocument();
    for (const anchor of Array.from(document.querySelectorAll("a"))) {
      expect(anchor.getAttribute("href")).not.toBe("#");
    }
  });
});

describe("LoginScreen navigation and theme control", () => {
  it("links each variant to its genuine reciprocal route and back to the root", () => {
    const employer = render(<LoginScreen variant="employer" />);
    expect(screen.getByRole("link", { name: /ingresa aquí/i })).toHaveAttribute("href", "/candidato/login");
    expect(document.querySelectorAll('a[href="/"]').length).toBeGreaterThan(0);
    employer.unmount();
    render(<LoginScreen variant="candidate" />);
    expect(screen.getByRole("link", { name: /ingresa aquí/i })).toHaveAttribute("href", "/empresa/login");
  });

  it("keeps the persisted ThemeToggle as the shell's own client leaf", () => {
    render(<LoginScreen variant="candidate" />);
    expect(screen.getByRole("button", { name: /cambiar tema/i })).toHaveAttribute("data-pf-theme-toggle");
  });
});

describe("LoginScreen static visual panel", () => {
  it("renders one decorative desktop-only panel with both approved theme marks", () => {
    const { container } = render(<LoginScreen variant="employer" />);
    const panel = container.querySelector("[data-login-visual-panel]");
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute("aria-hidden", "true");
    // Desktop-only: hidden below lg, visible from lg up.
    expect(panel?.className).toContain("hidden");
    expect(panel?.className).toContain("lg:block");
    // Both approved marks, swapped by theme through the canonical brand
    // classes instead of a hard-coded, permanently white wordmark.
    const marks = Array.from(panel!.querySelectorAll("img"));
    expect(marks).toHaveLength(2);
    expect(marks[0]!.getAttribute("src") ?? "").toContain("peopleflow-light.webp");
    expect(marks[1]!.getAttribute("src") ?? "").toContain("peopleflow-dark.webp");
    expect(marks[0]!.className).toContain("brand-mark-light");
    expect(marks[1]!.className).toContain("brand-mark-dark");
    // The panel stays decorative: the marks live inside the aria-hidden stage.
    for (const mark of marks) expect(mark.closest("[aria-hidden='true']")).not.toBeNull();
  });

  it("keeps a theme-aware panel fallback: warm light base over the dark baseline", () => {
    // Dark baseline stays the repository --background value.
    expect(visualPanelCss).toContain("#0c0912");
    // Explicit/system light becomes the warm --base so the inverted white
    // framebuffer multiplies neutrally instead of over an opaque black panel.
    expect(visualPanelCss).toMatch(/:global\(html:not\(\.dark\)\)\s+\.visualPanel\.visualPanel\s*\{[^}]*#f7f5fb/i);
  });

  it("keeps one main landmark and the mobile brand link", () => {
    const { container } = render(<LoginScreen variant="candidate" />);
    expect(container.querySelectorAll("main")).toHaveLength(1);
    const brandLink = container.querySelector('a[href="/"]');
    expect(brandLink).not.toBeNull();
    expect(brandLink!.querySelectorAll("img").length).toBeGreaterThan(0);
  });

  it("mounts exactly one variant-wired FloatingLines host inside the decorative panel", () => {
    for (const [variant, heading] of [
      ["employer", "Ingresa a tu cuenta"],
      ["candidate", "Ingresa a tu perfil"],
    ] as const) {
      const { container, unmount } = render(<LoginScreen variant={variant} />);
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(heading);
      const panel = container.querySelector("[data-login-visual-panel]");
      expect(panel).not.toBeNull();
      const hosts = panel!.querySelectorAll("[data-floating-lines-host]");
      // Exactly one animated leaf, inside the (already aria-hidden) panel.
      expect(hosts).toHaveLength(1);
      expect(hosts[0]).toHaveAttribute("data-floating-lines-variant", variant);
      // No second host anywhere in the shell.
      expect(container.querySelectorAll("[data-floating-lines-host]")).toHaveLength(1);
      unmount();
    }
  });

  it("keeps the animated leaf as the first child under the z-10 white wordmark and the static tint layer", () => {
    const { container } = render(<LoginScreen variant="employer" />);
    const panel = container.querySelector("[data-login-visual-panel]")!;
    expect(panel.firstElementChild).toBe(panel.querySelector("[data-floating-lines-host]"));
    // The static branded tint stays wired on the panel as the fallback layer.
    expect(panel.className).toMatch(/visualPanel/);
    expect(panel.lastElementChild!.className).toContain("z-10");
  });
});

describe("login routes", () => {
  it("exports a unique title and an explicit noindex/nofollow contract", () => {
    expect(employerMetadata.title).toBe("Ingreso empresas");
    expect(candidateMetadata.title).toBe("Ingreso candidatos");
    expect(employerMetadata.title).not.toBe(candidateMetadata.title);
    expect(employerMetadata.robots).toEqual({ index: false, follow: false });
    expect(candidateMetadata.robots).toEqual({ index: false, follow: false });
  });

  it("renders the exact variant from each route", () => {
    const employer = render(<EmployerLoginPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Ingresa a tu cuenta");
    employer.unmount();
    render(<CandidateLoginPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Ingresa a tu perfil");
  });
});
