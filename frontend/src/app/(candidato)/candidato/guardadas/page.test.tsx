import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import "@testing-library/jest-dom/vitest";
const workspace = vi.hoisted(() => vi.fn());
vi.mock("@/features/candidate/saved-vacancies-workspace", () => ({ SavedVacanciesWorkspace: (props: object) => { workspace(props); return <div data-pf-saved-vacancies-workspace />; } }));
vi.mock("@/features/identity/identity-session", () => ({ useIdentity: () => ({ status: "ready", result: { ok: true, data: { role: "candidate" } } }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/candidato/guardadas" }));
import Page, { metadata } from "./page";
import { CandidateShell } from "@/components/candidate-dashboard/candidate-shell";
const source = readFileSync(join(process.cwd(), "src/app/(candidato)/candidato/guardadas/page.tsx"), "utf8");
beforeEach(() => {
  workspace.mockClear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("innerWidth", 1280);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("keeps route identity and exactly one H1 before the real workspace without prototype data", () => {
  render(<CandidateShell><Page /></CandidateShell>);
  expect(metadata.title).toBe("Vacantes guardadas");
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  const heading = screen.getByRole("heading", { level: 1 });
  expect(heading).toHaveTextContent("Vacantes guardadas");
  const surfaces = document.querySelectorAll("[data-pf-saved-vacancies-workspace]");
  expect(surfaces).toHaveLength(1);
  expect(heading.compareDocumentPosition(surfaces[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(workspace.mock.calls.at(-1)?.[0]).toEqual({});
});
it("preserves the navigation label and activates only its own destination", () => {
  render(<CandidateShell><Page /></CandidateShell>);
  const nav = document.querySelector("[data-slot='sidebar-content']")!;
  expect(Array.from(nav.querySelectorAll("a[data-active]")).map(link => link.textContent)).toEqual(["Vacantes guardadas"]);
  expect(nav.querySelector('a[href="/candidato/guardadas"]')).not.toBeNull();
});
it("owns no shell, persistence, prototype fixture or implementation-status placeholder", () => {
  for (const forbidden of ["use client", "CandidateDestinationShell", "ACME_PROTOTYPE_JOBS", "prototype-jobs", "SidebarProvider", "CandidateShell", "next/headers", "next/navigation", "fetch(", "localStorage", "sessionStorage", "useState", "useEffect", "onClick", "<form", "<main", "redirect("]) expect(source).not.toContain(forbidden);
  expect(source).toContain('import { CandidateHeader } from "@/components/candidate-dashboard/candidate-header"');
  expect(source).toContain('<CandidateHeader title="Vacantes guardadas" />');
  expect(source).toContain("<SavedVacanciesWorkspace />");
});
