import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ csrf: vi.fn(), fetch: vi.fn(), assign: vi.fn(), notify: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), session: { status: "unauthenticated", data: null } as { status: string; data: { error?: string } | null }, query: new URLSearchParams() }));
vi.mock("next-auth/react", () => ({ SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>, useSession: () => auth.session, signIn: auth.signIn, signOut: auth.signOut, getCsrfToken: auth.csrf }));
vi.mock("next/navigation", () => ({ useSearchParams: () => auth.query }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: auth.notify }));
import { CandidateAuthControls } from "./CandidateAuthControls";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const query = "client_id=client&state=a%2fb%2B&code_challenge=pkce&redirect_uri=https%3A%2F%2Fapp.example%2Fapi%2Fauth%2Fcallback%2Fcognito&scope=openid+email&extra=%7e&extra=two";
const authorizeUrl = `https://pool.auth.us-east-1.amazoncognito.com/oauth2/authorize?${query}`;
beforeEach(() => {
  vi.resetAllMocks();
  auth.session = { status: "unauthenticated", data: null }; auth.query = new URLSearchParams();
  auth.csrf.mockResolvedValue("csrf-fixture");
  auth.fetch.mockResolvedValue({ ok: true, json: async () => ({ url: authorizeUrl }) });
  vi.stubGlobal("fetch", auth.fetch);
  const testWindow = Object.create(window);
  Object.defineProperty(testWindow, "location", { value: { assign: auth.assign } });
  vi.stubGlobal("window", testWindow);
});
it("Ingresar uses the sole Cognito provider and fixed candidate callback", async () => {
  const label = "Ingresar";
  const { container } = render(<CandidateAuthControls />);
  expect(container.querySelector("input, form")).toBeNull();
  expect(screen.queryByText(/Google|LinkedIn/)).toBeNull();
  expect(auth.signIn).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: label }));
  await waitFor(() => expect(auth.signIn).toHaveBeenCalledWith("cognito", { callbackUrl: "/candidato/ingresar" }));
});
it("Crear cuenta starts the CSRF-protected NextAuth transaction and navigates to signup", async () => {
  render(<CandidateAuthControls />);
  fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
  await waitFor(() => expect(auth.assign).toHaveBeenCalledWith(`https://pool.auth.us-east-1.amazoncognito.com/signup?${query}`));
  expect(auth.csrf).toHaveBeenCalledOnce();
  expect(auth.fetch).toHaveBeenCalledWith("/api/auth/signin/cognito", {
    method: "post", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken: "csrf-fixture", callbackUrl: "/candidato/ingresar", json: "true" }),
  });
  expect(auth.signIn).not.toHaveBeenCalled();
});
it("navigates to a non-authorize response unchanged", async () => {
  const url = "https://app.example/api/auth/error?error=OAuthSignin";
  auth.fetch.mockResolvedValue({ ok: true, json: async () => ({ url }) });
  render(<CandidateAuthControls />);
  fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
  await waitFor(() => expect(auth.assign).toHaveBeenCalledWith(url));
});
it.each(["missing csrf", "non-ok", "missing url", "malformed url", "script url", "network"])("shows existing error and toast on signup failure: %s", async failure => {
  if (failure === "missing csrf") auth.csrf.mockResolvedValue(null);
  if (failure === "non-ok") auth.fetch.mockResolvedValue({ ok: false });
  if (failure === "missing url") auth.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  // Verify finding: a non-empty value that is not an absolute http(s) URL was assigned as a relative navigation.
  if (failure === "malformed url") auth.fetch.mockResolvedValue({ ok: true, json: async () => ({ url: "not a URL" }) });
  if (failure === "script url") auth.fetch.mockResolvedValue({ ok: true, json: async () => ({ url: "javascript:alert(1)" }) });
  if (failure === "network") auth.fetch.mockRejectedValue(new Error("secret"));
  render(<CandidateAuthControls />);
  fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No pudimos iniciar el acceso. Inténtalo de nuevo."));
  expect(auth.notify).toHaveBeenCalledWith(expect.objectContaining({ type: "error", title: "No pudimos iniciar el acceso" }));
  expect(auth.assign).not.toHaveBeenCalled();
  if (failure === "missing csrf") expect(auth.fetch).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Crear cuenta" })).toBeEnabled();
});
it.each(["Ingresar", "Crear cuenta"])("locks double clicks and both buttons while %s is pending", async label => {
  let resolve!: (value: string) => void;
  const pending = new Promise<string>(done => { resolve = done; });
  auth.signIn.mockReturnValue(pending); auth.csrf.mockReturnValue(pending);
  render(<CandidateAuthControls />);
  const button = screen.getByRole("button", { name: label });
  fireEvent.click(button); fireEvent.click(button);
  expect(screen.getByRole("button", { name: "Ingresar" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Crear cuenta" })).toBeDisabled();
  expect(label === "Ingresar" ? auth.signIn : auth.csrf).toHaveBeenCalledOnce();
  resolve("csrf-fixture");
  await waitFor(() => expect(button).toBeEnabled());
  if (label === "Crear cuenta") expect(auth.fetch).toHaveBeenCalledOnce();
});
it("disables both controls while loading", () => {
  auth.session.status = "loading"; render(<CandidateAuthControls />);
  expect(screen.getByRole("button", { name: "Ingresar" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Crear cuenta" })).toBeDisabled();
});
it("uses generic callback and expired messages", () => {
  auth.query = new URLSearchParams("error=private-value");
  const view = render(<CandidateAuthControls />);
  expect(screen.getByRole("alert")).toHaveTextContent("No pudimos completar el acceso. Inténtalo de nuevo.");
  auth.session = { status: "authenticated", data: { error: "RefreshAccessTokenError" } }; view.rerender(<CandidateAuthControls />);
  expect(screen.getByRole("alert")).toHaveTextContent("Tu sesión venció. Vuelve a ingresar.");
  expect(screen.queryByText(/private-value/)).toBeNull();
});
it("keeps a signed-in route exit and candidate logout", async () => {
  auth.session = { status: "authenticated", data: {} }; render(<CandidateAuthControls />);
  expect(screen.getByRole("link", { name: "Ir a mi cuenta" })).toHaveAttribute("href", "/candidato/ingresar");
  fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
  await waitFor(() => expect(auth.signOut).toHaveBeenCalledWith({ callbackUrl: "/api/auth/cognito/logout?to=candidato" }));
});
it.each(["Ingresar", "Crear cuenta"])("%s does not disclose sign-in exception details", async label => {
  auth.signIn.mockRejectedValueOnce(new Error("secret"));
  auth.csrf.mockRejectedValueOnce(new Error("secret"));
  render(<CandidateAuthControls />);
  fireEvent.click(screen.getByRole("button", { name: label }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No pudimos iniciar el acceso. Inténtalo de nuevo."));
  expect(auth.notify).toHaveBeenCalledWith(expect.objectContaining({ type: "error", reference: expect.any(Object) }));
  expect(screen.getByRole("button", { name: "Ingresar" })).toHaveAttribute("aria-describedby");
  expect(screen.queryByText("secret")).toBeNull();
});
it("ignores a stale callback error once signed in", () => {
  auth.session = { status: "authenticated", data: {} };
  auth.query = new URLSearchParams("error=OAuthCallback");
  render(<CandidateAuthControls />);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Ir a mi cuenta" })).toBeInTheDocument();
});
