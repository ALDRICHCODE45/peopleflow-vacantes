import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  signIn: vi.fn(), signOut: vi.fn(), navigate: vi.fn(),
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
vi.mock("./sign-in/navigate", () => ({ navigateTo: auth.navigate }));

import { EmployerAuthControls } from "./EmployerAuthControls";

const PASSWORD = "Fixture#Pass2026";

afterEach(cleanup);
beforeEach(() => {
  auth.session = { status: "unauthenticated", data: null };
  auth.query = new URLSearchParams();
  auth.signIn.mockReset().mockResolvedValue({ ok: true, error: null, status: 200, url: "http://localhost:3000/empresa/dashboard" });
  auth.signOut.mockReset().mockResolvedValue(undefined);
  auth.navigate.mockReset();
});

function signInWithPassword() {
  fireEvent.change(screen.getByLabelText("Correo corporativo"), { target: { value: "laura@empresa.mx" } });
  fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: PASSWORD } });
  fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));
}

describe("employer embedded sign-in", () => {
  it("collects email and password in PeopleFlow and no longer offers the hosted Cognito page", async () => {
    render(<EmployerAuthControls />);
    expect(screen.queryByRole("button", { name: /Cognito/i })).not.toBeInTheDocument();
    signInWithPassword();
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledExactlyOnceWith("password", {
      redirect: false, email: "laura@empresa.mx", password: PASSWORD, callbackUrl: "/empresa/dashboard",
    }));
    await waitFor(() => expect(auth.navigate).toHaveBeenCalledExactlyOnceWith("/empresa/dashboard"));
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("shows social buttons only for the providers the server enabled", () => {
    render(<EmployerAuthControls socialProviders={[{ id: "microsoft", identityProvider: "Microsoft" }]} />);
    expect(screen.getByRole("button", { name: "Continuar con Microsoft" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continuar con Google" })).not.toBeInTheDocument();
  });

  it("disables sign-in while session state is loading", () => {
    auth.session = { status: "loading", data: null };
    render(<EmployerAuthControls />);
    signInWithPassword();
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it("renders generic callback error feedback without reflecting untrusted query text", () => {
    auth.query = new URLSearchParams("error=private-token-from-query");
    render(<EmployerAuthControls />);
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos completar el acceso. Inténtalo de nuevo.");
    expect(screen.queryByText(/private-token-from-query/)).not.toBeInTheDocument();
  });

  it("shows the already-registered notice for a social sign-in whose email has a password account", () => {
    auth.query = new URLSearchParams("error=email_in_use");
    render(<EmployerAuthControls />);
    expect(screen.getByRole("status")).toHaveTextContent("Ese correo ya tiene cuenta. Entra con tu contraseña.");
  });
});

describe("employer return path", () => {
  it("returns to the requested employer page after signing in", async () => {
    auth.query = new URLSearchParams("callbackUrl=%2Fempresa%2Fequipo");
    render(<EmployerAuthControls />);
    signInWithPassword();
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledWith("password", expect.objectContaining({ callbackUrl: "/empresa/equipo" })));
    await waitFor(() => expect(auth.navigate).toHaveBeenCalledWith("/empresa/equipo"));
  });

  it("carries the same return path into a social sign-in", () => {
    auth.signIn.mockReturnValue(new Promise(() => {}));
    auth.query = new URLSearchParams("callbackUrl=%2Fempresa%2Fequipo");
    render(<EmployerAuthControls socialProviders={[{ id: "google", identityProvider: "Google" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Continuar con Google" }));
    expect(auth.signIn).toHaveBeenCalledWith("cognito", { callbackUrl: "/empresa/equipo" }, { identity_provider: "Google" });
  });

  it.each(["https://evil.example/empresa", "//evil.example/empresa", "/candidato/perfil", "/empresa/../api/x", "/empresa\\evil", "empresa/equipo", "http://localhost:3000/empresa/login", "/empresa/login", "/empresa/login/"])("never follows an unsafe return path %s", async callbackUrl => {
    auth.query = new URLSearchParams({ callbackUrl });
    render(<EmployerAuthControls />);
    signInWithPassword();
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledWith("password", expect.objectContaining({ callbackUrl: "/empresa/dashboard" })));
    await waitFor(() => expect(auth.navigate).toHaveBeenCalledWith("/empresa/dashboard"));
  });
});

describe("employer session and logout", () => {
  it("does not claim company permissions from the authenticated identity", () => {
    auth.session = { status: "authenticated", data: { user: { name: "Recruiter" } } };
    render(<EmployerAuthControls />);
    expect(screen.getByRole("status")).toHaveTextContent("Sesión iniciada.");
    expect(screen.queryByRole("button", { name: /ingresar/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Contraseña")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeEnabled();
    expect(screen.queryByText(/permisos confirmados|empresa verificada/i)).not.toBeInTheDocument();
  });

  it("ignores a stale callback error once signed in and links to the company panel", () => {
    auth.session = { status: "authenticated", data: { user: { name: "Recruiter" } } };
    auth.query = new URLSearchParams("error=OAuthCallback");
    render(<EmployerAuthControls />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir a mi panel" })).toHaveAttribute("href", "/empresa/dashboard");
  });

  it("clears the local session via NextAuth before its redirect to the same-origin logout endpoint", async () => {
    auth.session = { status: "authenticated", data: { user: {} } };
    render(<EmployerAuthControls />);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledWith({ callbackUrl: "/api/auth/cognito/logout" }));
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it("does not claim a valid session after refresh failure and offers the sign-in form with the expired banner", () => {
    auth.session = { status: "authenticated", data: { error: "RefreshAccessTokenError" } };
    render(<EmployerAuthControls />);
    expect(screen.queryByText("Sesión iniciada.")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Tu sesión venció. Vuelve a ingresar.");
    expect(screen.getByLabelText("Contraseña")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ingresar" })).toBeInTheDocument();
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
