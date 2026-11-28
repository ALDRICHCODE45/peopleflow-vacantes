import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
const mocks = vi.hoisted(() => ({ pathname: "/empresa/dashboard", replace: vi.fn(), loadCompany: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname, useRouter: () => ({ replace: mocks.replace }), useSearchParams: () => new URLSearchParams() }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
vi.mock("./actions", () => ({ loadMeAction: vi.fn() }));
vi.mock("@/features/employer-company/actions", () => ({ loadCompanyStateAction: mocks.loadCompany }));
import { IdentityContext, type IdentityState } from "./identity-session";
import { EmployerGuard } from "./area-guards";
import { EMPLOYER_COMPANY_STEP } from "./employer-onboarding";
import { CompanyMembershipProvider } from "@/features/employer-company/company-membership-context";
import { SidebarProvider } from "@/components/company-dashboard/ui/sidebar";

const company = { id: "c", name: "Talentia", rfc: "R", industry_id: "i", status: "active" as const, location: null, updated_at: "2026-10-20T12:00:00Z" };
const membership = (role: "owner" | "recruiter" | "stakeholder") => ({ kind: "exists", company, role, industryLabel: "Tec", canViewTalentBase: role !== "stakeholder", canViewMetrics: role !== "recruiter" });
const user = { id: "u1", full_name: "Andrea Salinas", email: "andrea@altavista.mx" };
const identity = (role: "recruiter" | "candidate" | null): IdentityState => ({ status: "ready", email: user.email, retry() {}, update() {}, result: { ok: true, data: role === null ? { role, user: null } : { role, user } } });
function mount(state: IdentityState) {
  return render(<IdentityContext.Provider value={state}><SidebarProvider><CompanyMembershipProvider><EmployerGuard><p>Contenido privado</p></EmployerGuard></CompanyMembershipProvider></SidebarProvider></IdentityContext.Provider>);
}
beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  mocks.replace.mockReset(); mocks.loadCompany.mockReset(); mocks.pathname = "/empresa/dashboard";
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("A4.5: a freshly signed-up employer is routed to «Tu empresa»", () => {
  it("is the registration step path", () => expect(EMPLOYER_COMPANY_STEP).toBe("/empresa/registro/empresa"));

  it.each(["/empresa/dashboard", "/empresa/equipo", "/empresa/configuracion"])("sends an account without a users row from %s to the step, never mounting the page", async pathname => {
    mocks.pathname = pathname;
    mount(identity(null));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/empresa/registro/empresa"));
    expect(screen.queryByText("Contenido privado")).toBeNull();
    expect(screen.queryByText("Esta cuenta todavía no tiene acceso a empresa")).toBeNull();
    expect(mocks.loadCompany).not.toHaveBeenCalled();
  });

  it.each(["/empresa", "/empresa/dashboard"])("sends a recruiter without a company from the landing %s to the step", async pathname => {
    mocks.pathname = pathname;
    mocks.loadCompany.mockResolvedValue({ kind: "none", industries: [] });
    mount(identity("recruiter"));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/empresa/registro/empresa"));
    expect(screen.queryByText("Contenido privado")).toBeNull();
  });
});

describe("previous behavior is kept", () => {
  it.each(["/empresa/invitacion/tok_123", "/empresa/invitacion"])("an invited person without a users row keeps the invitation page %s", async pathname => {
    mocks.pathname = pathname;
    mount(identity(null));
    expect(await screen.findByText("Contenido privado")).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("an invited recruiter without a company yet keeps the invitation page", async () => {
    mocks.pathname = "/empresa/invitacion/tok_123";
    mocks.loadCompany.mockResolvedValue({ kind: "none", industries: [] });
    mount(identity("recruiter"));
    expect(await screen.findByText("Contenido privado")).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("a recruiter without a company keeps Configuración (company creation there, local bootstrap)", async () => {
    mocks.pathname = "/empresa/configuracion";
    mocks.loadCompany.mockResolvedValue({ kind: "none", industries: [] });
    mount(identity("recruiter"));
    expect(await screen.findByText("Contenido privado")).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it.each(["owner", "recruiter"] as const)("an existing %s with a company stays on the dashboard", async role => {
    mocks.loadCompany.mockResolvedValue(membership(role));
    mount(identity("recruiter"));
    expect(await screen.findByText("Contenido privado")).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("a stakeholder still lands on Métricas", async () => {
    mocks.loadCompany.mockResolvedValue(membership("stakeholder"));
    mount(identity("recruiter"));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/empresa/metricas"));
  });

  it("a transient membership failure still lets an existing recruiter in", async () => {
    mocks.loadCompany.mockResolvedValue({ kind: "server_error", reference: { status: 503 } });
    mount(identity("recruiter"));
    expect(await screen.findByText("Contenido privado")).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("a candidate is still blocked with the candidate screen, never sent to the step", async () => {
    mount(identity("candidate"));
    expect(await screen.findByText("Esta cuenta es de candidato")).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
