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
import { AcceptInvitationPage, AcceptOutcomePage, MEMBERSHIP_WAIT_MS } from "./accept-page";
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
  mocks.loadCompany.mockResolvedValue({ kind: "none", industries: [] });
  mocks.accept.mockReturnValue(new Promise(done => { resolve = done; }));
  mount(<AcceptInvitationPage token={urlToken} />);
  expect(screen.getByRole("heading", { name: "Confirmando tu invitación…" })).toBeInTheDocument();
  expect(screen.getByText("Esto tarda unos segundos.")).toBeInTheDocument();
  await act(async () => resolve({ ok: true, companyId, memberId }));
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledExactlyOnceWith("/empresa/invitacion?estado=unido"));
  expect(mocks.accept).toHaveBeenCalledExactlyOnceWith(urlToken);
  expect(mocks.loadCompany).toHaveBeenCalledTimes(2);
});

it("re-reads the membership before leaving for the joined outcome, so the welcome needs no page reload", async () => {
  let reread!: (value: unknown) => void;
  mocks.loadCompany.mockResolvedValueOnce({ kind: "none", industries: [] }).mockReturnValueOnce(new Promise(done => { reread = done; }));
  mocks.accept.mockResolvedValue({ ok: true, companyId, memberId });
  let navigate!: (path: string) => void;
  function Frame() {
    const [path, setPath] = React.useState<string | null>(null);
    navigate = setPath;
    return path ? <AcceptOutcomePage outcome="unido" /> : <AcceptInvitationPage token={urlToken} />;
  }
  mocks.replace.mockImplementation((path: string) => navigate(path));
  mount(<Frame />);
  await waitFor(() => expect(mocks.loadCompany).toHaveBeenCalledTimes(2));
  // Leaving while the read is in flight raced the router in the browser: the outcome waited for a read that never settled.
  expect(mocks.replace).not.toHaveBeenCalled();
  expect(screen.getByRole("heading", { name: "Confirmando tu invitación…" })).toBeInTheDocument();
  await act(async () => reread({ kind: "exists", company, role: "stakeholder", industryLabel: "Tec", canViewTalentBase: false, canViewMetrics: true }));
  expect(await screen.findByRole("heading", { name: "Te uniste a Talentia Consultores" })).toBeInTheDocument();
  expect(mocks.replace).toHaveBeenCalledExactlyOnceWith("/empresa/invitacion?estado=unido");
  expect(mocks.loadCompany).toHaveBeenCalledTimes(2);
});

it("leaves for the joined outcome even when the membership re-read never answers", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    mocks.accept.mockResolvedValue({ ok: true, companyId, memberId });
    mount(<AcceptInvitationPage token={urlToken} />);
    await waitFor(() => expect(mocks.loadCompany).toHaveBeenCalledTimes(2));
    await act(async () => { vi.advanceTimersByTime(MEMBERSHIP_WAIT_MS); });
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledExactlyOnceWith("/empresa/invitacion?estado=unido"));
  } finally { vi.useRealTimers(); }
});

it("never spins forever on the joined outcome: a membership read that does not answer ends in a retry", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    mount(<AcceptOutcomePage outcome="unido" />);
    expect(screen.getByRole("heading", { name: "Confirmando tu invitación…" })).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(MEMBERSHIP_WAIT_MS); });
    expect(screen.getByRole("heading", { name: "No pudimos confirmar tu acceso" })).toBeInTheDocument();
    expect(screen.getByText("Si ya aceptaste la invitación, reintentar no repite nada.")).toBeInTheDocument();
    expect(screen.queryByText(/Te uniste/)).toBeNull();
    mocks.loadCompany.mockResolvedValue({ kind: "exists", company, role: "stakeholder", industryLabel: "Tec", canViewTalentBase: false, canViewMetrics: true });
    await act(async () => screen.getByRole("button", { name: "Reintentar" }).click());
    expect(await screen.findByRole("heading", { name: "Te uniste a Talentia Consultores" })).toBeInTheDocument();
    expect(mocks.loadCompany).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
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
  mocks.loadCompany.mockResolvedValue({ kind: "none", industries: [] });
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

it("does not loop back to sign-in when the session exists but the API does not know the account yet", async () => {
  mocks.accept.mockResolvedValue({ ok: false, reason: "unauthenticated", reference: { status: 401, code: "unauthenticated" } });
  mount(<AcceptInvitationPage token={urlToken} />);
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledExactlyOnceWith("/empresa/invitacion?estado=cuenta-no-lista"));
  expect(screen.queryByRole("link", { name: "Iniciar sesión" })).toBeNull();
});

it("explains an account the API does not know yet, with sign-out as the way out", () => {
  mount(<AcceptOutcomePage outcome="cuenta-no-lista" />);
  expect(screen.getByRole("heading", { name: "Tu cuenta todavía no está lista para PeopleFlow" })).toBeInTheDocument();
  expect(screen.getByText("Cierra sesión e inténtalo más tarde o contacta a soporte.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Iniciar sesión" })).toBeNull();
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
