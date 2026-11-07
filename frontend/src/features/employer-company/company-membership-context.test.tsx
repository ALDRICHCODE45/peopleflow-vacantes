import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
vi.mock("./actions", () => ({ loadCompanyStateAction: vi.fn() }));
import { loadCompanyStateAction, type CompanyState } from "./actions";
import { IdentityContext, type IdentityState } from "@/features/identity/identity-session";
import { CompanyMembershipProvider, useCompanyMembershipState } from "./company-membership-context";
import { useCompanyMembership } from "./use-company-membership";

const company = { id: "c", name: "Talentia", rfc: "R", industry_id: "i", status: "active" as const, location: null, updated_at: "2026-10-20T12:00:00Z" };
const exists = (role: "owner" | "recruiter" | "stakeholder"): CompanyState => ({ kind: "exists", company, role, industryLabel: "Tec", canViewTalentBase: role !== "stakeholder", canViewMetrics: role !== "recruiter" });
const identity = (role: "recruiter" | "candidate"): IdentityState => ({ status: "ready", email: null, retry() {}, update() {}, result: { ok: true, data: { role, user: { id: "u1", full_name: "Ana", email: "a@example.test" } } } });
beforeEach(() => vi.mocked(loadCompanyStateAction).mockReset());
afterEach(cleanup);

function Probe() {
  const shared = useCompanyMembershipState();
  const membership = useCompanyMembership("u1");
  return <p>{shared?.state ? shared.state.kind : "loading"}:{membership?.role ?? "none"}<button type="button" onClick={() => shared?.reload()}>reload</button></p>;
}

it("reads GET /me/company once for the frame and hands the same membership to every consumer", async () => {
  vi.mocked(loadCompanyStateAction).mockResolvedValue(exists("stakeholder"));
  render(<IdentityContext.Provider value={identity("recruiter")}><CompanyMembershipProvider><Probe /><Probe /></CompanyMembershipProvider></IdentityContext.Provider>);
  expect(screen.getAllByText("loading:none")).toHaveLength(2);
  await waitFor(() => expect(screen.getAllByText("exists:stakeholder")).toHaveLength(2));
  expect(loadCompanyStateAction).toHaveBeenCalledTimes(1);
});

it("reloads on demand, showing loading instead of the previous membership", async () => {
  vi.mocked(loadCompanyStateAction).mockResolvedValueOnce({ kind: "none", industries: [] }).mockResolvedValueOnce(exists("stakeholder"));
  render(<IdentityContext.Provider value={identity("recruiter")}><CompanyMembershipProvider><Probe /></CompanyMembershipProvider></IdentityContext.Provider>);
  await screen.findByText("none:none");
  await act(async () => screen.getByRole("button", { name: "reload" }).click());
  expect(await screen.findByText("exists:stakeholder")).toBeInTheDocument();
  expect(loadCompanyStateAction).toHaveBeenCalledTimes(2);
});

it("reads nothing for a candidate account", () => {
  render(<IdentityContext.Provider value={identity("candidate")}><CompanyMembershipProvider><Probe /></CompanyMembershipProvider></IdentityContext.Provider>);
  expect(screen.getByText("loading:none")).toBeInTheDocument();
  expect(loadCompanyStateAction).not.toHaveBeenCalled();
});

it("keeps the standalone hook reading on its own outside the provider (previous behavior)", async () => {
  vi.mocked(loadCompanyStateAction).mockResolvedValue(exists("owner"));
  function Standalone() { return <p>{useCompanyMembership("u1")?.role ?? "none"}</p>; }
  render(<Standalone />);
  expect(await screen.findByText("owner")).toBeInTheDocument();
  expect(loadCompanyStateAction).toHaveBeenCalledTimes(1);
});
