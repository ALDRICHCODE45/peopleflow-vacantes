import * as React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import CandidateLoginPage, { metadata as candidateMetadata } from "../../app/(auth)/candidato/login/page";
import EmployerLoginPage, { metadata as employerMetadata } from "../../app/(auth)/empresa/login/page";
import { LoginScreen } from "./LoginScreen";

const DISCLOSURE = "Vista previa: acceso aún no disponible.";

// CCP-R7D1: the OGL motion belongs to CCP-R7D2, so this slice must ship the
// static fallback only. The source assertion keeps that slice boundary honest.
const shellSource = readFileSync(join(process.cwd(), "src/components/auth/LoginScreen.tsx"), "utf8");

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
  it("renders one decorative desktop-only panel with the fixed white wordmark", () => {
    const { container } = render(<LoginScreen variant="employer" />);
    const panel = container.querySelector("[data-login-visual-panel]");
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute("aria-hidden", "true");
    // Desktop-only: hidden below lg, visible from lg up.
    expect(panel?.className).toContain("hidden");
    expect(panel?.className).toContain("lg:block");
    const wordmarks = Array.from(panel!.querySelectorAll("img"));
    expect(wordmarks).toHaveLength(1);
    expect(wordmarks[0]!.getAttribute("src") ?? "").toContain("peopleflow-dark.webp");
    expect(wordmarks[0]!.getAttribute("alt")).toBe("");
  });

  it("keeps one main landmark and the mobile brand link", () => {
    const { container } = render(<LoginScreen variant="candidate" />);
    expect(container.querySelectorAll("main")).toHaveLength(1);
    const brandLink = container.querySelector('a[href="/"]');
    expect(brandLink).not.toBeNull();
    expect(brandLink!.querySelectorAll("img").length).toBeGreaterThan(0);
  });

  it("defers the OGL motion: no FloatingLines leaf exists in this slice", () => {
    const { container } = render(<LoginScreen variant="candidate" />);
    expect(container.querySelector("[data-floating-lines-host]")).toBeNull();
    expect(shellSource).not.toMatch(/FloatingLines/);
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
