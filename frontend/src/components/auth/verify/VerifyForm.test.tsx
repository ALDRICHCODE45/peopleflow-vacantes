import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({ confirm: vi.fn(), resend: vi.fn(), assign: vi.fn() }));
vi.mock("@/lib/auth/sign-up/actions", () => ({ confirmSignUpAction: deps.confirm, resendCodeAction: deps.resend }));
vi.mock("../sign-in/navigate", () => ({ navigateTo: deps.assign }));

import { VerifyForm } from "./VerifyForm";
import { PENDING_EMAIL_KEY, PENDING_ORIGIN_KEY, VERIFIED_EMAIL_KEY, rememberPendingEmail } from "../sign-in/pending-email";

const EMAIL = "ximena.ruiz@gmail.com";
const cell = (n: number) => screen.getByRole("textbox", { name: `Dígito ${n} de 6` });
const paste = (target: HTMLElement, text: string) =>
  fireEvent.paste(target, { clipboardData: { getData: () => text } });
const verify = () => fireEvent.click(screen.getByRole("button", { name: "Verificar" }));
const resendButton = () => screen.getByRole("button", { name: /Reenviar código/ });

async function arrive(origin: "sign-up" | "sign-in" | null, { strict = false } = {}) {
  if (origin !== undefined && origin !== null) rememberPendingEmail(EMAIL, origin);
  const ui = <VerifyForm audience="candidate" />;
  render(strict ? <React.StrictMode>{ui}</React.StrictMode> : ui);
  await act(async () => {});
}

beforeEach(() => {
  deps.confirm.mockReset().mockResolvedValue({ ok: true });
  deps.resend.mockReset().mockResolvedValue({ ok: true });
  deps.assign.mockReset();
  window.sessionStorage.clear();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("arrival", () => {
  it("from sign-up: names the email, does not resend (the sign-up just sent a code) and starts the 60 s wait", async () => {
    vi.useFakeTimers();
    await arrive("sign-up");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Verifica tu correo");
    expect(screen.getByText("Crear perfil")).toBeInTheDocument();
    expect(screen.getByText(/Escribe el código de 6 dígitos que enviamos a/)).toHaveTextContent(EMAIL);
    expect(deps.resend).not.toHaveBeenCalled();
    expect(resendButton()).toHaveAccessibleName("Reenviar código en 1:00");
    expect(resendButton()).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("link", { name: "Volver a ingresar" })).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(18_000); });
    expect(resendButton()).toHaveAccessibleName("Reenviar código en 0:42");
    await act(async () => { await vi.advanceTimersByTimeAsync(42_000); });
    expect(resendButton()).toHaveAccessibleName("Reenviar código");
    expect(resendButton()).not.toHaveAttribute("aria-disabled");
  });

  it("from the sign-in not_confirmed handoff: resends once on arrival (even under StrictMode) and says so", async () => {
    await arrive("sign-in", { strict: true });
    await waitFor(() => expect(deps.resend).toHaveBeenCalledTimes(1));
    expect(deps.resend).toHaveBeenCalledWith({ email: EMAIL });
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Tu cuenta aún no está verificada.");
    expect(status).toHaveTextContent("Te enviamos un código nuevo para terminar.");
    expect(screen.getByText("Verificar cuenta")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver a ingresar" })).toHaveAttribute("href", "/candidato/login");
    expect(resendButton()).toHaveAttribute("aria-disabled", "true");
  });

  it("keeps the email for a reload but never resends again on it", async () => {
    await arrive("sign-in");
    await waitFor(() => expect(deps.resend).toHaveBeenCalledTimes(1));
    expect(window.sessionStorage.getItem(PENDING_EMAIL_KEY)).toBe(EMAIL);
    expect(window.sessionStorage.getItem(PENDING_ORIGIN_KEY)).toBeNull();
    cleanup();
    render(<VerifyForm audience="candidate" />);
    await act(async () => {});
    expect(screen.getByText(/enviamos a/)).toHaveTextContent(EMAIL);
    expect(deps.resend).toHaveBeenCalledTimes(1);
    expect(resendButton()).toHaveAccessibleName("Reenviar código");
  });

  it("shows the resend failure when the arrival resend is refused", async () => {
    deps.resend.mockResolvedValue({ ok: false, reason: "too_many_attempts" });
    await arrive("sign-in");
    expect(await screen.findByRole("alert")).toHaveTextContent("Demasiados intentos.");
    expect(resendButton()).not.toHaveAttribute("aria-disabled");
  });

  it("without a carried email: asks for it first, then shows the code with the resend ready, sending nothing by itself", async () => {
    await arrive(null);
    expect(screen.queryByRole("group", { name: "Código de verificación" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByText("Escribe un correo válido, como nombre@correo.com.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Correo"), { target: { value: ` ${EMAIL} ` } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByRole("group", { name: "Código de verificación" })).toBeInTheDocument();
    expect(screen.getByText(/enviamos a/)).toHaveTextContent(EMAIL);
    expect(resendButton()).toHaveAccessibleName("Reenviar código");
    expect(deps.resend).not.toHaveBeenCalled();
  });
});

describe("verify", () => {
  it("confirms the pasted code and goes to «Ingresar» with the verified email carried in session storage", async () => {
    await arrive("sign-up");
    paste(cell(1), "482913");
    expect(screen.getByRole("button", { name: "Verificar" })).toHaveFocus();
    expect(deps.confirm).not.toHaveBeenCalled();
    verify();
    await waitFor(() => expect(deps.assign).toHaveBeenCalledExactlyOnceWith("/candidato/login"));
    expect(deps.confirm).toHaveBeenCalledExactlyOnceWith({ email: EMAIL, code: "482913" });
    expect(window.sessionStorage.getItem(VERIFIED_EMAIL_KEY)).toBe(EMAIL);
    expect(window.sessionStorage.getItem(PENDING_EMAIL_KEY)).toBeNull();
  });

  it("asks for the six digits before calling the server", async () => {
    await arrive("sign-up");
    paste(cell(1), "482");
    verify();
    expect(await screen.findByText("Escribe los 6 dígitos del código.")).toBeInTheDocument();
    expect(deps.confirm).not.toHaveBeenCalled();
    await waitFor(() => expect(cell(4)).toHaveFocus());
  });

  it("shows «Verificando…» and ignores a second submit while pending", async () => {
    deps.confirm.mockReturnValue(new Promise(() => {}));
    await arrive("sign-up");
    paste(cell(1), "482913");
    verify();
    expect(await screen.findByText("Verificando…")).toBeInTheDocument();
    fireEvent.submit(cell(1).closest("form")!);
    expect(deps.confirm).toHaveBeenCalledTimes(1);
  });

  it("code mismatch: alert tied to the group, boxes invalid, focus back on the first box", async () => {
    deps.confirm.mockResolvedValue({ ok: false, reason: "code_mismatch" });
    await arrive("sign-up");
    paste(cell(1), "482931");
    verify();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("El código no es correcto.");
    expect(alert).toHaveTextContent("Revísalo e inténtalo de nuevo.");
    expect(screen.getByRole("group", { name: "Código de verificación" }).getAttribute("aria-describedby")?.split(" ")).toContain(alert.id);
    expect(cell(3)).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(cell(1)).toHaveFocus());
    expect(deps.assign).not.toHaveBeenCalled();
  });

  it("expired code: offers «Enviar código nuevo», which resends, clears the boxes and focuses the first one", async () => {
    deps.confirm.mockResolvedValue({ ok: false, reason: "code_expired" });
    await arrive("sign-up");
    paste(cell(1), "482913");
    verify();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Este código ya venció.");
    fireEvent.click(within(alert).getByRole("button", { name: "Enviar código nuevo" }));
    await waitFor(() => expect(deps.resend).toHaveBeenCalledExactlyOnceWith({ email: EMAIL }));
    expect(await screen.findByRole("status")).toHaveTextContent("Te enviamos un código nuevo.");
    expect(cell(1)).toHaveValue("");
    expect(cell(6)).toHaveValue("");
    await waitFor(() => expect(cell(1)).toHaveFocus());
  });

  it.each([
    ["too_many_attempts", "Demasiados intentos."],
    ["unavailable", "No pudimos conectarnos."],
  ])("%s → «%s», keeping the digits", async (reason, title) => {
    deps.confirm.mockResolvedValue({ ok: false, reason });
    await arrive("sign-up");
    paste(cell(1), "482913");
    verify();
    expect(await screen.findByRole("alert")).toHaveTextContent(title);
    expect(cell(6)).toHaveValue("3");
  });

  it("a thrown action is the network copy, without its detail", async () => {
    deps.confirm.mockRejectedValue(new Error("secret-detail"));
    await arrive("sign-up");
    paste(cell(1), "482913");
    verify();
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos conectarnos.");
    expect(screen.queryByText(/secret-detail/)).not.toBeInTheDocument();
  });
});

describe("«Reenviar código»", () => {
  it("does nothing during the wait, then resends, confirms and restarts the 60 s wait", async () => {
    vi.useFakeTimers();
    await arrive("sign-up");
    fireEvent.click(resendButton());
    expect(deps.resend).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    fireEvent.click(resendButton());
    await act(async () => {});
    expect(deps.resend).toHaveBeenCalledExactlyOnceWith({ email: EMAIL });
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Te enviamos un código nuevo.");
    expect(status).toHaveTextContent("El anterior ya no sirve.");
    expect(resendButton()).toHaveAccessibleName("Reenviar código en 1:00");
  });

  it("keeps the resend available after a failed resend", async () => {
    vi.useFakeTimers();
    deps.resend.mockResolvedValue({ ok: false, reason: "unavailable" });
    await arrive(null);
    fireEvent.change(screen.getByLabelText("Correo"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await act(async () => {});
    fireEvent.click(resendButton());
    await act(async () => {});
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos conectarnos.");
    expect(resendButton()).toHaveAccessibleName("Reenviar código");
  });
});

describe("«Cambiar correo»", () => {
  it("starts the sign-up again (an unconfirmed account cannot change its email) and drops the carried email", async () => {
    await arrive("sign-up");
    const link = screen.getByRole("link", { name: "Cambiar correo" });
    expect(link).toHaveAttribute("href", "/candidato/registro");
    fireEvent.click(link);
    expect(window.sessionStorage.getItem(PENDING_EMAIL_KEY)).toBeNull();
  });
});
