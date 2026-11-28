import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({ signUp: vi.fn(), assign: vi.fn() }));
vi.mock("@/lib/auth/sign-up/actions", () => ({ signUpAction: deps.signUp }));
vi.mock("../sign-in/navigate", () => ({ navigateTo: deps.assign }));

import { SignUpForm } from "./SignUpForm";
import { PENDING_EMAIL_KEY, PENDING_ORIGIN_KEY, VERIFIED_EMAIL_KEY } from "../sign-in/pending-email";

const PASSWORD = "Altavista#2026";

function fill({ name = "Ximena Ruiz", email = "ximena.ruiz@gmail.com", password = PASSWORD, terms = true } = {}) {
  fireEvent.change(screen.getByLabelText("Nombre completo"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("Correo"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: password } });
  const checkbox = screen.getByRole("checkbox", { name: /Acepto los Términos y el Aviso de privacidad/ });
  if ((checkbox as HTMLInputElement).checked !== terms) fireEvent.click(checkbox);
}
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Crear perfil" }));

beforeEach(() => {
  deps.signUp.mockReset().mockResolvedValue({ ok: true, confirmed: false });
  deps.assign.mockReset();
  window.sessionStorage.clear();
});
afterEach(cleanup);

describe("«Crea tu perfil» fields (artboard 01 · Crear cuenta, candidato)", () => {
  it("renders name, email and a new password with password-manager hints", () => {
    const { container } = render(<SignUpForm audience="candidate" />);
    expect(screen.getByLabelText("Nombre completo")).toHaveAttribute("autocomplete", "name");
    const email = screen.getByLabelText("Correo");
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "email");
    expect(email).toHaveAttribute("placeholder", "tu@correo.com");
    const password = screen.getByLabelText("Contraseña");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "new-password");
    const form = container.querySelector("form")!;
    expect(form).toHaveAttribute("novalidate");
    expect(form).not.toHaveAttribute("action");
  });

  it("shows and hides the password with a pressed toggle", () => {
    render(<SignUpForm audience="candidate" />);
    const toggle = screen.getByRole("button", { name: "Mostrar contraseña" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Ocultar contraseña" })).toHaveAttribute("aria-pressed", "true");
  });

  it("lists the requirements live, with their state in text, and announces only when all are met", () => {
    render(<SignUpForm audience="candidate" />);
    const list = screen.getByRole("list", { name: "Tu contraseña necesita:" });
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Pendiente: 8 caracteres o más",
      "Pendiente: Una mayúscula",
      "Pendiente: Una minúscula",
      "Pendiente: Un número",
      "Pendiente: Un símbolo (#, $, !…)",
    ]);
    expect(screen.getByLabelText("Contraseña").getAttribute("aria-describedby")?.split(" ")).toContain(list.id);
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "altavista2026" } });
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Cumplido: 8 caracteres o más",
      "Pendiente: Una mayúscula",
      "Cumplido: Una minúscula",
      "Cumplido: Un número",
      "Pendiente: Un símbolo (#, $, !…)",
    ]);
    const live = document.querySelector("[aria-live='polite']")!;
    expect(live).toHaveTextContent("");
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: PASSWORD } });
    expect(live).toHaveTextContent("Tu contraseña cumple todos los requisitos.");
  });

  it("asks for the terms and privacy notice consent", () => {
    render(<SignUpForm audience="candidate" />);
    expect(screen.getByRole("checkbox", { name: "Acepto los Términos y el Aviso de privacidad." })).not.toBeChecked();
  });

  it("links the provisional legal pages on their own line («Léelos aquí»), cited by the checkbox, with 44 px targets", () => {
    render(<SignUpForm audience="candidate" />);
    const checkbox = screen.getByRole("checkbox", { name: "Acepto los Términos y el Aviso de privacidad." });
    const terms = screen.getByRole("link", { name: "Términos" });
    const privacy = screen.getByRole("link", { name: "Aviso de privacidad" });
    expect(terms).toHaveAttribute("href", "/terminos");
    expect(privacy).toHaveAttribute("href", "/aviso-de-privacidad");
    for (const link of [terms, privacy]) {
      expect(link.className).toContain("min-h-11");
      // Outside the consent label: a tap on a link never toggles the checkbox.
      expect(link.closest("label")).toBeNull();
    }
    const line = terms.closest("p")!;
    expect(line).toHaveTextContent("Léelos aquí: Términos · Aviso de privacidad");
    expect(line).toContainElement(privacy);
    expect(checkbox.getAttribute("aria-describedby")?.split(" ")).toContain(line.id);
    fireEvent.click(terms);
    expect(checkbox).not.toBeChecked();
  });
});

describe("local validation", () => {
  it("marks every invalid field under itself, focuses the first one and never calls the server", async () => {
    render(<SignUpForm audience="candidate" />);
    fill({ name: " ", email: "ximena.ruiz@", password: "altavista", terms: false });
    submit();
    const name = screen.getByLabelText("Nombre completo");
    await waitFor(() => expect(name).toHaveFocus());
    const message = (field: HTMLElement) => field.getAttribute("aria-describedby")!.split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(message(name)).toContain("Escribe tu nombre.");
    expect(message(screen.getByLabelText("Correo"))).toContain("Escribe un correo válido, como nombre@correo.com.");
    expect(message(screen.getByLabelText("Contraseña"))).toContain("Tu contraseña aún no cumple todos los requisitos.");
    const checkbox = screen.getByRole("checkbox", { name: /Acepto/ });
    expect(checkbox).toHaveAttribute("aria-invalid", "true");
    expect(message(checkbox)).toContain("Acepta los Términos y el Aviso de privacidad para continuar.");
    // Pending requirements turn into explicit misses.
    const requirement = within(screen.getByRole("list", { name: "Tu contraseña necesita:" })).getAllByRole("listitem").find((item) => item.textContent === "Pendiente: Una mayúscula");
    expect(requirement).toHaveAttribute("data-state", "missing");
    expect(deps.signUp).not.toHaveBeenCalled();
  });

  it("asks for 2 to 120 characters when the name is too short", async () => {
    render(<SignUpForm audience="candidate" />);
    fill({ name: "X" });
    submit();
    expect(await screen.findByText("Escribe un nombre de 2 a 120 caracteres.")).toBeInTheDocument();
    expect(deps.signUp).not.toHaveBeenCalled();
  });
});

describe("submit → «Verifica tu correo»", () => {
  it("creates the account with name, email and password, then hands only the email over in session storage", async () => {
    render(<SignUpForm audience="candidate" />);
    fill({ email: " Ximena.Ruiz@Gmail.com " });
    submit();
    await waitFor(() => expect(deps.assign).toHaveBeenCalledExactlyOnceWith("/candidato/verificar"));
    expect(deps.signUp).toHaveBeenCalledExactlyOnceWith({ name: "Ximena Ruiz", email: "Ximena.Ruiz@Gmail.com", password: PASSWORD, terms: true });
    expect(window.sessionStorage.getItem(PENDING_EMAIL_KEY)).toBe("Ximena.Ruiz@Gmail.com");
    expect(window.sessionStorage.getItem(PENDING_ORIGIN_KEY)).toBe("sign-up");
    // Never in the URL, never the password in storage.
    expect(deps.assign.mock.calls[0]![0]).not.toMatch(/[?#]/);
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain(PASSWORD);
  });

  it("clears the password before leaving", async () => {
    let atNavigation: string | undefined;
    deps.assign.mockImplementation(() => { atNavigation = (screen.getByLabelText("Contraseña") as HTMLInputElement).value; });
    render(<SignUpForm audience="candidate" />);
    fill();
    submit();
    await waitFor(() => expect(deps.assign).toHaveBeenCalled());
    expect(atNavigation).toBe("");
  });

  it("goes straight to «Ingresar» with the verified notice when the pool confirmed the account itself", async () => {
    deps.signUp.mockResolvedValue({ ok: true, confirmed: true });
    render(<SignUpForm audience="candidate" />);
    fill();
    submit();
    await waitFor(() => expect(deps.assign).toHaveBeenCalledExactlyOnceWith("/candidato/login"));
    expect(window.sessionStorage.getItem(VERIFIED_EMAIL_KEY)).toBe("ximena.ruiz@gmail.com");
  });

  it("shows «Creando perfil…» and ignores a second submit while pending", async () => {
    deps.signUp.mockReturnValue(new Promise(() => {}));
    const { container } = render(<SignUpForm audience="candidate" />);
    fill();
    submit();
    expect(await screen.findByText("Creando perfil…")).toBeInTheDocument();
    fireEvent.submit(container.querySelector("form")!);
    expect(deps.signUp).toHaveBeenCalledTimes(1);
  });
});

describe("server outcomes", () => {
  it("email taken: says the email cannot create a profile and offers sign-in and password reset", async () => {
    deps.signUp.mockResolvedValue({ ok: false, reason: "email_taken" });
    render(<SignUpForm audience="candidate" />);
    fill();
    submit();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Ese correo no se puede usar para crear un perfil.");
    expect(within(alert).getByRole("link", { name: "Ingresa" })).toHaveAttribute("href", "/candidato/login");
    expect(within(alert).getByRole("link", { name: "Restablecer contraseña" })).toHaveAttribute("href", "/candidato/recuperar");
    expect(screen.getByLabelText("Correo")).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(alert).toHaveFocus());
    expect(deps.assign).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(PENDING_EMAIL_KEY)).toBeNull();
  });

  it("invalid password from the pool: marks the password with the requirements message", async () => {
    deps.signUp.mockResolvedValue({ ok: false, reason: "invalid_password" });
    render(<SignUpForm audience="candidate" />);
    fill();
    submit();
    expect(await screen.findByText("Tu contraseña aún no cumple todos los requisitos.")).toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("aria-invalid", "true");
  });

  it("too many attempts", async () => {
    deps.signUp.mockResolvedValue({ ok: false, reason: "too_many_attempts" });
    render(<SignUpForm audience="candidate" />);
    fill();
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Demasiados intentos.");
  });

  it.each([
    ["unavailable", () => deps.signUp.mockResolvedValue({ ok: false, reason: "unavailable" })],
    ["a thrown action", () => deps.signUp.mockRejectedValue(new Error("secret-detail"))],
  ])("network copy for %s, keeping what was typed", async (_label, arrange) => {
    arrange();
    render(<SignUpForm audience="candidate" />);
    fill();
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos conectarnos.");
    expect(screen.queryByText(/secret-detail/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Nombre completo")).toHaveValue("Ximena Ruiz");
    expect(screen.getByRole("button", { name: "Crear perfil" })).not.toHaveAttribute("aria-disabled");
  });

  it("marks the fields the server refused when the client check let them through", async () => {
    deps.signUp.mockResolvedValue({ ok: false, reason: "invalid_input", fields: ["email"] });
    render(<SignUpForm audience="candidate" />);
    fill();
    submit();
    expect(await screen.findByText("Escribe un correo válido, como nombre@correo.com.")).toBeInTheDocument();
    expect(screen.getByLabelText("Correo")).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(screen.getByLabelText("Correo")).toHaveFocus());
  });
});
