import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/components/auth/FloatingLines", () => ({
  FloatingLines: ({ variant }: { variant: string }) => <div data-floating-lines-host="" data-floating-lines-variant={variant} />,
}));
vi.mock("@/components/auth/forgot-password/ForgotPasswordForm", () => ({
  ForgotPasswordForm: ({ audience }: { audience: string }) => <form data-testid="forgot-password-form" data-audience={audience} />,
}));

import { AUTH_PATHS } from "@/components/auth/sign-in/routes";
import EmployerRecoverPage, { metadata as employerMetadata } from "./empresa/recuperar/page";
import CandidateRecoverPage, { metadata as candidateMetadata } from "./candidato/recuperar/page";

beforeAll(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(cleanup);

describe.each([
  ["employer", "/empresa/recuperar", EmployerRecoverPage, employerMetadata],
  ["candidate", "/candidato/recuperar", CandidateRecoverPage, candidateMetadata],
] as const)("%s recovery route (%s)", (audience, path, Page, metadata) => {
  it("is the path «¿Olvidaste tu contraseña?» already links to", () => {
    expect(AUTH_PATHS[audience].forgot).toBe(path);
  });

  it("frames the form in the audience shell with FloatingLines kept; the form owns heading and footer; not indexed", () => {
    const { container } = render(<Page />);
    expect(screen.getByTestId("forgot-password-form")).toHaveAttribute("data-audience", audience);
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Volver al inicio" })).not.toBeInTheDocument();
    expect(container.querySelectorAll("[data-floating-lines-host]")).toHaveLength(1);
    expect(container.querySelector("[data-floating-lines-host]")).toHaveAttribute("data-floating-lines-variant", audience);
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(metadata.title).toBe("Restablece tu contraseña");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
