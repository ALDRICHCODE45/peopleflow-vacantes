import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
const mocks = vi.hoisted(() => ({ notify: vi.fn(), logout: vi.fn(), identity: { result: { ok: true, data: { role: "candidate", user: { full_name: "Ana Pérez", email: "ana@example.com" } } } } as { result?: unknown } }));
vi.mock("@/features/identity/identity-session", () => ({ useIdentity: () => mocks.identity }));
vi.mock("next-auth/react", () => ({ signOut: mocks.logout }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: mocks.notify }));
vi.mock("@/components/company-dashboard/nav-user", () => ({ NavUser: ({ user, onLogout }: { user: { name: string; email: string }; onLogout?: () => void }) => <><p>{user.name}</p><p>{user.email}</p><button onClick={onLogout}>Cerrar sesión</button></> }));
import { CandidateNavUser, candidateAccountMenu } from "@/components/candidate-dashboard/candidate-nav-user";
afterEach(cleanup);
it("renders the loaded name and email, never prototype identity, and federated candidate logout", async () => {
  render(<CandidateNavUser />);
  expect(screen.getByText("Ana Pérez")).toBeInTheDocument(); expect(screen.getByText("ana@example.com")).toBeInTheDocument(); expect(screen.queryByText(/Ximena/)).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" })); });
  expect(mocks.logout).toHaveBeenCalledWith({ callbackUrl: "/api/auth/cognito/logout?to=candidato" });
});
it("reports a logout failure without disclosing the exception", async () => {
  mocks.logout.mockRejectedValueOnce(new Error("private-token"));
  render(<CandidateNavUser />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" })); });
  expect(screen.getByRole("status")).toHaveTextContent("No se cerró la sesión");
  expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
  expect(screen.queryByText(/private-token/)).toBeNull();
});
it("keeps only candidate destinations in the pure menu configuration", () => {
  expect(candidateAccountMenu.map(item => [item.title, item.href])).toEqual([["Mi perfil", "/candidato/perfil"], ["Mis CVs", "/candidato/cvs"], ["Configuración", "/candidato/configuracion"]]);
});
it("does not invent identity before loading", () => {
  mocks.identity = {}; render(<CandidateNavUser />); expect(screen.getByText("Mi cuenta")).toBeInTheDocument(); expect(screen.queryByText(/Ximena|ana@example.com/)).toBeNull();
});
