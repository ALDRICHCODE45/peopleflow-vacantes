import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./actions", () => ({ listAuditEventsAction: vi.fn(), loadAuditOptionsAction: vi.fn() }));
vi.mock("@/features/employer-company/actions", () => ({ loadCompanyStateAction: vi.fn() }));
import { loadCompanyStateAction, type CompanyState } from "@/features/employer-company/actions";
import { listAuditEventsAction, loadAuditOptionsAction } from "./actions";
import { AuditPage } from "./audit-page";
import { auditActors, auditPage, auditTypes, auditVacancies } from "./test-fixtures";

const company = { id: "c", name: "Empresa", rfc: "ABC123456789", industry_id: "i", status: "active" as const, location: null, updated_at: "2026-10-20T12:00:00Z" };
const asRole = (role: "owner" | "recruiter"): CompanyState => ({ kind: "exists", company, role, industryLabel: "Tecnología", canViewTalentBase: true });
const load = vi.mocked(loadCompanyStateAction);
const noData = () => { expect(listAuditEventsAction).not.toHaveBeenCalled(); expect(loadAuditOptionsAction).not.toHaveBeenCalled(); };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listAuditEventsAction).mockResolvedValue({ ok: true, data: auditPage() });
  vi.mocked(loadAuditOptionsAction).mockResolvedValue({ ok: true, types: auditTypes, actors: auditActors, vacancies: auditVacancies });
});
afterEach(cleanup);

it("shows the owner the audit workspace", async () => {
  load.mockResolvedValue(asRole("owner"));
  render(<AuditPage />);
  expect(await screen.findByRole("table")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Registro de actividad" })).toBeInTheDocument();
});

it("resolves the membership first: nothing is read while it is loading", () => {
  load.mockReturnValue(new Promise(() => {}));
  render(<AuditPage />);
  expect(screen.getByRole("status", { name: /Cargando/ })).toBeInTheDocument();
  noData();
});

it("shows a recruiter the restricted card and reads no audit data at all", async () => {
  load.mockResolvedValue(asRole("recruiter"));
  render(<AuditPage />);
  expect(await screen.findByText("Auditoría restringida")).toBeInTheDocument();
  expect(screen.getByText("Solo el owner de la empresa puede consultar la auditoría.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Ir al dashboard" })).toHaveAttribute("href", "/empresa/dashboard");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Exportar/ })).not.toBeInTheDocument();
  noData();
});

it("treats a user without a company like a non-owner", async () => {
  load.mockResolvedValue({ kind: "none", industries: [] });
  render(<AuditPage />);
  expect(await screen.findByText("Auditoría restringida")).toBeInTheDocument();
  noData();
});

it("asks to sign in again when the session expired, without reading data", async () => {
  load.mockResolvedValue({ kind: "unauthenticated", reference: {} });
  render(<AuditPage />);
  expect(await screen.findByText(/Tu sesión expiró/)).toBeInTheDocument();
  noData();
});

it.each(["server_error", "no_response", "unrecognized_response"] as const)("offers a retry when the membership is unavailable (%s) and then loads", async kind => {
  load.mockResolvedValueOnce({ kind, reference: {} });
  load.mockResolvedValueOnce(asRole("owner"));
  render(<AuditPage />);
  expect(await screen.findByText("No pudimos verificar tu rol")).toBeInTheDocument();
  noData();
  await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  expect(await screen.findByRole("table")).toBeInTheDocument();
});

it("treats a rejected membership read as unavailable", async () => {
  load.mockRejectedValue(new Error("boom"));
  render(<AuditPage />);
  expect(await screen.findByText("No pudimos verificar tu rol")).toBeInTheDocument();
  noData();
});
