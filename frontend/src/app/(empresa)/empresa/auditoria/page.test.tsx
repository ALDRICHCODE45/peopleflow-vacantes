import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { act } from "react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const { pathnameMock, identityMock, companyMock } = vi.hoisted(() => ({
  pathnameMock: vi.fn<() => string | null>(() => "/empresa/auditoria"),
  identityMock: vi.fn(),
  companyMock: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => pathnameMock() }));
vi.mock("@/features/identity/identity-session", () => ({ useIdentity: identityMock }));
vi.mock("@/features/employer-company/actions", () => ({ loadCompanyStateAction: companyMock }));
// The workspace owns its transport and tests; the route only mounts the page.
vi.mock("@/features/audit-log/audit-page", () => ({
  AuditPage: () => <section data-pf-audit=""><h2>Registro de actividad</h2></section>,
}));

import { EmployerShell } from "@/components/company-dashboard/employer-shell";
import PageContent, { metadata } from "./page";

function Page() {
  return <EmployerShell><PageContent /></EmployerShell>;
}
const pagePath = join(process.cwd(), "src/app/(empresa)/empresa/auditoria/page.tsx");
const pageSource = existsSync(pagePath) ? readFileSync(pagePath, "utf8") : "";

function stubBrowserApis() {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, media: "", onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: () => false })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("innerWidth", 1280);
}
const company = { id: "c", name: "Empresa", rfc: "ABC123456789", industry_id: "i", status: "active", location: null, updated_at: "2026-10-20T12:00:00Z" };

beforeEach(() => {
  stubBrowserApis();
  identityMock.mockReturnValue({ status: "ready", result: { ok: true, data: { role: "recruiter", user: { id: "u", full_name: "Olga Dueña", email: "olga@empresa.mx" } } } });
  companyMock.mockReset().mockResolvedValue({ kind: "exists", role: "owner", industryLabel: "T", company, canViewTalentBase: true });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("/empresa/auditoria employer route", () => {
  it("declares its own Spanish route metadata", () => {
    expect(metadata.title).toBe("Auditoría");
  });

  it("reuses the shared employer shell with «Auditoría» active for the owner", async () => {
    await act(async () => { render(<Page />); });
    expect(document.querySelectorAll("[data-slot='sidebar-wrapper']")).toHaveLength(1);
    const link = screen.getByRole("link", { name: "Auditoría" });
    expect(link).toHaveAttribute("href", "/empresa/auditoria");
    expect(link).toHaveAttribute("data-active");
  });

  it("renders the shared header with the route title under a single H1 and mounts the page once", async () => {
    await act(async () => { render(<Page />); });
    const header = document.querySelector("header") as HTMLElement;
    expect(within(header).getByRole("heading", { level: 1 })).toHaveTextContent("Auditoría");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(document.querySelectorAll("[data-pf-audit]")).toHaveLength(1);
  });
});

describe("/empresa/auditoria composition boundary", () => {
  it("mounts the shared header and the audit page", () => {
    expect(pageSource).toContain('<SiteHeader title="Auditoría" />');
    expect(pageSource).toContain("<AuditPage />");
    expect(pageSource).toContain('from "@/features/audit-log/audit-page"');
  });

  it("stays a server component with no request, credential or client-state concern", () => {
    expect(pageSource).not.toContain("use client");
    for (const forbidden of ["fetch(", "lib/api", "useState", "useEffect", "Authorization", "Bearer", "localStorage", "cookies"]) {
      expect(pageSource, `page.tsx must not declare ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("never mounts a second employer shell", () => {
    expect(pageSource).not.toMatch(/<EmployerShell\b/u);
    expect(pageSource).not.toMatch(/<SidebarProvider\b/u);
  });
});
