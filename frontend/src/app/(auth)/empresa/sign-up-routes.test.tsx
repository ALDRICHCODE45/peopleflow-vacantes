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
vi.mock("@/components/auth/company/CompanyStepForm", () => ({
  CompanyStepForm: () => <form data-testid="company-step-form" />,
}));

import SignUpPage, { metadata as signUpMetadata } from "./registro/page";
import VerifyPage, { metadata as verifyMetadata } from "./verificar/page";
import CompanyStepPage, { metadata as companyMetadata } from "./registro/empresa/page";

beforeAll(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(cleanup);

describe("/empresa/registro (Tu cuenta · Paso 1 de 3)", () => {
  it("renders «Registra tu empresa» with the step in the eyebrow, the employer form and FloatingLines kept, not indexed", () => {
    const { container } = render(<SignUpPage />);
    expect(screen.getByText("Registro de empresa · Paso 1 de 3")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Registra tu empresa");
    expect(screen.getByText("Primero tu cuenta; después, los datos de tu empresa.")).toBeInTheDocument();
    expect(screen.getByTestId("sign-up-form")).toHaveAttribute("data-audience", "employer");
    expect(container.querySelectorAll("[data-floating-lines-host]")).toHaveLength(1);
    expect(container.querySelector("[data-floating-lines-host]")).toHaveAttribute("data-floating-lines-variant", "employer");
    expect(signUpMetadata.robots).toEqual({ index: false, follow: false });
    expect(signUpMetadata.title).toBe("Registra tu empresa");
  });

  it("links back to «Ingresar», to the candidate sign-up and home", () => {
    render(<SignUpPage />);
    expect(screen.getByRole("link", { name: "Ingresa" })).toHaveAttribute("href", "/empresa/login");
    expect(screen.getByRole("link", { name: "Crea tu perfil de candidato" })).toHaveAttribute("href", "/candidato/registro");
    expect(screen.getByRole("link", { name: "Volver al inicio" })).toHaveAttribute("href", "/");
  });
});

describe("/empresa/verificar (Paso 2 de 3)", () => {
  it("hands the employer audience to the verify form, which owns heading and footer", () => {
    const { container } = render(<VerifyPage />);
    expect(screen.getByTestId("verify-form")).toHaveAttribute("data-audience", "employer");
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(container.querySelector("[data-floating-lines-host]")).toHaveAttribute("data-floating-lines-variant", "employer");
    expect(verifyMetadata.robots).toEqual({ index: false, follow: false });
  });
});

describe("/empresa/registro/empresa (Tu empresa · Paso 3 de 3)", () => {
  it("frames the company step in the employer shell, the form owning heading and footer", () => {
    const { container } = render(<CompanyStepPage />);
    expect(screen.getByTestId("company-step-form")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Volver al inicio" })).not.toBeInTheDocument();
    expect(container.querySelectorAll("[data-floating-lines-host]")).toHaveLength(1);
    expect(container.querySelector("[data-floating-lines-host]")).toHaveAttribute("data-floating-lines-variant", "employer");
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(companyMetadata.title).toBe("Tu empresa");
    expect(companyMetadata.robots).toEqual({ index: false, follow: false });
  });
});
