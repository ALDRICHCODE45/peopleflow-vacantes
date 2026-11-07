import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
const mocks = vi.hoisted(() => ({ replace: vi.fn(), accept: vi.fn(), loadCompany: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
vi.mock("./actions", () => ({ acceptStakeholderInvitationAction: mocks.accept }));
vi.mock("@/features/employer-company/actions", () => ({ loadCompanyStateAction: mocks.loadCompany }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
import { IdentityContext, type IdentityState } from "@/features/identity/identity-session";
import { CompanyMembershipProvider } from "@/features/employer-company/company-membership-context";
import { AcceptInvitationPage, AcceptOutcomePage } from "./accept-page";
import { companyId, memberId, urlToken } from "./test-fixtures";

const company = { id: companyId, name: "Talentia Consultores", rfc: "R", industry_id: "i", status: "active" as const, location: null, updated_at: "2026-10-20T12:00:00Z" };
const signedIn: IdentityState = { status: "ready", email: "j@example.test", retry() {}, update() {}, result: { ok: true, data: { role: "recruiter", user: { id: "u1", full_name: "Jorge Treviño", email: "j@example.test" } } } };
const visitor: IdentityState = { status: "unauthenticated", email: null, retry() {}, update() {} };
const mount = (ui: React.ReactNode, identity = signedIn) => render(<IdentityContext.Provider value={identity}><CompanyMembershipProvider>{ui}</CompanyMembershipProvider></IdentityContext.Provider>);
beforeEach(() => { vi.resetAllMocks(); mocks.loadCompany.mockReturnValue(new Promise(() => {})); });
afterEach(cleanup);

it("asks a visitor to sign in as an employer, keeping the token only in the login callback", () => {
  mount(<AcceptInvitationPage token={urlToken} />, visitor);
  expect(screen.getByRole("heading", { name: "Te invitaron a ver métricas en PeopleFlow" })).toBeInTheDocument();
  expect(screen.getByText("Inicia sesión o crea una cuenta de empresa para aceptar. Al terminar volverás aquí y la invitación se confirmará sola.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Iniciar sesión" })).toHaveAttribute("href", `/empresa/login?callbackUrl=${encodeURIComponent(`/empresa/invitacion/${urlToken}`)}`);
  expect(mocks.accept).not.toHaveBeenCalled();
  expect(mocks.replace).not.toHaveBeenCalled();
});

it("confirms on the server once, then leaves the token URL for the joined outcome and re-reads the membership", async () => {
  let resolve!: (value: unknown) => void;
  mocks.accept.mockReturnValue(new Promise(done => { resolve = done; }));
  mount(<AcceptInvitationPage token={urlToken} />);
  expect(screen.getByRole("heading", { name: "Confirmando tu invitación…" })).toBeInTheDocument();
  expect(screen.getByText("Esto tarda unos segundos.")).toBeInTheDocument();
  await act(async () => resolve({ ok: true, companyId, memberId }));
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledExactlyOnceWith("/empresa/invitacion?estado=unido"));
  expect(mocks.accept).toHaveBeenCalledExactlyOnceWith(urlToken);
  expect(mocks.loadCompany).toHaveBeenCalledTimes(2);
});

it.each([
  ["invitation_invalid", "invalida"],
  ["candidate_account", "cuenta-candidato"],
  ["already_company_member", "ya-miembro"],
] as const)("sends %s to its token-free outcome page", async (reason, outcome) => {
  mocks.accept.mockResolvedValue({ ok: false, reason, reference: {} });
  mount(<AcceptInvitationPage token={urlToken} />);
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(`/empresa/invitacion?estado=${outcome}`));
  expect(mocks.replace.mock.calls[0][0]).not.toContain(urlToken);
});

it("keeps the token for a safe retry when the confirmation gets no answer", async () => {
  mocks.accept.mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} }).mockResolvedValueOnce({ ok: true, companyId, memberId });
  const user = userEvent.setup();
  mount(<AcceptInvitationPage token={urlToken} />);
  expect(await screen.findByRole("heading", { name: "No pudimos confirmar tu invitación" })).toBeInTheDocument();
  expect(screen.getByText("No se completó nada todavía. Puedes reintentar sin riesgo.")).toBeInTheDocument();
  expect(mocks.replace).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Reintentar" }));
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/empresa/invitacion?estado=unido"));
  expect(mocks.accept).toHaveBeenNthCalledWith(2, urlToken);
});

it("returns to the sign-in state when the session expired during the confirmation", async () => {
  mocks.accept.mockResolvedValue({ ok: false, reason: "unauthenticated", reference: {} });
  mount(<AcceptInvitationPage token={urlToken} />);
  expect(await screen.findByRole("link", { name: "Iniciar sesión" })).toBeInTheDocument();
  expect(mocks.replace).not.toHaveBeenCalled();
});

it("waits for the account check before confirming", () => {
  mount(<AcceptInvitationPage token={urlToken} />, { ...signedIn, status: "loading", result: undefined });
  expect(screen.getByRole("heading", { name: "Confirmando tu invitación…" })).toBeInTheDocument();
  expect(mocks.accept).not.toHaveBeenCalled();
});

it("welcomes a stakeholder to its company with the way to Métricas", async () => {
  mocks.loadCompany.mockResolvedValue({ kind: "exists", company, role: "stakeholder", industryLabel: "Tec", canViewTalentBase: false, canViewMetrics: true });
  mount(<AcceptOutcomePage outcome="unido" />);
  expect(await screen.findByRole("heading", { name: "Te uniste a Talentia Consultores" })).toBeInTheDocument();
  expect(screen.getByText("Tienes acceso de solo lectura a las métricas de la empresa. Puedes ver nombres de candidatos en el detalle; cada consulta queda registrada.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Ver métricas" })).toHaveAttribute("href", "/empresa/metricas");
});

it("never claims a join the membership does not confirm", async () => {
  mocks.loadCompany.mockResolvedValue({ kind: "exists", company, role: "owner", industryLabel: "Tec", canViewTalentBase: true, canViewMetrics: true });
  mount(<AcceptOutcomePage outcome="unido" />);
  expect(await screen.findByRole("heading", { name: "Abre tu enlace de invitación" })).toBeInTheDocument();
  expect(screen.queryByText(/Te uniste/)).toBeNull();
});

it.each([
  ["invalida", "Este enlace ya no es válido", "Puede haber vencido, haberse revocado o ya se usó. Pide a quien te invitó un enlace nuevo.", ["Ir al inicio"]],
  ["cuenta-candidato", "Este enlace es para cuentas de empresa", "Entraste con una cuenta de candidato. Cierra sesión, entra con una cuenta de empresa (o crea una) y vuelve a abrir el enlace que te enviaron.", ["Cerrar sesión"]],
  ["ya-miembro", "Ya perteneces a una empresa", "Tu cuenta ya es parte de otra empresa y solo puede pertenecer a una. Para ver estas métricas, usa otra cuenta de empresa.", ["Ir a mi empresa", "Cerrar sesión"]],
  [null, "Abre tu enlace de invitación", "Para unirte como stakeholder necesitas el enlace que te envió la persona dueña de la cuenta.", ["Ir al inicio"]],
] as const)("explains the %s outcome with its way out", (outcome, title, description, actions) => {
  mount(<AcceptOutcomePage outcome={outcome} />);
  expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
  expect(screen.getByText(description)).toBeInTheDocument();
  for (const name of actions) expect(screen.getAllByRole(name === "Cerrar sesión" ? "button" : "link", { name }).length).toBe(1);
});
