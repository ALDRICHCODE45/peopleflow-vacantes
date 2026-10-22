import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  signIn: vi.fn(), signOut: vi.fn(),
  session: { status: "unauthenticated", data: null } as {
    status: "loading" | "authenticated" | "unauthenticated";
    data: { user?: { name?: string }; error?: string } | null;
  },
  query: new URLSearchParams(),
}));
vi.mock("next-auth/react", () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSession: () => auth.session,
  signIn: auth.signIn, signOut: auth.signOut,
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => auth.query }));

import { EmployerAuthControls } from "./EmployerAuthControls";

afterEach(cleanup);
beforeEach(() => {
  auth.session = { status: "unauthenticated", data: null };
  auth.query = new URLSearchParams();
  auth.signIn.mockReset().mockResolvedValue(undefined);
  auth.signOut.mockReset().mockResolvedValue(undefined);
});

describe("employer managed login", () => {
  it("delegates login to Cognito without collecting credentials or offering unsupported providers", async () => {
    const { container } = render(<EmployerAuthControls />);
    expect(container.querySelector('input, form')).toBeNull();
    expect(screen.queryByText(/Google|Microsoft|Mantener sesión/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ingresar con Cognito" }));
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledWith("cognito", { callbackUrl: "/empresa/login" }));
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("disables login while session state is loading", () => {
    auth.session = { status: "loading", data: null };
    render(<EmployerAuthControls />);
    expect(screen.getByRole("button", { name: /ingresar/i })).toBeDisabled();
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it("prevents duplicate login requests while redirect initiation is pending", async () => {
    let resolve!: () => void;
    auth.signIn.mockImplementation(() => new Promise<void>((done) => { resolve = done; }));
    render(<EmployerAuthControls />);
    const button = screen.getByRole("button", { name: "Ingresar con Cognito" });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(auth.signIn).toHaveBeenCalledTimes(1);
    resolve();
    await waitFor(() => expect(button).toBeEnabled());
  });

  it("shows a generic accessible login failure without exposing provider detail", async () => {
    auth.signIn.mockRejectedValue(new Error("secret-provider-response"));
    render(<EmployerAuthControls />);
    fireEvent.click(screen.getByRole("button", { name: "Ingresar con Cognito" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("No pudimos iniciar el acceso. Inténtalo de nuevo."));
    expect(screen.queryByText(/secret-provider-response/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ingresar con Cognito" })).toBeEnabled();
  });

  it("renders generic callback error feedback without reflecting untrusted query text", () => {
    auth.query = new URLSearchParams("error=private-token-from-query");
    render(<EmployerAuthControls />);
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos completar el acceso. Inténtalo de nuevo.");
    expect(screen.queryByText(/private-token-from-query/)).not.toBeInTheDocument();
  });
});

describe("employer return path", () => {
  it("returns to the requested employer page after signing in", async () => {
    auth.query = new URLSearchParams("callbackUrl=%2Fempresa%2Fequipo");
    render(<EmployerAuthControls />);
    fireEvent.click(screen.getByRole("button", { name: "Ingresar con Cognito" }));
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledWith("cognito", { callbackUrl: "/empresa/equipo" }));
  });

  it.each(["https://evil.example/empresa", "//evil.example/empresa", "/candidato/perfil", "/empresa/../api/x", "/empresa\\evil", "empresa/equipo", "http://localhost:3000/empresa/login"])("never follows an unsafe return path %s", async callbackUrl => {
    auth.query = new URLSearchParams({ callbackUrl });
    render(<EmployerAuthControls />);
    fireEvent.click(screen.getByRole("button", { name: "Ingresar con Cognito" }));
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledWith("cognito", { callbackUrl: "/empresa/login" }));
  });
});

describe("employer session and logout", () => {
  it("does not claim company permissions from the authenticated identity", () => {
    auth.session = { status: "authenticated", data: { user: { name: "Recruiter" } } };
    render(<EmployerAuthControls />);
    expect(screen.getByRole("status")).toHaveTextContent("Sesión iniciada.");
    expect(screen.queryByRole("button", { name: /ingresar/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeEnabled();
    expect(screen.queryByText(/permisos confirmados|empresa verificada/i)).not.toBeInTheDocument();
  });

  it("ignores a stale callback error once signed in and links to the company panel", () => {
    // A slow first token exchange can leave ?error=OAuthCallback in the URL even
    // though a later attempt signed in: the page must not claim the access failed.
    auth.session = { status: "authenticated", data: { user: { name: "Recruiter" } } };
    auth.query = new URLSearchParams("error=OAuthCallback");
    render(<EmployerAuthControls />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir a mi panel" })).toHaveAttribute("href", "/empresa/dashboard");
  });

  it("clears the local session via NextAuth before its redirect to the same-origin federated logout endpoint", async () => {
    auth.session = { status: "authenticated", data: { user: {} } };
    render(<EmployerAuthControls />);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledWith({ callbackUrl: "/api/auth/cognito/logout" }));
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it("does not claim a valid session after refresh failure and offers relogin plus session clearing", () => {
    auth.session = { status: "authenticated", data: { error: "RefreshAccessTokenError" } };
    render(<EmployerAuthControls />);
    expect(screen.queryByText("Sesión iniciada.")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Tu sesión venció. Vuelve a ingresar.");
    expect(screen.getByRole("button", { name: "Ingresar con Cognito" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeEnabled();
  });

  it("reports logout failure and never claims successful logout", async () => {
    auth.session = { status: "authenticated", data: { user: {} } };
    auth.signOut.mockRejectedValue(new Error("private-refresh-token"));
    render(<EmployerAuthControls />);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cerrar la sesión. Inténtalo de nuevo."));
    expect(screen.queryByText(/private-refresh-token/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeEnabled();
  });
});
