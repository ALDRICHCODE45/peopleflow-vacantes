import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/components/auth/FloatingLines", () => ({
  FloatingLines: ({ variant }: { variant: string }) => <div data-floating-lines-host="" data-floating-lines-variant={variant} />,
}));
vi.mock("@/components/auth/sign-up/SignUpForm", () => ({
  SignUpForm: ({ audience }: { audience: string }) => <form data-testid="sign-up-form" data-audience={audience} />,
}));
vi.mock("@/components/auth/verify/VerifyForm", () => ({
  VerifyForm: ({ audience }: { audience: string }) => <form data-testid="verify-form" data-audience={audience} />,
}));

import SignUpPage, { metadata as signUpMetadata } from "./registro/page";
import VerifyPage, { metadata as verifyMetadata } from "./verificar/page";

beforeAll(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(cleanup);

describe("/candidato/registro", () => {
  it("renders «Crea tu perfil» in the login shell with FloatingLines kept, not indexed", () => {
    const { container } = render(<SignUpPage />);
    expect(screen.getByText("Crear perfil")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Crea tu perfil");
    expect(screen.getByText("Postúlate en minutos y sigue cada proceso.")).toBeInTheDocument();
    expect(screen.getByTestId("sign-up-form")).toHaveAttribute("data-audience", "candidate");
    expect(container.querySelectorAll("[data-floating-lines-host]")).toHaveLength(1);
    expect(container.querySelector("[data-floating-lines-host]")).toHaveAttribute("data-floating-lines-variant", "candidate");
    expect(signUpMetadata.robots).toEqual({ index: false, follow: false });
  });

  it("links back to «Ingresar», to the employer sign-up and home, with 44 px targets", () => {
    render(<SignUpPage />);
    expect(screen.getByText(/¿Ya tienes perfil\?/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ingresa" })).toHaveAttribute("href", "/candidato/login");
    expect(screen.getByText(/¿Contratas para tu empresa\?/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Registra tu empresa" })).toHaveAttribute("href", "/empresa/registro");
    for (const name of ["Ingresa", "Registra tu empresa", "Volver al inicio"]) {
      expect(screen.getByRole("link", { name }).className).toContain("min-h-11");
    }
    expect(screen.queryByRole("link", { name: "Crea tu perfil" })).not.toBeInTheDocument();
  });
});

describe("/candidato/verificar", () => {
  it("leaves the heading and footer to the verify form (they depend on the carried email) and keeps FloatingLines", () => {
    const { container } = render(<VerifyPage />);
    expect(screen.getByTestId("verify-form")).toHaveAttribute("data-audience", "candidate");
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Crea tu perfil" })).not.toBeInTheDocument();
    expect(container.querySelectorAll("[data-floating-lines-host]")).toHaveLength(1);
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(verifyMetadata.robots).toEqual({ index: false, follow: false });
  });
});
