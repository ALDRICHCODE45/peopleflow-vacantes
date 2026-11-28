import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Session = { status: string; data: { user?: { email?: string | null; name?: string | null }; error?: string } | null };
const deps = vi.hoisted(() => ({
  load: vi.fn(), complete: vi.fn(), assign: vi.fn(), signOut: vi.fn(),
  session: { status: "authenticated", data: { user: { email: "andrea@altavista.mx", name: "Andrea Salinas" } } } as Session,
}));
vi.mock("next-auth/react", () => ({ SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>, useSession: () => deps.session }));
vi.mock("@/features/employer-company/company-step-actions", () => ({ loadCompanyStepAction: deps.load, completeCompanyStepAction: deps.complete }));
vi.mock("@/lib/audit/sign-out", () => ({ signOutWithAudit: deps.signOut }));
vi.mock("../sign-in/navigate", () => ({ navigateTo: deps.assign }));

import { CompanyStepForm } from "./CompanyStepForm";

const industries = [{ id: "i1", label_es: "Tecnología", label_en: "Technology", sort_order: 1 }, { id: "i2", label_es: "Manufactura", label_en: "Manufacturing", sort_order: 2 }];

async function mount() {
  render(<CompanyStepForm />);
  await act(async () => {});
}
function fill({ name = "Grupo Altavista", rfc = "GAL010101AB1", industry = "i1", website = "grupoaltavista.mx" } = {}) {
  fireEvent.change(screen.getByLabelText("Nombre comercial"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("RFC"), { target: { value: rfc } });
  fireEvent.change(screen.getByLabelText("Industria"), { target: { value: industry } });
  fireEvent.change(screen.getByLabelText(/Sitio web/), { target: { value: website } });
}
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Crear empresa" }));

beforeEach(() => {
  deps.load.mockReset().mockResolvedValue({ kind: "ready", industries });
  deps.complete.mockReset().mockResolvedValue({ kind: "created" });
  deps.assign.mockReset();
  deps.signOut.mockReset().mockResolvedValue(undefined);
  deps.session = { status: "authenticated", data: { user: { email: "andrea@altavista.mx", name: "Andrea Salinas" } } };
});
afterEach(cleanup);

describe("«Tu empresa» (artboard 01 · company, Paso 3 de 3)", () => {
  it("renders the step heading, the company fields, the verification line and who is signed in", async () => {
    await mount();
    expect(screen.getByText("Registro de empresa · Paso 3 de 3")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Tu empresa");
    expect(screen.getByText("Así te verán los candidatos.")).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre comercial")).toHaveAttribute("autocomplete", "organization");
    expect(screen.getByText("El nombre que verán los candidatos.")).toBeInTheDocument();
    expect(screen.getByLabelText("RFC")).toBeInTheDocument();
    const industry = screen.getByLabelText("Industria");
    expect(Array.from((industry as HTMLSelectElement).options).map(option => option.textContent)).toEqual(["Selecciona una industria", "Tecnología", "Manufactura"]);
    const website = screen.getByLabelText(/Sitio web/);
    expect(website).toHaveAttribute("placeholder", "tuempresa.com");
    expect(website).toHaveAttribute("inputmode", "url");
    expect(screen.getByText("Podrás publicar vacantes cuando verifiquemos tu empresa.")).toBeInTheDocument();
    expect(screen.getByText(/Ingresaste como/)).toHaveTextContent("Ingresaste como andrea@altavista.mx");
    expect(screen.getByRole("button", { name: "Salir" })).toBeInTheDocument();
    // The session name was given at «Tu cuenta»: not asked again.
    expect(screen.queryByLabelText("Nombre completo")).not.toBeInTheDocument();
  });

  it("validates before calling the server, with the artboard copy, and focuses the first error", async () => {
    await mount();
    fill({ name: " ", rfc: "GAL", industry: "", website: "grupoaltavista" });
    submit();
    expect(await screen.findByText("Escribe el nombre de tu empresa.")).toBeInTheDocument();
    expect(screen.getByText("El RFC debe tener exactamente 12 caracteres.")).toBeInTheDocument();
    expect(screen.getByText("Selecciona una industria.")).toBeInTheDocument();
    expect(screen.getByText("Escribe un sitio válido, como grupoaltavista.mx.")).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre comercial")).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(screen.getByLabelText("Nombre comercial")).toHaveFocus());
    expect(deps.complete).not.toHaveBeenCalled();
  });

  it("submits once with the session name, guards a double submit and goes to the dashboard", async () => {
    let finish: (value: unknown) => void = () => {};
    deps.complete.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await mount();
    fill();
    submit();
    const busy = screen.getByRole("button", { name: /Creando empresa/ });
    expect(busy).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(busy);
    fireEvent.submit(busy.closest("form")!);
    expect(deps.complete).toHaveBeenCalledTimes(1);
    expect(deps.complete).toHaveBeenCalledWith({ fullName: "Andrea Salinas", name: "Grupo Altavista", rfc: "GAL010101AB1", industryId: "i1", website: "grupoaltavista.mx" });
    await act(async () => { finish({ kind: "created" }); });
    await waitFor(() => expect(deps.assign).toHaveBeenCalledWith("/empresa/dashboard"));
  });

  it("asks for the name only when the session has none usable", async () => {
    deps.session = { status: "authenticated", data: { user: { email: "andrea@altavista.mx", name: null } } };
    await mount();
    fill();
    fireEvent.change(screen.getByLabelText("Nombre completo"), { target: { value: "A" } });
    submit();
    expect(await screen.findByText("Escribe un nombre de 2 a 120 caracteres.")).toBeInTheDocument();
    expect(deps.complete).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Nombre completo"), { target: { value: "Andrea Salinas" } });
    submit();
    await waitFor(() => expect(deps.complete).toHaveBeenCalledWith(expect.objectContaining({ fullName: "Andrea Salinas" })));
  });

  it("shows server field errors (duplicate RFC) and lets the person retry", async () => {
    deps.complete.mockResolvedValueOnce({ kind: "invalid", fields: { rfc: "Ese RFC ya está registrado." } });
    await mount();
    fill();
    submit();
    expect(await screen.findByText("Ese RFC ya está registrado.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("RFC")).toHaveFocus());
    submit();
    await waitFor(() => expect(deps.assign).toHaveBeenCalledWith("/empresa/dashboard"));
  });

  it("keeps what was typed after a network failure; retrying is safe", async () => {
    deps.complete.mockResolvedValueOnce({ kind: "unavailable" });
    await mount();
    fill();
    submit();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No pudimos conectarnos.");
    expect(alert).toHaveTextContent("Lo que escribiste sigue aquí.");
    expect(screen.getByLabelText("Nombre comercial")).toHaveValue("Grupo Altavista");
    submit();
    await waitFor(() => expect(deps.complete).toHaveBeenCalledTimes(2));
  });

  it.each([
    ["candidate_account", "Esta cuenta es de candidato."],
    ["email_in_use", "Ese correo ya tiene cuenta. Entra con tu contraseña."],
    ["email_not_verified", "Tu correo aún no está verificado."],
  ])("explains %s with a way out (Salir) and hides the form", async (kind, title) => {
    deps.complete.mockResolvedValueOnce({ kind });
    await mount();
    fill();
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(title);
    expect(screen.queryByRole("button", { name: "Crear empresa" })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Salir|Cerrar sesión/ })[0]);
    await waitFor(() => expect(deps.signOut).toHaveBeenCalledWith("/api/auth/cognito/logout"));
  });

  it("refuses a candidate account on arrival, never offering the form", async () => {
    deps.load.mockResolvedValue({ kind: "candidate_account" });
    await mount();
    expect(screen.getByRole("alert")).toHaveTextContent("Esta cuenta es de candidato.");
    expect(screen.queryByLabelText("Nombre comercial")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir a mi área de candidato" })).toHaveAttribute("href", "/candidato/dashboard");
  });

  it("sends an account that already has a company to the dashboard", async () => {
    deps.load.mockResolvedValue({ kind: "done" });
    await mount();
    expect(deps.assign).toHaveBeenCalledWith("/empresa/dashboard");
    expect(screen.queryByLabelText("Nombre comercial")).not.toBeInTheDocument();
  });

  it("requires a session: a visitor goes to the employer login and back here", async () => {
    deps.session = { status: "unauthenticated", data: null };
    await mount();
    expect(deps.assign).toHaveBeenCalledWith("/empresa/login?callbackUrl=%2Fempresa%2Fregistro%2Fempresa");
    expect(deps.load).not.toHaveBeenCalled();
  });

  it("sends an expired session from the server to the login too", async () => {
    deps.load.mockResolvedValue({ kind: "unauthenticated" });
    await mount();
    expect(deps.assign).toHaveBeenCalledWith("/empresa/login?callbackUrl=%2Fempresa%2Fregistro%2Fempresa");
  });

  it("offers a retry when the step cannot load", async () => {
    deps.load.mockResolvedValueOnce({ kind: "unavailable" });
    await mount();
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos conectarnos.");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByLabelText("Nombre comercial")).toBeInTheDocument();
    expect(deps.load).toHaveBeenCalledTimes(2);
  });

  it("shows only a quiet status while the session and the step load", () => {
    deps.load.mockReturnValue(new Promise(() => {}));
    render(<CompanyStepForm />);
    expect(screen.getByRole("status")).toHaveTextContent("Cargando…");
    expect(screen.queryByLabelText("Nombre comercial")).not.toBeInTheDocument();
  });
});
