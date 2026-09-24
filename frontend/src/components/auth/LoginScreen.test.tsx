import * as React from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import CandidateLoginPage, { metadata as candidateMetadata } from "../../app/(auth)/candidato/login/page";
import EmployerLoginPage, { metadata as employerMetadata } from "../../app/(auth)/empresa/login/page";
import { LoginScreen } from "./LoginScreen";

// UISC-02: no rendered implementation-status vocabulary may survive. Sales copy
// such as a date picker or the audit trail is out of scope; these are the exact
// disclosure words the shell used to print.
const PROHIBITED_COPY = /vista previa|aún no disponible|no disponible|demo|mock|prototip|prueba|maqueta|local|unavailable/iu;

// Vitest runs from frontend/, so the CSS-module source is read directly: jsdom
// never loads the stylesheet, and the panel fallback is a visual contract.
const visualPanelCss = readFileSync(
  join(process.cwd(), "src/components/auth/login-screen.module.css"),
  "utf8",
);

// The shell must never read the network. A named spy makes the negative
// assertion inspectable instead of implied by the stubbed rejection.
const fetchSpy = vi.fn(() => Promise.reject(new Error("login shell must not call any API")));

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
  vi.stubGlobal("fetch", fetchSpy);
});

beforeEach(() => {
  fetchSpy.mockClear();
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
    expect(fetchSpy).not.toHaveBeenCalled();
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

  it("enables exactly the intended visible auth actions and drops the preview disclosure", () => {
    const { container } = render(<LoginScreen variant="candidate" />);
    // The visible <p role="status"> disclosure is gone, not merely reworded.
    expect(container.querySelectorAll('[role="status"], [role="alert"]')).toHaveLength(0);
    // No placeholder is left disabled: every rendered control is enabled.
    expect(container.querySelectorAll("[disabled], [aria-disabled='true']")).toHaveLength(0);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(6); // theme toggle + CTA + 2 providers + forgot + register
    for (const button of buttons) expect(button).toBeEnabled();
    for (const name of [
      "Ingresar",
      "Continuar con Google",
      "Continuar con LinkedIn",
      "¿Olvidaste tu contraseña?",
      "Crea tu perfil",
    ]) {
      expect(screen.getByRole("button", { name})).toBeEnabled();
    }
    expect(screen.getByRole("checkbox", { name: "Mantener sesión iniciada" })).toBeEnabled();
    expect(screen.getByRole("group", { name: "Datos de acceso" })).toBeInTheDocument();
  });

  it("renders recovery and registration as enabled, keyboard-focusable buttons, never links", () => {
    const { container } = render(<LoginScreen variant="employer" />);
    const forgot = screen.getByRole("button", { name: "¿Olvidaste tu contraseña?" });
    const register = screen.getByRole("button", { name: "Registra tu empresa" });
    for (const control of [forgot, register]) {
      expect(control.tagName).toBe("BUTTON");
      expect(control).toHaveAttribute("type", "button");
      expect(control).toBeEnabled();
      expect(control).not.toHaveAttribute("href");
      expect(control).not.toHaveAttribute("onclick");
      expect(control.closest("form")).toBeNull();
      expect(control.closest("a")).toBeNull();
    }
    // Only the root and the genuine reciprocal route stay real anchors.
    const hrefs = Array.from(container.querySelectorAll("a")).map((anchor) => anchor.getAttribute("href"));
    expect(hrefs.length).toBeGreaterThanOrEqual(2);
    expect(hrefs.every((href) => href === "/" || href === "/candidato/login")).toBe(true);
  });

  it("keeps every auth control inert: activation neither navigates nor reaches the network", () => {
    const { container } = render(<LoginScreen variant="employer" />);
    const controls = Array.from(container.querySelectorAll("button, input[type='checkbox']"));
    expect(controls.length).toBeGreaterThanOrEqual(6);
    for (const control of controls) {
      expect(control).not.toHaveAttribute("href");
      expect(control).not.toHaveAttribute("onclick");
      expect(control.closest("a")).toBeNull();
      expect(control.closest("form")).toBeNull();
    }
    const before = window.location.href;
    fireEvent.click(screen.getByRole("button", { name: "¿Olvidaste tu contraseña?" }));
    fireEvent.click(screen.getByRole("button", { name: "Registra tu empresa" }));
    fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Mantener sesión iniciada" }));
    expect(window.location.href).toBe(before);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("bans implementation-status and demo vocabulary from the rendered shell copy", () => {
    for (const variant of ["employer", "candidate"] as const) {
      const { container, unmount } = render(<LoginScreen variant={variant} />);
      expect(container.textContent ?? "").not.toMatch(PROHIBITED_COPY);
      unmount();
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
