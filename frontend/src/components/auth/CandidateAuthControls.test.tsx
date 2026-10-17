import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ notify: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), session: { status: "unauthenticated", data: null } as { status: string; data: { error?: string } | null }, query: new URLSearchParams() }));
vi.mock("next-auth/react", () => ({ SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>, useSession: () => auth.session, signIn: auth.signIn, signOut: auth.signOut }));
vi.mock("next/navigation", () => ({ useSearchParams: () => auth.query }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: auth.notify }));
import { CandidateAuthControls } from "./CandidateAuthControls";
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); auth.session = { status: "unauthenticated", data: null }; auth.query = new URLSearchParams(); });
it.each(["Ingresar", "Crear cuenta"])("%s uses the sole Cognito provider and fixed candidate callback", async label => {
  const { container } = render(<CandidateAuthControls />);
  expect(container.querySelector("input, form")).toBeNull();
  expect(screen.queryByText(/Google|LinkedIn/)).toBeNull();
  expect(auth.signIn).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: label }));
  await waitFor(() => expect(auth.signIn).toHaveBeenCalledWith("cognito", { callbackUrl: "/candidato/ingresar" }));
});
it("disables both controls while loading", () => {
  auth.session.status = "loading"; render(<CandidateAuthControls />);
  expect(screen.getByRole("button", { name: "Ingresar" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Crear cuenta" })).toBeDisabled();
});
it("uses generic callback and expired messages", () => {
  auth.query = new URLSearchParams("error=private-value");
  const view = render(<CandidateAuthControls />);
  expect(screen.getByRole("alert")).toHaveTextContent("No pudimos completar el acceso. Intentá nuevamente.");
  auth.session = { status: "authenticated", data: { error: "RefreshAccessTokenError" } }; view.rerender(<CandidateAuthControls />);
  expect(screen.getByRole("alert")).toHaveTextContent("Tu sesión venció. Volvé a ingresar.");
  expect(screen.queryByText(/private-value/)).toBeNull();
});
it("keeps a signed-in route exit and candidate logout", async () => {
  auth.session = { status: "authenticated", data: {} }; render(<CandidateAuthControls />);
  expect(screen.getByRole("link", { name: "Ir a mi cuenta" })).toHaveAttribute("href", "/candidato/ingresar");
  fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
  await waitFor(() => expect(auth.signOut).toHaveBeenCalledWith({ callbackUrl: "/api/auth/cognito/logout?to=candidato" }));
});
it("does not disclose sign-in exception details", async () => {
  auth.signIn.mockRejectedValueOnce(new Error("secret")); render(<CandidateAuthControls />);
  fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No pudimos iniciar el acceso. Intentá nuevamente."));
  expect(auth.notify).toHaveBeenCalledWith(expect.objectContaining({ type: "error", reference: expect.any(Object) }));
  expect(screen.getByRole("button", { name: "Ingresar" })).toHaveAttribute("aria-describedby");
  expect(screen.queryByText("secret")).toBeNull();
});
