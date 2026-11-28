import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ signIn: vi.fn(), assign: vi.fn() }));
vi.mock("next-auth/react", () => ({ signIn: auth.signIn }));
vi.mock("./navigate", () => ({ navigateTo: auth.assign }));

import { SignInForm, type SignInFormProps } from "./SignInForm";
import { PENDING_EMAIL_KEY } from "./pending-email";

const PASSWORD = "Fixture#Pass2026";
const GOOGLE = { id: "google" as const, identityProvider: "Google" };
const MICROSOFT = { id: "microsoft" as const, identityProvider: "Microsoft" };
const LINKEDIN = { id: "linkedin" as const, identityProvider: "LinkedIn" };

function renderForm(props: Partial<SignInFormProps> = {}) {
  return render(<SignInForm audience="employer" callbackUrl="/empresa/dashboard" socialProviders={[]} {...props} />);
}

function fill(email = "laura@empresa.mx", password = PASSWORD) {
  fireEvent.change(screen.getByLabelText(/^Correo/), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: password } });
}

const submit = () => fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));

beforeEach(() => {
  auth.signIn.mockReset().mockResolvedValue({ ok: true, error: null, status: 200, url: "http://localhost:3000/empresa/dashboard" });
  auth.assign.mockReset();
  window.sessionStorage.clear();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("sign-in form fields (artboard 01 · Ingresar)", () => {
  it("renders labelled email and password fields with password-manager hints and the audience copy", () => {
    const { container } = renderForm();
    const email = screen.getByLabelText("Correo corporativo");
    const password = screen.getByLabelText("Contraseña");
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "username");
    expect(email).toHaveAttribute("placeholder", "tu@empresa.com");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(container.querySelector("form")).toHaveAttribute("novalidate");
    // The form never posts natively: no action, no GET query with the password.
    expect(container.querySelector("form")).not.toHaveAttribute("action");
    cleanup();
    renderForm({ audience: "candidate", callbackUrl: "/candidato/ingresar" });
    expect(screen.getByLabelText("Correo")).toHaveAttribute("placeholder", "tu@correo.com");
  });

  it("links «¿Olvidaste tu contraseña?» to the audience's recovery route", () => {
    renderForm();
    expect(screen.getByRole("link", { name: "¿Olvidaste tu contraseña?" })).toHaveAttribute("href", "/empresa/recuperar");
    cleanup();
    renderForm({ audience: "candidate", callbackUrl: "/candidato/ingresar" });
    expect(screen.getByRole("link", { name: "¿Olvidaste tu contraseña?" })).toHaveAttribute("href", "/candidato/recuperar");
  });

  it("shows and hides the password with a pressed toggle button that names its action", () => {
    renderForm();
    const password = screen.getByLabelText("Contraseña");
    const toggle = screen.getByRole("button", { name: "Mostrar contraseña" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveAttribute("aria-controls", password.id);
    expect(toggle).toHaveAttribute("type", "button");
    fireEvent.click(toggle);
    expect(password).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Ocultar contraseña" })).toHaveAttribute("aria-pressed", "true");
  });

  it("gives every control at least a 44 px target", () => {
    renderForm({ socialProviders: [GOOGLE] });
    for (const name of ["Mostrar contraseña", "Ingresar", "Continuar con Google"]) {
      expect(screen.getByRole("button", { name }).className).toMatch(/(?:min-h|h|size)-(?:11|12)\b/);
    }
    expect(screen.getByRole("link", { name: "¿Olvidaste tu contraseña?" }).className).toMatch(/min-h-11/);
  });
});

describe("password submit", () => {
  it("submits through NextAuth's password provider without redirect and lands on the callback URL", async () => {
    renderForm({ callbackUrl: "/empresa/equipo" });
    fill("  laura@empresa.mx ");
    submit();
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledExactlyOnceWith("password", {
      redirect: false, email: "laura@empresa.mx", password: PASSWORD, callbackUrl: "/empresa/equipo",
    }));
    await waitFor(() => expect(auth.assign).toHaveBeenCalledExactlyOnceWith("/empresa/equipo"));
  });

  it("hides the password again on submit and never writes it to storage or the URL", async () => {
    renderForm();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Mostrar contraseña" }));
    submit();
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("type", "password");
    await waitFor(() => expect(auth.assign).toHaveBeenCalled());
    expect(String(auth.assign.mock.calls[0]?.[0])).not.toContain(PASSWORD);
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain(PASSWORD);
  });

  it("shows «Ingresando…», keeps the fields read-only and ignores a second submit while pending", async () => {
    let resolve!: (value: unknown) => void;
    auth.signIn.mockReturnValue(new Promise((done) => { resolve = done; }));
    const { container } = renderForm({ socialProviders: [GOOGLE] });
    fill();
    submit();
    const busy = screen.getByRole("button", { name: /Ingresando/ });
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(container.querySelector("form")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "Continuar con Google" })).toBeDisabled();
    fireEvent.click(busy);
    fireEvent.submit(container.querySelector("form")!);
    expect(auth.signIn).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ ok: false, error: "invalid_credentials", status: 401, url: null }));
    expect(screen.getByRole("button", { name: "Ingresar" })).not.toHaveAttribute("aria-disabled");
  });

  it("asks for the missing field locally, tied to it, focusing the first one, without calling NextAuth", () => {
    renderForm();
    submit();
    const email = screen.getByLabelText("Correo corporativo");
    const password = screen.getByLabelText("Contraseña");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(email.getAttribute("aria-describedby")!.split(" ")[0]!)).toHaveTextContent("Escribe tu correo.");
    expect(document.getElementById(password.getAttribute("aria-describedby")!.split(" ")[0]!)).toHaveTextContent("Escribe tu contraseña.");
    expect(email).toHaveFocus();
    expect(auth.signIn).not.toHaveBeenCalled();
  });
});

describe("error mapping and copy", () => {
  async function failWith(result: unknown, props: Partial<SignInFormProps> = {}) {
    auth.signIn.mockResolvedValue(result);
    renderForm(props);
    fill();
    submit();
    return waitFor(() => screen.getByRole("alert"));
  }

  it("shows the generic «Correo o contraseña incorrectos.», marks both fields, clears the password and focuses the summary", async () => {
    const alert = await failWith({ ok: false, error: "invalid_credentials", status: 401, url: null });
    expect(alert).toHaveTextContent("Correo o contraseña incorrectos.");
    expect(alert).toHaveAttribute("tabindex", "-1");
    await waitFor(() => expect(alert).toHaveFocus());
    const email = screen.getByLabelText("Correo corporativo");
    const password = screen.getByLabelText("Contraseña");
    for (const field of [email, password]) {
      expect(field).toHaveAttribute("aria-invalid", "true");
      expect(field.getAttribute("aria-describedby")?.split(" ")).toContain(alert.id);
    }
    expect(password).toHaveValue("");
    expect(email).toHaveValue("laura@empresa.mx");
    expect(auth.assign).not.toHaveBeenCalled();
  });

  it("shows «Demasiados intentos.» with a way to reset the password, keeping the button active", async () => {
    const alert = await failWith({ ok: false, error: "too_many_attempts", status: 429, url: null });
    expect(alert).toHaveTextContent("Demasiados intentos.");
    expect(alert).toHaveTextContent("Espera unos minutos antes de volver a intentarlo o restablece tu contraseña.");
    expect(screen.getByRole("link", { name: "Restablecer contraseña" })).toHaveAttribute("href", "/empresa/recuperar");
    await waitFor(() => expect(alert).toHaveFocus());
    expect(screen.getByLabelText("Contraseña")).toHaveValue("");
    expect(screen.getByLabelText("Contraseña").getAttribute("aria-describedby")?.split(" ")).toContain(alert.id);
    expect(screen.getByRole("button", { name: "Ingresar" })).not.toHaveAttribute("aria-disabled");
  });

  it.each([
    ["unavailable", { ok: false, error: "unavailable", status: 401, url: null }],
    ["an unknown code", { ok: false, error: "CredentialsSignin", status: 401, url: null }],
    ["no result", undefined],
  ])("shows «No pudimos conectarnos.» on %s and keeps what was typed", async (_label, result) => {
    const alert = await failWith(result);
    expect(alert).toHaveTextContent("No pudimos conectarnos.");
    expect(alert).toHaveTextContent("Revisa tu conexión e inténtalo de nuevo. Lo que escribiste sigue aquí.");
    expect(screen.getByLabelText("Contraseña")).toHaveValue(PASSWORD);
    expect(screen.getByLabelText("Correo corporativo")).not.toHaveAttribute("aria-invalid");
  });

  it("shows «No pudimos conectarnos.» when the request throws, without leaking its detail", async () => {
    auth.signIn.mockRejectedValue(new Error("secret-network-detail"));
    renderForm();
    fill();
    submit();
    const alert = await waitFor(() => screen.getByRole("alert"));
    expect(alert).toHaveTextContent("No pudimos conectarnos.");
    expect(screen.queryByText(/secret-network-detail/)).not.toBeInTheDocument();
  });

  it("shows «No pudimos conectarnos.» after 10 s and ignores a late answer", async () => {
    vi.useFakeTimers();
    let resolve!: (value: unknown) => void;
    auth.signIn.mockReturnValue(new Promise((done) => { resolve = done; }));
    renderForm();
    fill();
    submit();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos conectarnos.");
    expect(screen.getByRole("button", { name: "Ingresar" })).not.toHaveAttribute("aria-disabled");
    await act(async () => resolve({ ok: true, error: null, status: 200, url: "http://localhost:3000/empresa/dashboard" }));
    expect(auth.assign).not.toHaveBeenCalled();
  });

  it("sends an unconfirmed account to the verify-code screen, carrying the email in session storage, never in the URL", async () => {
    auth.signIn.mockResolvedValue({ ok: false, error: "not_confirmed", status: 401, url: null });
    renderForm({ audience: "candidate", callbackUrl: "/candidato/ingresar" });
    fill(" Ximena@Correo.com ");
    submit();
    await waitFor(() => expect(auth.assign).toHaveBeenCalledExactlyOnceWith("/candidato/verificar"));
    expect(window.sessionStorage.getItem(PENDING_EMAIL_KEY)).toBe("Ximena@Correo.com");
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain(PASSWORD);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clears the previous error when the next attempt starts", async () => {
    auth.signIn.mockResolvedValueOnce({ ok: false, error: "invalid_credentials", status: 401, url: null });
    renderForm();
    fill();
    submit();
    await waitFor(() => screen.getByRole("alert"));
    let resolve!: (value: unknown) => void;
    auth.signIn.mockReturnValue(new Promise((done) => { resolve = done; }));
    fill();
    submit();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => resolve({ ok: true, error: null, status: 200, url: "http://localhost:3000/empresa/dashboard" }));
  });
});

describe("notices from the page", () => {
  it("shows the session-expired banner as a status message", () => {
    renderForm({ notice: "expired" });
    expect(screen.getByRole("status")).toHaveTextContent("Tu sesión venció. Vuelve a ingresar.");
  });

  it("shows the generic callback failure as an alert", () => {
    renderForm({ notice: "callback" });
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos completar el acceso. Inténtalo de nuevo.");
  });

  it("shows the already-registered social notice and focuses the password", async () => {
    renderForm({ notice: "email_in_use" });
    expect(screen.getByRole("status")).toHaveTextContent("Ese correo ya tiene cuenta. Entra con tu contraseña.");
    await waitFor(() => expect(screen.getByLabelText("Contraseña")).toHaveFocus());
  });

  it("replaces the page notice with the result of a new attempt", async () => {
    auth.signIn.mockResolvedValue({ ok: false, error: "invalid_credentials", status: 401, url: null });
    renderForm({ notice: "expired" });
    fill();
    submit();
    await waitFor(() => screen.getByRole("alert"));
    expect(screen.queryByText("Tu sesión venció. Vuelve a ingresar.")).not.toBeInTheDocument();
  });
});

describe("social buttons", () => {
  it("renders nothing social, not even the divider, when every flag is off", () => {
    renderForm();
    expect(screen.queryByText("o continúa con")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Continuar con/ })).not.toBeInTheDocument();
  });

  it("renders only the enabled providers for the employer, in order", () => {
    renderForm({ socialProviders: [GOOGLE, MICROSOFT, LINKEDIN] });
    expect(screen.getByText("o continúa con")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Continuar con/ }).map((b) => b.textContent)).toEqual([
      "Continuar con Google", "Continuar con Microsoft", "Continuar con LinkedIn",
    ]);
    cleanup();
    renderForm({ socialProviders: [MICROSOFT] });
    expect(screen.getAllByRole("button", { name: /Continuar con/ })).toHaveLength(1);
  });

  it("never offers Microsoft to candidates (artboard: Google and LinkedIn)", () => {
    renderForm({ audience: "candidate", callbackUrl: "/candidato/ingresar", socialProviders: [GOOGLE, MICROSOFT, LINKEDIN] });
    expect(screen.getAllByRole("button", { name: /Continuar con/ }).map((b) => b.textContent)).toEqual([
      "Continuar con Google", "Continuar con LinkedIn",
    ]);
    cleanup();
    renderForm({ audience: "candidate", callbackUrl: "/candidato/ingresar", socialProviders: [MICROSOFT] });
    expect(screen.queryByText("o continúa con")).not.toBeInTheDocument();
  });

  it("starts the Cognito OAuth sign-in straight at the provider with its identity_provider", async () => {
    auth.signIn.mockReturnValue(new Promise(() => {}));
    renderForm({ callbackUrl: "/empresa/equipo", socialProviders: [GOOGLE, { id: "microsoft", identityProvider: "AzureAD-PeopleFlow" }] });
    fireEvent.click(screen.getByRole("button", { name: "Continuar con Microsoft" }));
    expect(auth.signIn).toHaveBeenCalledExactlyOnceWith("cognito", { callbackUrl: "/empresa/equipo" }, { identity_provider: "AzureAD-PeopleFlow" });
    // Locked while the browser leaves: no second provider and no password submit.
    fireEvent.click(screen.getByRole("button", { name: "Continuar con Google" }));
    submit();
    expect(auth.signIn).toHaveBeenCalledTimes(1);
  });

  it("reports a social start failure generically and unlocks", async () => {
    auth.signIn.mockRejectedValue(new Error("secret-provider"));
    renderForm({ socialProviders: [GOOGLE] });
    fireEvent.click(screen.getByRole("button", { name: "Continuar con Google" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("No pudimos iniciar el acceso. Inténtalo de nuevo."));
    expect(screen.queryByText(/secret-provider/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar con Google" })).toBeEnabled();
  });
});

describe("disabled while the session is loading", () => {
  it("does not submit while disabled", () => {
    renderForm({ disabled: true });
    fill();
    submit();
    expect(auth.signIn).not.toHaveBeenCalled();
  });
});
