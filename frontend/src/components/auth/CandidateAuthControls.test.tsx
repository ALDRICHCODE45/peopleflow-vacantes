import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ fetch: vi.fn(), navigate: vi.fn(), notify: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), session: { status: "unauthenticated", data: null } as { status: string; data: { error?: string } | null }, query: new URLSearchParams() }));
vi.mock("next-auth/react", () => ({ SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>, useSession: () => auth.session, signIn: auth.signIn, signOut: auth.signOut }));
vi.mock("next/navigation", () => ({ useSearchParams: () => auth.query }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: auth.notify }));
vi.mock("./sign-in/navigate", () => ({ navigateTo: auth.navigate }));
import { CandidateAuthControls } from "./CandidateAuthControls";
const PASSWORD = "Fixture#Pass2026";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => {
  vi.resetAllMocks();
  auth.session = { status: "unauthenticated", data: null }; auth.query = new URLSearchParams();
  auth.signIn.mockResolvedValue({ ok: true, error: null, status: 200, url: "http://localhost:3000/candidato/ingresar" });
  vi.stubGlobal("fetch", auth.fetch);
});
function signInWithPassword() {
  fireEvent.change(screen.getByLabelText("Correo"), { target: { value: "ximena@correo.com" } });
  fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: PASSWORD } });
  fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));
}
it.each(["/vacantes?search=react&estado=published", "/vacantes?search=React+Next&ciudad=M%C3%A9xico", "/vacantes/job-123", "/vacantes/job-123/postular"])("password sign-in goes through /candidato/ingresar carrying next: %s", async next => {
  auth.query.set("next", next);
  render(<CandidateAuthControls />);
  signInWithPassword();
  const callbackUrl = `/candidato/ingresar?next=${encodeURIComponent(next)}`;
  await waitFor(() => expect(auth.signIn).toHaveBeenCalledWith("password", { redirect: false, email: "ximena@correo.com", password: PASSWORD, callbackUrl }));
  await waitFor(() => expect(auth.navigate).toHaveBeenCalledWith(callbackUrl));
});
it("social sign-in carries the same candidate callback", () => {
  auth.signIn.mockReturnValue(new Promise(() => {}));
  auth.query.set("next", "/vacantes/job-123");
  render(<CandidateAuthControls socialProviders={[{ id: "linkedin", identityProvider: "LinkedIn" }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Continuar con LinkedIn" }));
  expect(auth.signIn).toHaveBeenCalledWith("cognito", { callbackUrl: "/candidato/ingresar?next=%2Fvacantes%2Fjob-123" }, { identity_provider: "LinkedIn" });
});
it("signed-in account link preserves next without bypassing role checks", () => {
  auth.session = { status: "authenticated", data: {} };
  auth.query.set("next", "/vacantes/job-123");
  render(<CandidateAuthControls />);
  expect(screen.getByRole("link", { name: "Ir a mi cuenta" })).toHaveAttribute("href", "/candidato/ingresar?next=%2Fvacantes%2Fjob-123");
});
it.each([
  ["absolute", "https://evil.test/vacantes"], ["scheme", "javascript:alert(1)"],
  ["protocol-relative", "//evil.test"], ["slash-backslash", "/\\evil.test"],
  ["backslash", "/vacantes\\evil"], ["relative", "vacantes"],
  ["leading whitespace", " /vacantes"], ["control", "/vacantes\n"],
  ["encoded tab", "/%09/evil.test"], ["format character", "/\u200bevil.test"],
  ["encoded login loop", "/candidato/%6cogin"], ["api root", "/api"],
  ["loop with trailing slash", "/candidato/ingresar/"],
  ["encoded control", "/vacantes%0d%0aLocation:evil"],
  ["encoded authority", "/%2fevil.test"], ["double encoded authority", "/%252fevil.test"],
  ["encoded backslash", "/%5cevil.test"], ["api", "/api/auth/signout"],
  ["normalized api", "/vacantes/../api/auth/signout"], ["encoded api", "/%61pi/auth"],
  ["login loop", "/candidato/login?next=/vacantes"], ["entry loop", "/candidato/ingresar"],
  ["normalized loop", "/vacantes/../candidato/login"], ["malformed escape", "/%zz"],
  ["overlong", "/" + "a".repeat(4096)],
])("sign-in silently rejects %s next", async (_rule, next) => {
  auth.query.set("next", next);
  render(<CandidateAuthControls />);
  signInWithPassword();
  await waitFor(() => expect(auth.signIn).toHaveBeenCalledWith("password", expect.objectContaining({ callbackUrl: "/candidato/ingresar" })));
  await waitFor(() => expect(auth.navigate).toHaveBeenCalledWith("/candidato/ingresar"));
  expect(screen.queryByRole("alert")).toBeNull();
});
it("no longer offers the hosted Cognito sign-up: «Crea tu perfil» is a PeopleFlow route outside these controls", () => {
  render(<CandidateAuthControls />);
  expect(screen.queryByRole("button", { name: "Crear cuenta" })).toBeNull();
  expect(screen.queryByText(/Cognito/)).toBeNull();
  expect(auth.fetch).not.toHaveBeenCalled();
});
it("disables sign-in while loading", () => {
  auth.session.status = "loading"; render(<CandidateAuthControls />);
  signInWithPassword();
  expect(auth.signIn).not.toHaveBeenCalled();
});
it("uses generic callback and expired messages", () => {
  auth.query = new URLSearchParams("error=private-value");
  const view = render(<CandidateAuthControls />);
  expect(screen.getByRole("alert")).toHaveTextContent("No pudimos completar el acceso. Inténtalo de nuevo.");
  auth.session = { status: "authenticated", data: { error: "RefreshAccessTokenError" } }; view.rerender(<CandidateAuthControls />);
  expect(screen.getByRole("status")).toHaveTextContent("Tu sesión venció. Vuelve a ingresar.");
  expect(screen.queryByText(/private-value/)).toBeNull();
});
it("keeps a signed-in route exit and candidate logout", async () => {
  auth.session = { status: "authenticated", data: {} }; render(<CandidateAuthControls />);
  expect(screen.getByRole("link", { name: "Ir a mi cuenta" })).toHaveAttribute("href", "/candidato/ingresar");
  expect(screen.queryByLabelText("Contraseña")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
  await waitFor(() => expect(auth.signOut).toHaveBeenCalledWith({ callbackUrl: "/api/auth/cognito/logout?to=candidato" }));
});
it("reports a logout failure without disclosing its detail", async () => {
  auth.session = { status: "authenticated", data: {} };
  auth.signOut.mockRejectedValueOnce(new Error("secret"));
  render(<CandidateAuthControls />);
  fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No pudimos cerrar la sesión. Inténtalo de nuevo."));
  expect(auth.notify).toHaveBeenCalledWith(expect.objectContaining({ type: "error", title: "No pudimos cerrar la sesión", reference: expect.any(Object) }));
  expect(screen.queryByText("secret")).toBeNull();
});
it("ignores a stale callback error once signed in", () => {
  auth.session = { status: "authenticated", data: {} };
  auth.query = new URLSearchParams("error=OAuthCallback");
  render(<CandidateAuthControls />);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Ir a mi cuenta" })).toBeInTheDocument();
});
