import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
const mocks = vi.hoisted(() => ({ pathname: "/empresa/vacantes", replace: vi.fn(), loadCompany: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname, useRouter: () => ({ replace: mocks.replace }), useSearchParams: () => new URLSearchParams() }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
vi.mock("./actions", () => ({ loadMeAction: vi.fn() }));
vi.mock("@/features/employer-company/actions", () => ({ loadCompanyStateAction: mocks.loadCompany }));
import { IdentityContext, type IdentityState } from "./identity-session";
import { EmployerGuard } from "./area-guards";
import { CompanyMembershipProvider } from "@/features/employer-company/company-membership-context";
import { SidebarProvider } from "@/components/company-dashboard/ui/sidebar";

const company = { id: "c", name: "Talentia", rfc: "R", industry_id: "i", status: "active" as const, location: null, updated_at: "2026-10-20T12:00:00Z" };
const membership = (role: "owner" | "recruiter" | "stakeholder") => ({ kind: "exists", company, role, industryLabel: "Tec", canViewTalentBase: role !== "stakeholder", canViewMetrics: role !== "recruiter" });
const recruiterAccount: IdentityState = { status: "ready", email: "a@example.test", retry() {}, update() {}, result: { ok: true, data: { role: "recruiter", user: { id: "u1", full_name: "Jorge Treviño", email: "a@example.test" } } } };
function mount(identity: IdentityState = recruiterAccount) {
  return render(<IdentityContext.Provider value={identity}><SidebarProvider><CompanyMembershipProvider><EmployerGuard><p>Contenido privado</p></EmployerGuard></CompanyMembershipProvider></SidebarProvider></IdentityContext.Provider>);
}
beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  mocks.replace.mockReset(); mocks.loadCompany.mockReset(); mocks.pathname = "/empresa/vacantes";
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows the route-outside-role screen to a stakeholder instead of mounting the page", async () => {
  mocks.loadCompany.mockResolvedValue(membership("stakeholder"));
  mount();
  expect(await screen.findByRole("heading", { name: "Esta sección no está disponible para tu rol" })).toBeInTheDocument();
  expect(screen.getByText("Como stakeholder ves las métricas de la empresa en solo lectura. Si necesitas algo más, pídelo a la persona dueña de la cuenta.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Ir a Métricas" })).toHaveAttribute("href", "/empresa/metricas");
  expect(screen.queryByText("Contenido privado")).toBeNull();
  expect(mocks.replace).not.toHaveBeenCalled();
});

it("titles the route-outside-role screen as an unavailable section, not as the account", async () => {
  mocks.loadCompany.mockResolvedValue(membership("stakeholder"));
  mount();
  expect(await screen.findByRole("heading", { level: 1, name: "Sección no disponible" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { level: 1, name: "Tu cuenta" })).toBeNull();
});

it("keeps the page unmounted while the membership is still loading", () => {
  mocks.loadCompany.mockReturnValue(new Promise(() => {}));
  mount();
  expect(screen.getByText("Verificando tu cuenta")).toBeInTheDocument();
  expect(screen.queryByText("Contenido privado")).toBeNull();
});

it("lands a stakeholder who opens the employer dashboard on Métricas", async () => {
  mocks.pathname = "/empresa/dashboard";
  mocks.loadCompany.mockResolvedValue(membership("stakeholder"));
  mount();
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/empresa/metricas"));
  expect(screen.queryByText("Contenido privado")).toBeNull();
});

it("lets a stakeholder into Métricas", async () => {
  mocks.pathname = "/empresa/metricas";
  mocks.loadCompany.mockResolvedValue(membership("stakeholder"));
  mount();
  expect(await screen.findByText("Contenido privado")).toBeInTheDocument();
});

it.each(["owner", "recruiter"] as const)("keeps every employer route open to a %s (previous behavior)", async role => {
  mocks.loadCompany.mockResolvedValue(membership(role));
  mount();
  expect(await screen.findByText("Contenido privado")).toBeInTheDocument();
  expect(mocks.replace).not.toHaveBeenCalled();
});

it.each([{ kind: "none", industries: [] }, { kind: "no_response", reference: {} }])("does not lock anyone out when the membership is %o (the API still enforces)", async state => {
  mocks.loadCompany.mockResolvedValue(state);
  mount();
  expect(await screen.findByText("Contenido privado")).toBeInTheDocument();
});

it("lets the invitation page own its no-session state instead of redirecting to the login", () => {
  mocks.pathname = "/empresa/invitacion/q3Jv8tR0wXbN5eLk2sYp9uHf7aCd1gMz4iOq6TnVrWo";
  mount({ status: "unauthenticated", email: null, retry() {}, update() {} });
  expect(screen.getByText("Contenido privado")).toBeInTheDocument();
  expect(mocks.replace).not.toHaveBeenCalled();
  expect(mocks.loadCompany).not.toHaveBeenCalled();
});

it("still sends a visitor of any other employer route to the login (previous behavior)", async () => {
  mount({ status: "unauthenticated", email: null, retry() {}, update() {} });
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/empresa/login?callbackUrl=%2Fempresa%2Fvacantes"));
  expect(screen.queryByText("Contenido privado")).toBeNull();
});
