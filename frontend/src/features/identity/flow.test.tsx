import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { IdentityResult } from "./model";
import userEvent from "@testing-library/user-event";
const mocks = vi.hoisted(() => ({ load: vi.fn(), create: vi.fn(), replace: vi.fn(), signOut: vi.fn(), notify: vi.fn(), session: { status: "authenticated", data: { user: { email: "session@example.com" } } } as { status: string; data: { user?: { email?: string }; error?: string } | null } }));
vi.mock("./actions", () => ({ loadMeAction: mocks.load, createCandidateAccountAction: mocks.create }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("next-auth/react", () => ({ SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>, useSession: () => mocks.session, signOut: mocks.signOut }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: mocks.notify }));
import CandidateEntryPage from "@/app/(auth)/candidato/ingresar/page";
import { IdentitySessionProvider } from "./identity-session";
import { CandidateGuard, EmployerGuard } from "./area-guards";
const user = { id: "id", email: "api@example.com", full_name: "Ana Pérez" };
function result(role: "candidate" | "recruiter" | null): IdentityResult { return role === null ? { ok: true, data: { role, user: null } } : { ok: true, data: { role, user } }; }
const failure = (reason: string) => ({ ok: false, reason, reference: { status: 503 } });
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); mocks.session = { status: "authenticated", data: { user: { email: "session@example.com" } } }; mocks.load.mockResolvedValue(result(null)); });
describe("post-sign-in router", () => {
  it.each([["candidate", "/candidato/dashboard"], [null, null], ["recruiter", null]] as const)("routes %s without an implicit write", async (role, target) => {
    mocks.load.mockResolvedValue(result(role)); render(<CandidateEntryPage />);
    if (target) {
      await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(target));
      expect(screen.getByRole("status")).toHaveTextContent("Verificando tu cuenta");
      expect(document.querySelector('[data-slot="skeleton"]')).toBeNull();
    }
    else if (role === null) expect(await screen.findByRole("heading", { name: "Crear mi cuenta de candidato" })).toBeInTheDocument();
    else { expect(await screen.findByText("Esta cuenta es de empresa")).toBeInTheDocument(); expect(screen.getByRole("link", { name: "Ir a empresa" })).toHaveAttribute("href", "/empresa/login"); }
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("redirects no session and skips the identity request", async () => {
    mocks.session = { status: "unauthenticated", data: null }; render(<CandidateEntryPage />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/candidato/login")); expect(mocks.load).not.toHaveBeenCalled();
  });
  it("redirects a backend unauthenticated response", async () => {
    mocks.load.mockResolvedValue(failure("unauthenticated")); render(<CandidateEntryPage />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/candidato/login"));
  });
  it("uses a skeleton, then an error with explicit retry", async () => {
    let finish!: (value: unknown) => void;
    mocks.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); render(<CandidateEntryPage />);
    expect(screen.getByRole("status")).toHaveTextContent("Cargando tu cuenta");
    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    const card = document.querySelector('[data-slot="card"]')!;
    expect(card).not.toBeNull();
    for (const slot of ["card-header", "card-title", "card-description", "card-content", "card-footer"]) expect(card.querySelector(`[data-slot="${slot}"]`)).not.toBeNull();
    expect(card).toHaveAttribute("aria-hidden", "true");
    expect(card.querySelectorAll('[data-slot="field"]')).toHaveLength(1);
    finish(failure("no_response"));
    fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    expect(await screen.findByLabelText("Nombre completo")).toBeInTheDocument(); expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ key: "identity-read", type: "success" }));
  });
});
describe("explicit candidate onboarding", () => {
  it("keeps the onboarding skeleton and loaded card slot sequences identical", async () => {
    let finish!: (value: unknown) => void;
    mocks.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { container } = render(<CandidateEntryPage />);
    const slots = () => Array.from(container.querySelectorAll('[data-slot^="card"]')).map(node => node.getAttribute("data-slot"));
    const loadingSlots = slots();
    expect(loadingSlots).toEqual(["card", "card-header", "card-title", "card-description", "card-content", "card-footer"]);
    expect(screen.getByRole("status")).toHaveTextContent("Cargando tu cuenta");
    finish(result(null));
    await screen.findByLabelText("Nombre completo");
    expect(slots()).toEqual(loadingSlots);
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull();
  });
  async function form() { render(<CandidateEntryPage />); return await screen.findByLabelText("Nombre completo"); }
  it("composes onboarding with a semantic CardTitle, description and closing action", async () => {
    const input = await form();
    const card = input.closest('[data-slot="card"]')!;
    expect(card.querySelector(':scope > [data-slot="card-header"] > [data-slot="card-title"] h2')).toHaveTextContent("Crear mi cuenta de candidato");
    expect(card.querySelector('[data-slot="card-description"]')).toHaveTextContent("session@example.com");
    expect(card.querySelector('[data-slot="card-footer"]')).toContainElement(screen.getByRole("button", { name: "Crear mi cuenta de candidato" }));
  });
  it("displays session-only email, validates and focuses the name, never auto-submits", async () => {
    const input = await form();
    expect(screen.getByText("Vas a crear una cuenta de candidato con session@example.com. Esta cuenta no podrá usarse para publicar vacantes.")).toBeInTheDocument();
    expect(screen.queryByText("api@example.com")).toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByText("Escribe un nombre de 2 a 120 caracteres.")).toBeInTheDocument();
    expect(input).toHaveFocus(); expect(input).toHaveAttribute("aria-invalid", "true"); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("allows an explicit Enter submission", async () => {
    mocks.create.mockResolvedValue(result("candidate"));
    const input = await form();
    await userEvent.type(input, "Ana Pérez{Enter}");
    await waitFor(() => expect(mocks.create).toHaveBeenCalledExactlyOnceWith({ full_name: "Ana Pérez" }));
  });
  it("submits only a trimmed name once and redirects after confirmed success", async () => {
    mocks.create.mockResolvedValue(result("candidate")); const input = await form();
    fireEvent.change(input, { target: { value: "  Ana Pérez  " } }); expect(mocks.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Crear mi cuenta de candidato" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/candidato/dashboard"));
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({ full_name: "Ana Pérez" });
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Cuenta de candidato creada" }));
  });
  it.each(["account_exists", "email_in_use", "email_not_verified", "validation_error", "identity_unavailable", "no_response", "server_error", "unrecognized_response", "unauthenticated"])("persists %s without automatic retry", async reason => {
    mocks.create.mockResolvedValue(failure(reason)); const input = await form();
    fireEvent.change(input, { target: { value: "Ana" } }); fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    if (reason === "account_exists") expect(await screen.findByText("Esta cuenta ya es de empresa")).toBeInTheDocument();
    else if (reason === "unauthenticated") await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/candidato/login"));
    else {
      await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: "error" })));
      expect(screen.getByRole("status")).toBeInTheDocument();
      if (["identity_unavailable", "no_response", "server_error", "unrecognized_response"].includes(reason)) {
        fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
        await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
      }
      if (reason === "email_not_verified") expect(screen.getByRole("status")).toHaveTextContent("Verifica tu email desde el correo de Cognito y vuelve a ingresar.");
      if (reason === "validation_error") { expect(input).toHaveAttribute("aria-invalid", "true"); expect(input).toHaveFocus(); }
    }
  });
  it("blocks double submit while pending", async () => {
    mocks.create.mockImplementationOnce(() => new Promise(() => {})); const input = await form();
    fireEvent.change(input, { target: { value: "Ana" } }); fireEvent.submit(input.closest("form")!); fireEvent.submit(input.closest("form")!);
    expect(mocks.create).toHaveBeenCalledTimes(1); expect(screen.getByRole("button", { name: "Creando cuenta…" })).toBeDisabled();
  });
});
describe("area role guards", () => {
  function guard(area: "candidate" | "employer") { const Guard = area === "candidate" ? CandidateGuard : EmployerGuard; return render(<IdentitySessionProvider><section aria-label={`${area} shell`}><Guard><p>private content</p></Guard></section></IdentitySessionProvider>); }
  it.each(["candidate", "employer"] as const)("%s shows only a quiet identity spinner until the role resolves", area => {
    mocks.load.mockImplementationOnce(() => new Promise(() => {}));
    const { container } = guard(area);
    expect(screen.queryByText("private content")).toBeNull();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Verificando tu cuenta");
    expect(status).toHaveClass("sr-only");
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    const busy = status.closest('[aria-busy="true"]')!;
    expect(busy).toHaveClass("flex-1", "items-center", "justify-center", "min-h-svh");
    expect(busy).toHaveClass(area === "candidate" ? "md:min-h-[calc(100svh-var(--spacing)*6)]" : "md:min-h-[calc(100svh-var(--spacing)*4)]");
    expect(screen.getByRole("region", { name: `${area} shell` })).toBeVisible();
    expect(container.querySelector('[data-slot="spinner"]')).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull();
    expect(container.querySelector('[data-slot="card"]')).toBeNull();
  });
  it.each(["candidate", "recruiter", null] as const)("candidate area handles %s", async role => {
    mocks.load.mockResolvedValue(result(role)); guard("candidate");
    if (role === "candidate") expect(await screen.findByText("private content")).toBeInTheDocument();
    else if (role === null) await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/candidato/ingresar"));
    else expect(await screen.findByText("Esta cuenta es de empresa")).toBeInTheDocument();
    if (role !== "candidate") expect(screen.queryByText("private content")).toBeNull();
  });
  it.each(["unauthenticated", "no_response", "server_error", "identity_unavailable", "unrecognized_response"])("candidate fails closed on %s", async reason => {
    mocks.load.mockResolvedValue(failure(reason)); guard("candidate");
    if (reason === "unauthenticated") await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/candidato/login"));
    else expect(await screen.findByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    expect(screen.queryByText("private content")).toBeNull();
  });
  it.each(["candidate", "recruiter", null] as const)("employer area handles %s", async role => {
    mocks.load.mockResolvedValue(result(role)); guard("employer");
    if (role === "recruiter") expect(await screen.findByText("private content")).toBeInTheDocument();
    else { expect(await screen.findByText(role === null ? "Esta cuenta todavía no tiene acceso a empresa" : "Esta cuenta es de candidato")).toBeInTheDocument(); expect(screen.queryByText("private content")).toBeNull(); }
  });
  it.each(["no_response", "server_error"])("employer preserves access on transient %s", async reason => {
    mocks.load.mockResolvedValue(failure(reason)); guard("employer"); expect(await screen.findByText("private content")).toBeInTheDocument();
  });
  it.each(["identity_unavailable", "unrecognized_response"])("employer does not fail open on %s", async reason => {
    mocks.load.mockResolvedValue(failure(reason)); guard("employer"); expect(await screen.findByRole("button", { name: "Reintentar" })).toBeInTheDocument(); expect(screen.queryByText("private content")).toBeNull();
  });
  it.each(["candidate", "employer"] as const)("%s keeps its no-session behavior", async area => {
    mocks.session = { status: "unauthenticated", data: null }; guard(area);
    if (area === "employer") expect(screen.getByText("private content")).toBeInTheDocument();
    else await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/candidato/login"));
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("does not reuse cached identity after sign-out and a new sign-in", async () => {
    mocks.load.mockResolvedValueOnce(result("candidate"));
    const view = guard("candidate"); await screen.findByText("private content");
    mocks.session = { status: "unauthenticated", data: null };
    view.rerender(<IdentitySessionProvider><CandidateGuard><p>private content</p></CandidateGuard></IdentitySessionProvider>);
    mocks.load.mockImplementationOnce(() => new Promise(() => {}));
    mocks.session = { status: "authenticated", data: { user: { email: "session@example.com" } } };
    view.rerender(<IdentitySessionProvider><CandidateGuard><p>private content</p></CandidateGuard></IdentitySessionProvider>);
    expect(screen.queryByText("private content")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Verificando tu cuenta");
    expect(document.querySelector('[data-slot="skeleton"]')).toBeNull();
  });
  it("ignores a late identity result after switching accounts", async () => {
    let finish!: (value: unknown) => void;
    mocks.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = guard("candidate");
    mocks.load.mockResolvedValueOnce(result("recruiter"));
    mocks.session = { status: "authenticated", data: { user: { email: "other@example.com" } } };
    view.rerender(<IdentitySessionProvider><CandidateGuard><p>private content</p></CandidateGuard></IdentitySessionProvider>);
    expect(await screen.findByText("Esta cuenta es de empresa")).toBeInTheDocument();
    finish(result("candidate"));
    await waitFor(() => expect(screen.queryByText("private content")).toBeNull());
  });
  it("drops candidate access after refresh expiration", async () => {
    mocks.load.mockResolvedValue(result("candidate")); const view = guard("candidate"); await screen.findByText("private content");
    mocks.session = { status: "authenticated", data: { error: "RefreshAccessTokenError" } };
    view.rerender(<IdentitySessionProvider><CandidateGuard><p>private content</p></CandidateGuard></IdentitySessionProvider>);
    expect(screen.queryByText("private content")).toBeNull(); await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/candidato/login"));
  });
});
