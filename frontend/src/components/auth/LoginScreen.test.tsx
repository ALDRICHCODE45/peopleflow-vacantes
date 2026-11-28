import * as React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import CandidateLoginPage, { dynamic as candidateDynamic, metadata as candidateMetadata } from "../../app/(auth)/candidato/login/page";
import EmployerLoginPage, { dynamic as employerDynamic, metadata as employerMetadata } from "../../app/(auth)/empresa/login/page";
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

// The shell itself never reads the network: only its injected controls do.
const fetchSpy = vi.fn(() => Promise.reject(new Error("login shell must not call any API")));

// CCP-R7D2C: jsdom has no WebGL, so the OGL leaf is stubbed here and the real
// canvas/palette/blend proof lives in the Chromium slice. The stub renders the
// leaf's own host element and echoes the `variant` prop, which is exactly what
// the shell must wire. The real sign-in leaves are covered by their own tests
// (EmployerAuthControls, CandidateAuthControls, sign-in/SignInForm); here they
// echo the social providers the route resolved on the server.
type Providers = { socialProviders?: readonly { id: string; identityProvider: string }[] };
vi.mock("./CandidateAuthControls", () => ({
  CandidateAuthControls: ({ socialProviders = [] }: Providers) => (
    <div data-testid="candidate-controls" data-providers={socialProviders.map((p) => p.id).join(",")}><button type="button">Ingresar</button></div>
  ),
}));
vi.mock("./EmployerAuthControls", () => ({
  EmployerAuthControls: ({ socialProviders = [] }: Providers) => (
    <div data-testid="employer-controls" data-providers={socialProviders.map((p) => p.id).join(",")}><button type="button">Ingresar</button></div>
  ),
}));

vi.mock("./FloatingLines", () => ({
  FloatingLines: ({ variant, className }: { variant: string; className?: string }) => (
    <div data-floating-lines-host="" data-floating-lines-variant={variant} className={className} />
  ),
}));

const controls = <div data-testid="controls"><button type="button">Ingresar</button></div>;

beforeAll(() => {
  // The shell mounts the persisted ThemeToggle client leaf; jsdom implements
  // neither matchMedia nor, therefore, that leaf's media listener.
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("fetch", fetchSpy);
});

beforeEach(() => {
  fetchSpy.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("LoginScreen variant copy", () => {
  it("renders the employer reference copy around its sign-in controls", () => {
    render(<LoginScreen variant="employer" authControls={controls} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Ingresa a tu cuenta");
    expect(screen.getByText("Gestiona tus vacantes y tu pipeline.")).toBeInTheDocument();
    expect(screen.getByText("Acceso empresas")).toBeInTheDocument();
    expect(screen.getByTestId("controls")).toBeInTheDocument();
  });

  it("renders the candidate reference copy around its sign-in controls", () => {
    render(<LoginScreen variant="candidate" authControls={controls} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Ingresa a tu perfil");
    expect(screen.getByText("Sigue tus postulaciones y su estado.")).toBeInTheDocument();
    expect(screen.getByText("Acceso candidatos")).toBeInTheDocument();
  });
});

describe("LoginScreen shell truthfulness", () => {
  it("no longer carries the inert placeholder shell: no read-only credential inputs or handler-less auth buttons", () => {
    const { container } = render(<LoginScreen variant="employer" authControls={controls} />);
    expect(container.querySelectorAll("input[readonly]")).toHaveLength(0);
    expect(screen.queryByRole("group", { name: "Datos de acceso" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Registra tu empresa|Olvidaste/ })).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("bans implementation-status and demo vocabulary from the rendered shell copy", () => {
    for (const variant of ["employer", "candidate"] as const) {
      const { container, unmount } = render(<LoginScreen variant={variant} authControls={controls} />);
      expect(container.textContent ?? "").not.toMatch(PROHIBITED_COPY);
      unmount();
    }
  });
});

describe("LoginScreen navigation and theme control", () => {
  it("links each variant to its own account-creation route (A4.4 / A4.5)", () => {
    const employer = render(<LoginScreen variant="employer" authControls={controls} />);
    expect(screen.getByText(/¿No tienes cuenta\?/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Registra tu empresa" })).toHaveAttribute("href", "/empresa/registro");
    employer.unmount();
    render(<LoginScreen variant="candidate" authControls={controls} />);
    expect(screen.getByText(/¿No tienes perfil\?/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Crea tu perfil" })).toHaveAttribute("href", "/candidato/registro");
  });

  it("links each variant to its genuine reciprocal route and back to the root", () => {
    const employer = render(<LoginScreen variant="employer" authControls={controls} />);
    expect(screen.getByRole("link", { name: /ingresa aquí/i })).toHaveAttribute("href", "/candidato/login");
    expect(document.querySelectorAll('a[href="/"]').length).toBeGreaterThan(0);
    employer.unmount();
    render(<LoginScreen variant="candidate" authControls={controls} />);
    expect(screen.getByRole("link", { name: /ingresa aquí/i })).toHaveAttribute("href", "/empresa/login");
  });

  it("keeps 44 px targets on the footer links", () => {
    render(<LoginScreen variant="candidate" authControls={controls} />);
    for (const name of ["Crea tu perfil", "Ingresa aquí", "Volver al inicio"]) {
      expect(screen.getByRole("link", { name }).className).toContain("min-h-11");
    }
  });

  it("keeps the persisted ThemeToggle as the shell's own client leaf", () => {
    render(<LoginScreen variant="candidate" authControls={controls} />);
    expect(screen.getByRole("button", { name: /cambiar tema/i })).toHaveAttribute("data-pf-theme-toggle");
  });
});

describe("LoginScreen static visual panel", () => {
  it("renders one decorative desktop-only panel with the white wordmark the animation needs in both themes", () => {
    const { container } = render(<LoginScreen variant="employer" authControls={controls} />);
    const panel = container.querySelector("[data-login-visual-panel]");
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute("aria-hidden", "true");
    // Desktop-only: hidden below lg, visible from lg up.
    expect(panel?.className).toContain("hidden");
    expect(panel?.className).toContain("lg:block");
    // The animated panel renders dark in both themes, so the panel always uses the
    // dark-scheme (white) wordmark; the theme-swapped black one read as «flow» alone.
    const marks = Array.from(panel!.querySelectorAll("img"));
    expect(marks).toHaveLength(1);
    expect(marks[0]!.getAttribute("src") ?? "").toContain("peopleflow-dark.webp");
    expect(marks[0]!.className).not.toMatch(/brand-mark-(light|dark)/);
    expect(marks[0]!.closest("[aria-hidden='true']")).not.toBeNull();
    // The mobile wordmark outside the panel keeps following the theme.
    const mobile = Array.from(container.querySelectorAll("a[href='/'] img"));
    expect(mobile.map(mark => mark.className.match(/brand-mark-(light|dark)/)?.[0])).toEqual(["brand-mark-light", "brand-mark-dark"]);
  });

  it("carries no keep-signed-in checkbox or its style (L18)", () => {
    render(<LoginScreen variant="employer" authControls={controls} />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/Mantener sesión iniciada/)).not.toBeInTheDocument();
    expect(visualPanelCss).not.toMatch(/\.checkbox\b/);
  });

  it("keeps a theme-aware panel fallback: warm light base over the dark baseline", () => {
    // Dark baseline stays the repository --background value.
    expect(visualPanelCss).toContain("#0c0912");
    // Explicit/system light becomes the warm --base so the inverted white
    // framebuffer multiplies neutrally instead of over an opaque black panel.
    expect(visualPanelCss).toMatch(/:global\(html:not\(\.dark\)\)\s+\.visualPanel\.visualPanel\s*\{[^}]*#f7f5fb/i);
  });

  it("keeps one main landmark and the mobile brand link", () => {
    const { container } = render(<LoginScreen variant="candidate" authControls={controls} />);
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
      const { container, unmount } = render(<LoginScreen variant={variant} authControls={controls} />);
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
    const { container } = render(<LoginScreen variant="employer" authControls={controls} />);
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

  it("renders the exact variant from each route with its real sign-in controls", () => {
    const employer = render(<EmployerLoginPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Ingresa a tu cuenta");
    expect(screen.getByTestId("employer-controls")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cognito/ })).not.toBeInTheDocument();
    employer.unmount();
    render(<CandidateLoginPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Ingresa a tu perfil");
    expect(screen.getByTestId("candidate-controls")).toBeInTheDocument();
  });

  it("hands the server-enabled social providers to each route's controls", () => {
    vi.stubEnv("AUTH_SOCIAL_GOOGLE", "on");
    vi.stubEnv("AUTH_SOCIAL_LINKEDIN", "on");
    vi.stubEnv("AUTH_SOCIAL_MICROSOFT", "off");
    const employer = render(<EmployerLoginPage />);
    expect(screen.getByTestId("employer-controls")).toHaveAttribute("data-providers", "google,linkedin");
    employer.unmount();
    render(<CandidateLoginPage />);
    expect(screen.getByTestId("candidate-controls")).toHaveAttribute("data-providers", "google,linkedin");
  });

  it("still renders both routes, without social buttons, when a social flag is invalid", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("AUTH_SOCIAL_GOOGLE", "yes");
    const employer = render(<EmployerLoginPage />);
    expect(screen.getByTestId("employer-controls")).toHaveAttribute("data-providers", "");
    employer.unmount();
    render(<CandidateLoginPage />);
    expect(screen.getByTestId("candidate-controls")).toHaveAttribute("data-providers", "");
  });

  it("renders per request so social flags are read at runtime, not frozen at build", () => {
    expect(employerDynamic).toBe("force-dynamic");
    expect(candidateDynamic).toBe("force-dynamic");
  });
});
