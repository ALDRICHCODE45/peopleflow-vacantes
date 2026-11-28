import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({ forgot: vi.fn(), confirm: vi.fn(), assign: vi.fn() }));
vi.mock("@/lib/auth/forgot-password/actions", () => ({ forgotPasswordAction: deps.forgot, confirmForgotPasswordAction: deps.confirm }));
vi.mock("../sign-in/navigate", () => ({ navigateTo: deps.assign }));

import { ForgotPasswordForm } from "./ForgotPasswordForm";
import { PASSWORD_RESET_EMAIL_KEY, RECOVERY_EMAIL_KEY } from "../sign-in/pending-email";

const EMAIL = "laura@empresa.mx";
const PASSWORD = "Mariposa!71";
const CODE = "735102";

const cell = (n: number) => screen.getByRole("textbox", { name: `Dígito ${n} de 6` });
const paste = (target: HTMLElement, text: string) => fireEvent.paste(target, { clipboardData: { getData: () => text } });
const emailField = () => screen.getByLabelText("Correo");
const passwordField = () => screen.getByLabelText("Nueva contraseña");
const sendCode = () => fireEvent.click(screen.getByRole("button", { name: "Enviar código" }));
const change = () => fireEvent.click(screen.getByRole("button", { name: "Cambiar contraseña" }));
const resendButton = () => screen.getByRole("button", { name: /Reenviar código/ });

async function mount(audience: "employer" | "candidate" = "employer", { strict = false } = {}) {
  const ui = <ForgotPasswordForm audience={audience} />;
  render(strict ? <React.StrictMode>{ui}</React.StrictMode> : ui);
  await act(async () => {});
}

async function requestCode(email = EMAIL) {
  fireEvent.change(emailField(), { target: { value: email } });
  sendCode();
  await screen.findByRole("heading", { level: 1, name: "Crea una contraseña nueva" });
}

function fillReset(code = CODE, password = PASSWORD) {
  paste(cell(1), code);
  fireEvent.change(passwordField(), { target: { value: password } });
}

beforeEach(() => {
  deps.forgot.mockReset().mockResolvedValue({ ok: true });
  deps.confirm.mockReset().mockResolvedValue({ ok: true });
  deps.assign.mockReset();
  window.sessionStorage.clear();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("step 1 · request a code", () => {
  it("asks only for the email (artboard «Restablece tu contraseña») with a way back to the audience's «Ingresar»", async () => {
    await mount("employer");
    expect(screen.getByText("Recuperar acceso")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Restablece tu contraseña");
    expect(screen.getByText("Escribe el correo de tu cuenta y te enviaremos un código.")).toBeInTheDocument();
    expect(emailField()).toHaveAttribute("type", "email");
    expect(emailField()).toHaveAttribute("autocomplete", "username");
    expect(emailField()).toHaveAttribute("placeholder", "tu@empresa.com");
    expect(screen.queryByLabelText("Nueva contraseña")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver a ingresar" })).toHaveAttribute("href", "/empresa/login");
  });

  it("uses the candidate copy and paths for the candidate audience", async () => {
    await mount("candidate");
    expect(emailField()).toHaveAttribute("placeholder", "tu@correo.com");
    expect(screen.getByRole("link", { name: "Volver a ingresar" })).toHaveAttribute("href", "/candidato/login");
  });

  it("refuses an invalid email without calling the server and focuses the field", async () => {
    await mount();
    fireEvent.change(emailField(), { target: { value: "laura@" } });
    sendCode();
    expect(await screen.findByText("Escribe un correo válido, como nombre@correo.com.")).toBeInTheDocument();
    expect(emailField()).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(emailField()).toHaveFocus());
    expect(deps.forgot).not.toHaveBeenCalled();
  });

  it("sends the trimmed email and moves to step 2 saying only «Si hay una cuenta con ese correo…» (existence hiding)", async () => {
    vi.useFakeTimers();
    await mount();
    fireEvent.change(emailField(), { target: { value: `  ${EMAIL} ` } });
    sendCode();
    await act(async () => {});
    expect(deps.forgot).toHaveBeenCalledExactlyOnceWith({ email: EMAIL });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Crea una contraseña nueva");
    expect(screen.getByText(/^Para/)).toHaveTextContent(`Para ${EMAIL}.`);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Si hay una cuenta con ese correo, te enviamos un código.");
    expect(status).toHaveTextContent("Vence en 1 hora.");
    expect(resendButton()).toHaveAccessibleName("Reenviar código en 1:00");
    expect(resendButton()).toHaveAttribute("aria-disabled", "true");
    // The email travels in component state and tab-scoped storage, never the URL.
    expect(window.sessionStorage.getItem(RECOVERY_EMAIL_KEY)).toBe(EMAIL);
    expect(window.location.search).toBe("");
    expect(deps.assign).not.toHaveBeenCalled();
  });

  it("stays on step 1 with the email kept when the request is refused or fails", async () => {
    deps.forgot.mockResolvedValueOnce({ ok: false, reason: "too_many_attempts" });
    await mount();
    fireEvent.change(emailField(), { target: { value: EMAIL } });
    sendCode();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Demasiados intentos.");
    await waitFor(() => expect(alert).toHaveFocus());
    expect(emailField()).toHaveValue(EMAIL);

    deps.forgot.mockRejectedValueOnce(new Error("offline"));
    sendCode();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("No pudimos conectarnos."));
    expect(emailField()).toHaveValue(EMAIL);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Restablece tu contraseña");
    expect(window.sessionStorage.getItem(RECOVERY_EMAIL_KEY)).toBeNull();
  });

  it("sends once per click while the request is pending", async () => {
    let resolve!: (value: unknown) => void;
    deps.forgot.mockReturnValue(new Promise((settle) => { resolve = settle; }));
    await mount();
    fireEvent.change(emailField(), { target: { value: EMAIL } });
    sendCode();
    expect(await screen.findByRole("button", { name: /Enviando código/ })).toHaveAttribute("aria-disabled", "true");
    fireEvent.submit(emailField().closest("form")!);
    expect(deps.forgot).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ ok: true }));
  });
});

describe("step 2 · code and new password", () => {
  it("shows six code boxes, the new password with show / hide and live requirements", async () => {
    await mount();
    await requestCode();
    expect(screen.getByRole("group", { name: "Código de verificación" })).toBeInTheDocument();
    expect(screen.getByText("Revisa también tu carpeta de spam.")).toBeInTheDocument();
    expect(passwordField()).toHaveAttribute("type", "password");
    expect(passwordField()).toHaveAttribute("autocomplete", "new-password");
    const toggle = screen.getByRole("button", { name: "Mostrar contraseña" });
    fireEvent.click(toggle);
    expect(passwordField()).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Ocultar contraseña" })).toHaveAttribute("aria-pressed", "true");
    const requirements = screen.getByRole("list", { name: "Tu contraseña necesita:" });
    expect(within(requirements).getAllByRole("listitem").every((item) => item.dataset.state === "pending")).toBe(true);
    fireEvent.change(passwordField(), { target: { value: "Ab" } });
    expect(within(requirements).getByText("Una mayúscula").closest("li")).toHaveAttribute("data-state", "met");
    expect(within(requirements).getByText("8 caracteres o más").closest("li")).toHaveAttribute("data-state", "pending");
    expect(screen.getByRole("link", { name: "Volver a ingresar" })).toHaveAttribute("href", "/empresa/login");
  });

  it("changes the password and goes to «Ingresar» with the email carried in session storage (no password or code kept)", async () => {
    await mount();
    await requestCode();
    fillReset();
    change();
    await waitFor(() => expect(deps.assign).toHaveBeenCalledExactlyOnceWith("/empresa/login"));
    expect(deps.confirm).toHaveBeenCalledExactlyOnceWith({ email: EMAIL, code: CODE, newPassword: PASSWORD });
    expect(window.sessionStorage.getItem(PASSWORD_RESET_EMAIL_KEY)).toBe(EMAIL);
    expect(window.sessionStorage.getItem(RECOVERY_EMAIL_KEY)).toBeNull();
    expect(passwordField()).toHaveValue("");
    const stored = Object.keys(window.sessionStorage).map((key) => window.sessionStorage.getItem(key)).join(" ");
    expect(stored).not.toContain(PASSWORD);
    expect(stored).not.toContain(CODE);
  });

  it("goes to the candidate «Ingresar» for the candidate audience", async () => {
    await mount("candidate");
    await requestCode("ximena@correo.com");
    fillReset();
    change();
    await waitFor(() => expect(deps.assign).toHaveBeenCalledExactlyOnceWith("/candidato/login"));
  });

  it("asks for the six digits and a policy-compliant password before calling the server", async () => {
    await mount();
    await requestCode();
    paste(cell(1), "735");
    fireEvent.change(passwordField(), { target: { value: "mariposa" } });
    change();
    expect(await screen.findByText("Escribe los 6 dígitos del código.")).toBeInTheDocument();
    expect(screen.getByText("Tu contraseña aún no cumple todos los requisitos.")).toBeInTheDocument();
    expect(screen.getByText("Una mayúscula").closest("li")).toHaveAttribute("data-state", "missing");
    expect(passwordField()).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(cell(4)).toHaveFocus());
    expect(deps.confirm).not.toHaveBeenCalled();
  });

  it.each(["code_mismatch", "code_expired"])("%s: one message for a wrong or expired code, the new password kept", async (reason) => {
    deps.confirm.mockResolvedValue({ ok: false, reason });
    await mount();
    await requestCode();
    fillReset();
    change();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("El código no es correcto o ya venció.");
    expect(alert).toHaveTextContent("Pide uno nuevo con «Reenviar código».");
    await waitFor(() => expect(alert).toHaveFocus());
    expect(cell(1)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("group", { name: "Código de verificación" })).toHaveAttribute("aria-describedby", expect.stringContaining(alert.id));
    expect(passwordField()).toHaveValue(PASSWORD);
    expect(deps.assign).not.toHaveBeenCalled();
  });

  it("invalid_password: marks the password with its requirements and focuses it", async () => {
    deps.confirm.mockResolvedValue({ ok: false, reason: "invalid_password" });
    await mount();
    await requestCode();
    fillReset();
    change();
    expect(await screen.findByText("Tu contraseña aún no cumple todos los requisitos.")).toBeInTheDocument();
    await waitFor(() => expect(passwordField()).toHaveFocus());
    expect(passwordField()).toHaveAttribute("aria-invalid", "true");
  });

  it.each<[unknown, string]>([
    [{ ok: false, reason: "too_many_attempts" }, "Demasiados intentos."],
    [{ ok: false, reason: "unavailable" }, "No pudimos conectarnos."],
    [{ ok: false, reason: "invalid_input", fields: ["email"] }, "No pudimos conectarnos."],
  ])("%j → «%s» with the data kept", async (result, title) => {
    deps.confirm.mockResolvedValue(result);
    await mount();
    await requestCode();
    fillReset();
    change();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(title);
    expect(passwordField()).toHaveValue(PASSWORD);
    expect(cell(1)).toHaveValue("7");
  });

  it("maps a thrown action to the network message", async () => {
    deps.confirm.mockRejectedValue(new Error("offline"));
    await mount();
    await requestCode();
    fillReset();
    change();
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos conectarnos.");
  });

  it("resends after the 60 s wait through forgotPassword: new code, boxes cleared, password kept, wait restarted", async () => {
    vi.useFakeTimers();
    await mount();
    fireEvent.change(emailField(), { target: { value: EMAIL } });
    sendCode();
    await act(async () => {});
    fillReset();
    fireEvent.click(resendButton());
    expect(deps.forgot).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(resendButton()).toHaveAccessibleName("Reenviar código");
    fireEvent.click(resendButton());
    await act(async () => {});
    expect(deps.forgot).toHaveBeenCalledTimes(2);
    expect(deps.forgot).toHaveBeenLastCalledWith({ email: EMAIL });
    expect(screen.getByRole("status")).toHaveTextContent("Si hay una cuenta con ese correo, te enviamos un código nuevo.");
    expect(cell(1)).toHaveValue("");
    expect(passwordField()).toHaveValue(PASSWORD);
    expect(resendButton()).toHaveAccessibleName("Reenviar código en 1:00");
  });

  it("shows a refused resend as an alert", async () => {
    vi.useFakeTimers();
    await mount();
    fireEvent.change(emailField(), { target: { value: EMAIL } });
    sendCode();
    await act(async () => {});
    deps.forgot.mockResolvedValue({ ok: false, reason: "too_many_attempts" });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    fireEvent.click(resendButton());
    await act(async () => {});
    expect(screen.getByRole("alert")).toHaveTextContent("Demasiados intentos.");
  });

  it("«Usar otro correo» goes back to step 1 with the email in the field and forgets the carried one", async () => {
    await mount();
    await requestCode();
    fireEvent.click(screen.getByRole("button", { name: "Usar otro correo" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Restablece tu contraseña" })).toBeInTheDocument();
    expect(emailField()).toHaveValue(EMAIL);
    await waitFor(() => expect(emailField()).toHaveFocus());
    expect(window.sessionStorage.getItem(RECOVERY_EMAIL_KEY)).toBeNull();
  });

  it("after a reload of step 2 keeps the email from session storage and sends nothing by itself (even under StrictMode)", async () => {
    window.sessionStorage.setItem(RECOVERY_EMAIL_KEY, EMAIL);
    await mount("employer", { strict: true });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Crea una contraseña nueva");
    expect(screen.getByText(/^Para/)).toHaveTextContent(EMAIL);
    expect(deps.forgot).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(resendButton()).toHaveAccessibleName("Reenviar código");
  });
});
